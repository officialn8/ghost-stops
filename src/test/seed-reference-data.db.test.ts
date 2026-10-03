import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedReferenceData } from "../../scripts/seed-reference-data";
import { CTA_ROSTER } from "@/lib/cta/roster";
import { linesForStation, sequenceRows } from "@/lib/cta/sequences";
import { prisma } from "@/lib/prisma";

// Runs in the `db` Vitest project. Seeds a scratch city shaped like production on 2026-10-03.
const CITY = "test-seed";
const BAD_CITY = "test-seed-unmigrated";
const AS_OF = "2026-10-03";

// Line lists as production stored them before the seed.
const PRODUCTION_LINES: Record<string, string[]> = {
    "40540": ["Red"], // Wilson
    "40040": ["Brown", "Green", "Orange", "Pink", "Purple"], // Quincy
    "40160": ["Brown", "Green", "Orange", "Pink", "Purple"], // LaSalle/Van Buren
    "40730": ["Brown", "Green", "Orange", "Pink", "Purple"], // Washington/Wells
    "40850": ["Brown", "Green", "Orange", "Pink", "Purple"], // Harold Washington Library
};

let cityId: string;

async function deleteCities(): Promise<void> {
    const cities = await prisma.city.findMany({ where: { code: { in: [CITY, BAD_CITY] } } });
    const station = { cityId: { in: cities.map((c) => c.id) } };
    await prisma.stationLineSequence.deleteMany({ where: { station } });
    await prisma.stationClosure.deleteMany({ where: { station } });
    await prisma.stationAlias.deleteMany({ where: { station } });
    await prisma.station.deleteMany({ where: station });
    await prisma.city.deleteMany({ where: { id: { in: cities.map((c) => c.id) } } });
}

async function station(ctaStationId: string) {
    return prisma.station.findFirstOrThrow({ where: { cityId, ctaStationId } });
}

async function aliasOwners(aliasName: string): Promise<string[]> {
    const rows = await prisma.stationAlias.findMany({
        where: { aliasName, station: { cityId } },
        include: { station: true },
    });
    return rows.map((r) => r.station.ctaStationId!).sort();
}

beforeAll(async () => {
    await deleteCities();
    cityId = (await prisma.city.create({ data: { code: CITY, name: "Seed test" } })).id;
    await prisma.station.createMany({
        data: CTA_ROSTER.filter((s) => s.ctaStationId !== "40260").map((s) => ({
            id: `seed-${s.ctaStationId}`,
            cityId,
            externalId: s.ctaStationId,
            ctaStationId: s.ctaStationId,
            name: s.name,
            latitude: 41.88,
            longitude: -87.63,
            lines: JSON.stringify(PRODUCTION_LINES[s.ctaStationId] ?? linesForStation(s.ctaStationId)),
        })),
    });
    await prisma.stationAlias.createMany({
        data: [
            ["41660", "State/Lake"],
            ["41660", "Lake/State"],
            ["40780", "Central-Lake"],
            ["40280", "Central-Lake"],
            ["40370", "Washington/State"],
            ["41700", "Washington/State"],
        ].map(([cta, aliasName]) => ({ stationId: `seed-${cta}`, aliasName, normalized: aliasName.toLowerCase() })),
    });
});

afterAll(async () => {
    await deleteCities();
    await prisma.$disconnect();
});

describe("seedReferenceData", () => {
    it("reports changes on a dry run without writing them", async () => {
        const report = await seedReferenceData(prisma, { cityCode: CITY, asOf: AS_OF, dryRun: true });

        expect(report.changes).toBeGreaterThan(0);
        expect(report.stationsInserted).toEqual(["40260"]);
        expect(await prisma.station.count({ where: { cityId } })).toBe(143);
        expect(await prisma.station.count({ where: { cityId, slug: { not: null } } })).toBe(0);
    });

    it("brings a production-shaped city to the reference state without replacing stations", async () => {
        const report = await seedReferenceData(prisma, { cityCode: CITY, asOf: AS_OF });

        expect(report.stationCount).toBe(144);
        expect(report.stationsInserted).toEqual(["40260"]);
        expect(report.closures).toEqual({ created: 3, updated: 0, deleted: 0 });
        expect(report.sequenceRows).toEqual({ inserted: sequenceRows().length, deleted: 0 });
        expect(report.aliases).toEqual({ added: 1, removed: 4 });

        const ids = (await prisma.station.findMany({ where: { cityId }, select: { id: true } })).map((s) => s.id);
        expect(ids.filter((id) => id.startsWith("seed-"))).toHaveLength(143);
        expect(await prisma.station.count({ where: { cityId, slug: null } })).toBe(0);
        expect(await prisma.station.count({ where: { cityId, displayName: null } })).toBe(0);

        expect((await station("40670")).slug).toBe("western-blue-ohare");
        expect((await station("41660")).displayName).toBe("Lake");
        expect(JSON.parse((await station("40540")).lines)).toEqual(["Red", "Purple"]);
        expect(JSON.parse((await station("40040")).lines)).toEqual(["Brown", "Orange", "Purple", "Pink"]);

        const stateLake = await station("40260");
        expect(stateLake).toMatchObject({ name: "State/Lake", slug: "state-lake", status: "CLOSED" });
        expect(stateLake.closedAt?.toISOString().slice(0, 10)).toBe("2026-01-05");
        expect((await station("40770")).status).toBe("ACTIVE"); // Lawrence reopened 2025-07-20

        expect(await aliasOwners("State/Lake")).toEqual(["40260"]);
        expect(await aliasOwners("Lake/State")).toEqual(["41660"]);
        expect(await aliasOwners("Central-Lake")).toEqual(["40280"]);
        expect(await aliasOwners("Washington/State")).toEqual([]);
    });

    it("stores Blue Line order so Harlem (Forest Park end) sits between Oak Park and Forest Park", async () => {
        const blue = await prisma.stationLineSequence.findMany({
            where: { line: "Blue", branch: "main", station: { cityId } },
            include: { station: true },
            orderBy: { seq: "asc" },
        });
        const order = blue.map((r) => r.station.ctaStationId);
        const harlem = order.indexOf("40980");
        expect([order[harlem - 1], order[harlem + 1]]).toEqual(["40180", "40390"]);
    });

    it("reports zero changes on a second run", async () => {
        const report = await seedReferenceData(prisma, { cityCode: CITY, asOf: AS_OF });
        expect(report.changes).toBe(0);
        expect(report.stationCount).toBe(144);
    });

    it("refuses to seed a database that still carries the pre-migration Washington id", async () => {
        const bad = await prisma.city.create({ data: { code: BAD_CITY, name: "Unmigrated" } });
        await prisma.station.create({
            data: {
                cityId: bad.id,
                externalId: "40370",
                ctaStationId: "40500",
                name: "Washington",
                latitude: 41.88,
                longitude: -87.63,
                lines: '["Blue"]',
            },
        });

        await expect(seedReferenceData(prisma, { cityCode: BAD_CITY, asOf: AS_OF })).rejects.toThrow(
            /Washington \(40500\).*revival_v2 migration/,
        );
    });
});
