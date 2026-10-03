/**
 * Seeds the CTA reference data onto existing stations: State/Lake, corrected line lists, display
 * names, slugs, opening dates, closures with the status they imply, line sequences, and alias fixes.
 *
 * Idempotent: a second run reports zero changes. It updates stations in place by id and never
 * deletes or recreates one, so facts, narratives, and metrics keep their foreign keys. Everything
 * runs in one transaction, and --dry-run rolls it back after computing the report.
 *
 *   DATABASE_URL=... DATABASE_URL_UNPOOLED=... npx tsx scripts/seed-reference-data.ts [--dry-run] [--as-of YYYY-MM-DD]
 *
 * Run it after the revival_v2 migration (docs/runbooks/history-load.md); it refuses to run against
 * a station whose CTA id is not in the roster, which is what an unmigrated database looks like.
 */
import { parseArgs } from "node:util";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client";
import { STATION_CLOSURES, closuresFor, deriveStatus, todayInChicago } from "../src/lib/cta/closures";
import { CTA_ROSTER } from "../src/lib/cta/roster";
import { linesForStation, sequenceRows } from "../src/lib/cta/sequences";
import { displayNameFor, generateSlugs } from "../src/lib/cta/slug";
import { prisma } from "../src/lib/prisma";
import { isCliEntry } from "./cli";
import { isCalendarDate } from "./dates";

const STATE_LAKE = "40260";
// From CTA's stop list (8pix-ypme); State/Lake was never ingested, so it has no row yet.
const STATE_LAKE_LOCATION = { latitude: 41.88574, longitude: -87.627835 };

// Socrata names attached to the wrong station (docs/audit-2026-10-02/ghost-score.md section 1).
const WRONG_ALIASES = [
    { ctaStationId: "41660", aliasName: "State/Lake" }, // Lake (Red); State/Lake is its own station
    { ctaStationId: "40780", aliasName: "Central-Lake" }, // Central Park (Pink); belongs to Central (Green)
    { ctaStationId: "40250", aliasName: "Kedzie-Lake" }, // Kedzie-Homan (Blue); belongs to Kedzie (Green)
    { ctaStationId: "40180", aliasName: "Oak Park-Lake" }, // Oak Park (Blue); belongs to Oak Park (Green)
    { ctaStationId: "40370", aliasName: "Washington/State" }, // retired station 40500, not in the roster
    { ctaStationId: "41700", aliasName: "Washington/State" },
] as const;
const ADDED_ALIASES = [{ ctaStationId: STATE_LAKE, aliasName: "State/Lake" }] as const;

export interface SeedReport {
    asOf: string;
    dryRun: boolean;
    stationCount: number;
    stationsInserted: string[];
    stationUpdates: { ctaStationId: string; fields: string[] }[];
    closures: { created: number; updated: number; deleted: number };
    sequenceRows: { inserted: number; deleted: number };
    aliases: { added: number; removed: number };
    changes: number;
}

export interface SeedOptions {
    cityCode?: string;
    asOf?: string;
    dryRun?: boolean;
}

/** Same normalization the Go ETL used to fill StationAlias.normalized. */
function normalizeAliasName(name: string): string {
    return name
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[/-]/g, " ")
        .replace(/[^\w\s]/g, "")
        .replace(/\bstation\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/** Thrown to roll back a dry run's transaction, carrying the report it computed. */
class DryRunRollback extends Error {
    constructor(readonly report: SeedReport) {
        super("dry run");
    }
}

const closureKey = (stationId: string, startDay: string | null) => `${stationId}|${startDay}`;
const sequenceKey = (row: { line: string; branch: string; seq: number }) => `${row.line}|${row.branch}|${row.seq}`;

export async function seedReferenceData(prisma: PrismaClient, options: SeedOptions = {}): Promise<SeedReport> {
    const { cityCode = "chicago", asOf = todayInChicago(), dryRun = false } = options;
    try {
        return await prisma.$transaction(
            async (tx) => {
                const report = await seed(tx, cityCode, asOf, dryRun);
                if (dryRun) throw new DryRunRollback(report);
                return report;
            },
            { timeout: 120_000, maxWait: 10_000 },
        );
    } catch (error) {
        if (error instanceof DryRunRollback) return error.report;
        throw error;
    }
}

async function seed(tx: Prisma.TransactionClient, cityCode: string, asOf: string, dryRun: boolean): Promise<SeedReport> {
    const city = await tx.city.findUnique({ where: { code: cityCode } });
    if (!city) throw new Error(`City "${cityCode}" not found.`);

    const report: SeedReport = {
        asOf,
        dryRun,
        stationCount: 0,
        stationsInserted: [],
        stationUpdates: [],
        closures: { created: 0, updated: 0, deleted: 0 },
        sequenceRows: { inserted: 0, deleted: 0 },
        aliases: { added: 0, removed: 0 },
        changes: 0,
    };

    // Desired state for every roster station.
    const roster = CTA_ROSTER.map((s) => ({ ...s, lines: linesForStation(s.ctaStationId) }));
    const slugs = generateSlugs(roster);
    const desired = new Map(
        roster.map((s) => {
            const { status, closedAt } = deriveStatus(closuresFor(s.ctaStationId), asOf);
            return [
                s.ctaStationId,
                {
                    slug: slugs.get(s.ctaStationId)!,
                    displayName: displayNameFor(s),
                    lines: s.lines,
                    openedAt: s.openedAt ?? null,
                    status,
                    closedAt,
                },
            ];
        }),
    );

    const stations = await tx.station.findMany({ where: { cityId: city.id } });
    const unknown = stations.filter((s) => !s.ctaStationId || !desired.has(s.ctaStationId));
    if (unknown.length > 0) {
        const list = unknown.map((s) => `${s.name} (${s.ctaStationId ?? "no CTA id"})`).join(", ");
        throw new Error(
            `Stations with a CTA id outside the roster: ${list}. Apply the revival_v2 migration first.`,
        );
    }

    const present = new Set(stations.map((s) => s.ctaStationId));
    const missing = CTA_ROSTER.filter((s) => !present.has(s.ctaStationId));
    if (missing.some((s) => s.ctaStationId !== STATE_LAKE)) {
        throw new Error(`Roster stations missing from the database: ${missing.map((s) => s.name).join(", ")}.`);
    }
    for (const s of missing) {
        const d = desired.get(s.ctaStationId)!;
        const created = await tx.station.create({
            data: {
                cityId: city.id,
                externalId: s.ctaStationId,
                ctaStationId: s.ctaStationId,
                name: s.name,
                ...STATE_LAKE_LOCATION,
                slug: d.slug,
                displayName: d.displayName,
                lines: JSON.stringify(d.lines),
                openedAt: d.openedAt ? toDate(d.openedAt) : null,
                status: d.status,
                closedAt: d.closedAt ? toDate(d.closedAt) : null,
            },
        });
        stations.push(created);
        report.stationsInserted.push(s.ctaStationId);
    }

    // Station fields. A slug that moves is cleared first so two stations never hold it at once.
    const updates = stations.flatMap((s) => {
        const d = desired.get(s.ctaStationId!)!;
        const data: Prisma.StationUpdateInput = {};
        if (s.slug !== d.slug) data.slug = d.slug;
        if (s.displayName !== d.displayName) data.displayName = d.displayName;
        if (JSON.stringify(JSON.parse(s.lines)) !== JSON.stringify(d.lines)) data.lines = JSON.stringify(d.lines);
        if (toDay(s.openedAt) !== d.openedAt) data.openedAt = d.openedAt ? toDate(d.openedAt) : null;
        if (s.status !== d.status) data.status = d.status;
        if (toDay(s.closedAt) !== d.closedAt) data.closedAt = d.closedAt ? toDate(d.closedAt) : null;
        return Object.keys(data).length > 0 ? [{ station: s, data }] : [];
    });
    const movedSlugs = updates.filter((u) => u.data.slug !== undefined && u.station.slug !== null);
    for (const { station } of movedSlugs) {
        await tx.station.update({ where: { id: station.id }, data: { slug: null } });
    }
    for (const { station, data } of updates) {
        await tx.station.update({ where: { id: station.id }, data });
        report.stationUpdates.push({ ctaStationId: station.ctaStationId!, fields: Object.keys(data).sort() });
    }

    const idByCta = new Map(stations.map((s) => [s.ctaStationId!, s.id]));

    // Closures, keyed by station and start date.
    const existingClosures = await tx.stationClosure.findMany({ where: { station: { cityId: city.id } } });
    const wantedClosures = new Map(STATION_CLOSURES.map((c) => [closureKey(idByCta.get(c.ctaStationId)!, c.startDate), c]));
    for (const row of existingClosures) {
        const want = wantedClosures.get(closureKey(row.stationId, toDay(row.startDate)));
        if (!want) {
            await tx.stationClosure.delete({ where: { id: row.id } });
            report.closures.deleted++;
        } else if (toDay(row.endDate) !== want.endDate || row.reason !== want.reason) {
            await tx.stationClosure.update({
                where: { id: row.id },
                data: { endDate: want.endDate ? toDate(want.endDate) : null, reason: want.reason },
            });
            report.closures.updated++;
        }
    }
    const haveClosures = new Set(existingClosures.map((r) => closureKey(r.stationId, toDay(r.startDate))));
    for (const [key, c] of wantedClosures) {
        if (haveClosures.has(key)) continue;
        await tx.stationClosure.create({
            data: {
                stationId: idByCta.get(c.ctaStationId)!,
                startDate: toDate(c.startDate),
                endDate: c.endDate ? toDate(c.endDate) : null,
                reason: c.reason,
            },
        });
        report.closures.created++;
    }

    // Line sequences, keyed by line, branch, and position.
    const wantedRows = new Map(
        sequenceRows().map((r) => [sequenceKey(r), { ...r, stationId: idByCta.get(r.ctaStationId)! }]),
    );
    const existingRows = await tx.stationLineSequence.findMany({ where: { station: { cityId: city.id } } });
    const isCurrent = (r: (typeof existingRows)[number]) => wantedRows.get(sequenceKey(r))?.stationId === r.stationId;
    const staleIds = existingRows.filter((r) => !isCurrent(r)).map((r) => r.id);
    if (staleIds.length > 0) {
        report.sequenceRows.deleted = (await tx.stationLineSequence.deleteMany({ where: { id: { in: staleIds } } })).count;
    }
    const kept = new Set(existingRows.filter(isCurrent).map(sequenceKey));
    const toInsert = [...wantedRows].filter(([key]) => !kept.has(key)).map(([, r]) => r);
    if (toInsert.length > 0) {
        report.sequenceRows.inserted = (
            await tx.stationLineSequence.createMany({
                data: toInsert.map(({ stationId, line, branch, seq }) => ({ stationId, line, branch, seq })),
            })
        ).count;
    }

    // Aliases.
    const wrongAliases = WRONG_ALIASES.map(({ ctaStationId, aliasName }) => ({
        stationId: idByCta.get(ctaStationId)!,
        aliasName,
    }));
    report.aliases.removed = (await tx.stationAlias.deleteMany({ where: { OR: wrongAliases } })).count;
    report.aliases.added = (
        await tx.stationAlias.createMany({
            data: ADDED_ALIASES.map(({ ctaStationId, aliasName }) => ({
                stationId: idByCta.get(ctaStationId)!,
                aliasName,
                normalized: normalizeAliasName(aliasName),
            })),
            skipDuplicates: true,
        })
    ).count;

    report.stationCount = await tx.station.count({ where: { cityId: city.id } });
    if (report.stationCount !== CTA_ROSTER.length) {
        throw new Error(`Expected ${CTA_ROSTER.length} stations after seeding, found ${report.stationCount}.`);
    }
    report.changes =
        report.stationsInserted.length +
        report.stationUpdates.length +
        report.closures.created +
        report.closures.updated +
        report.closures.deleted +
        report.sequenceRows.inserted +
        report.sequenceRows.deleted +
        report.aliases.added +
        report.aliases.removed;
    return report;
}

function parseOptions(argv: string[]): SeedOptions {
    const { values } = parseArgs({
        args: argv,
        options: {
            "dry-run": { type: "boolean", default: false },
            "as-of": { type: "string" },
            city: { type: "string" },
        },
    });
    if (values["as-of"] !== undefined && !isCalendarDate(values["as-of"])) {
        throw new Error("--as-of must be a calendar date, YYYY-MM-DD.");
    }
    return { dryRun: values["dry-run"], asOf: values["as-of"], cityCode: values.city };
}

if (isCliEntry(import.meta.url)) {
    Promise.resolve()
        .then(() => seedReferenceData(prisma, parseOptions(process.argv.slice(2))))
        .then((report) => console.log(JSON.stringify(report, null, 2)))
        .catch((error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
