import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

// Runs in the `db` Vitest project after `prisma migrate deploy` has applied every migration.
const MIGRATIONS_DIR = path.resolve(__dirname, "../../prisma/migrations");
const CITY_CODE = "test-schema-v2";
const OTHER_CITY_CODE = "test-schema-v2-other";

let cityId: string;
let otherCityId: string;

async function expectUniqueViolation(write: Promise<unknown>): Promise<void> {
    const error = await write.then(
        () => null,
        (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
}

async function deleteTestRows(): Promise<void> {
    const cities = await prisma.city.findMany({
        where: { code: { in: [CITY_CODE, OTHER_CITY_CODE] } },
        select: { id: true },
    });
    const stationWhere = { cityId: { in: cities.map((c) => c.id) } };
    const stations = await prisma.station.findMany({ where: stationWhere, select: { id: true } });
    const stationIds = stations.map((s) => s.id);
    await prisma.ridershipDaily.deleteMany({ where: { stationId: { in: stationIds } } });
    await prisma.stationLineSequence.deleteMany({ where: { stationId: { in: stationIds } } });
    await prisma.stationClosure.deleteMany({ where: { stationId: { in: stationIds } } });
    await prisma.station.deleteMany({ where: stationWhere });
    await prisma.city.deleteMany({ where: { code: { in: [CITY_CODE, OTHER_CITY_CODE] } } });
    await prisma.syncRun.deleteMany({ where: { trigger: "test-schema-v2" } });
}

function station(overrides: Partial<Prisma.StationUncheckedCreateInput> = {}): Prisma.StationUncheckedCreateInput {
    return {
        cityId,
        name: "Test Station",
        latitude: 41.88,
        longitude: -87.63,
        lines: '["Blue"]',
        ...overrides,
    };
}

beforeAll(async () => {
    await deleteTestRows();
    cityId = (await prisma.city.create({ data: { code: CITY_CODE, name: "Test City" } })).id;
    otherCityId = (await prisma.city.create({ data: { code: OTHER_CITY_CODE, name: "Other City" } })).id;
});

afterAll(async () => {
    await deleteTestRows();
    await prisma.$disconnect();
});

describe("RidershipDaily", () => {
    it("rejects a second row for the same station and date", async () => {
        const s = await prisma.station.create({ data: station({ name: "Ridership PK" }) });
        const row = { stationId: s.id, serviceDate: new Date("2025-11-30"), entries: 100, dayType: "U" };

        await prisma.ridershipDaily.create({ data: row });
        await expectUniqueViolation(prisma.ridershipDaily.create({ data: { ...row, entries: 200 } }));
    });

    it("stores the service date as a calendar date", async () => {
        const s = await prisma.station.create({ data: station({ name: "Ridership DATE" }) });
        await prisma.ridershipDaily.create({
            data: { stationId: s.id, serviceDate: new Date("2025-03-03"), entries: 5333, dayType: "W" },
        });

        const [row] = await prisma.$queryRaw<{ serviceDate: string; dayType: string }[]>`
            SELECT "serviceDate"::text AS "serviceDate", "dayType" FROM "RidershipDaily" WHERE "stationId" = ${s.id}
        `;
        expect(row).toEqual({ serviceDate: "2025-03-03", dayType: "W" });
    });
});

describe("Station identity", () => {
    it("rejects two stations in one city with the same slug, and allows many without one", async () => {
        await prisma.station.create({ data: station({ name: "Slug A", slug: "dup-slug" }) });
        await expectUniqueViolation(prisma.station.create({ data: station({ name: "Slug B", slug: "dup-slug" }) }));

        await prisma.station.create({ data: station({ name: "No slug 1" }) });
        await prisma.station.create({ data: station({ name: "No slug 2" }) });
    });

    it("rejects two stations in one city with the same CTA station id", async () => {
        await prisma.station.create({ data: station({ name: "Id A", ctaStationId: "49999" }) });
        await expectUniqueViolation(
            prisma.station.create({ data: station({ name: "Id B", ctaStationId: "49999" }) }),
        );
    });

    it("allows the same slug and CTA station id in another city", async () => {
        await prisma.station.create({ data: station({ name: "Shared A", slug: "shared", ctaStationId: "48888" }) });
        await prisma.station.create({
            data: station({ cityId: otherCityId, name: "Shared B", slug: "shared", ctaStationId: "48888" }),
        });
    });

    it("defaults a new station to ACTIVE", async () => {
        const s = await prisma.station.create({ data: station({ name: "Status default" }) });
        expect(s.status).toBe("ACTIVE");
    });
});

describe("StationLineSequence", () => {
    it("rejects two stations at the same position on one branch", async () => {
        const a = await prisma.station.create({ data: station({ name: "Seq A" }) });
        const b = await prisma.station.create({ data: station({ name: "Seq B" }) });
        await prisma.stationLineSequence.create({ data: { stationId: a.id, line: "Test", branch: "main", seq: 0 } });
        await expectUniqueViolation(
            prisma.stationLineSequence.create({ data: { stationId: b.id, line: "Test", branch: "main", seq: 0 } }),
        );
    });
});

describe("SyncRun lease", () => {
    it("lets only one row hold the lease while many rows hold none", async () => {
        const run = { trigger: "test-schema-v2", status: "RUNNING" as const };
        await prisma.syncRun.create({ data: { ...run, lease: "test-lease" } });
        await expectUniqueViolation(prisma.syncRun.create({ data: { ...run, lease: "test-lease" } }));

        await prisma.syncRun.createMany({ data: [run, run, run] });
        expect(await prisma.syncRun.count({ where: { trigger: "test-schema-v2", lease: null } })).toBe(3);
    });
});

describe("migration drift", () => {
    it("reports no difference between the migrated database and schema.prisma", () => {
        // Prisma 7 diffs against the datasource in prisma.config.ts, which reads
        // DATABASE_URL_UNPOOLED; point it at the guarded test database.
        const output = execFileSync(
            "npx",
            ["prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"],
            {
                encoding: "utf8",
                stdio: "pipe",
                env: { ...process.env, DATABASE_URL_UNPOOLED: process.env.DATABASE_URL },
            },
        );
        expect(output).toMatch(/No difference detected/);
    });
});

/**
 * Replays the committed migrations over production-shaped rows in a scratch schema, inside a
 * transaction that is always rolled back, so the upgrade path (not just the end state) is tested.
 */
describe("revival v2 upgrade over production-shaped rows", () => {
    const SCHEMA = "revival_upgrade_test";
    const ROLLBACK = new Error("rollback");

    function migrationStatements(name: string): string[] {
        const sql = readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
        return sql
            .split("\n")
            .filter((line) => !line.trimStart().startsWith("--"))
            .join("\n")
            .split(/;\s*$/m)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    it("fixes the four CTA ids and keeps facts, narratives, and metrics", async () => {
        const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .sort();
        const v2Index = migrations.findIndex((name) => name.endsWith("_revival_v2"));
        expect(v2Index).toBeGreaterThan(0);

        type Observed = {
            ids: Record<string, string | null>;
            facts: number;
            narratives: number;
            metrics: { scoreVersion: number; ghostScore: number }[];
            ridershipColumns: string[];
            ctaIdUnique: boolean;
        };
        let observed: Observed | undefined;

        await prisma
            .$transaction(
                async (tx) => {
                    await tx.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
                    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${SCHEMA}"`);
                    for (const name of migrations.slice(0, v2Index)) {
                        for (const statement of migrationStatements(name)) await tx.$executeRawUnsafe(statement);
                    }

                    // Production rows as of 2026-10-02 (data-pipeline audit section 5).
                    await tx.$executeRawUnsafe(`INSERT INTO "City" (id, code, name) VALUES ('c', 'chicago', 'Chicago')`);
                    await tx.$executeRawUnsafe(`
                        INSERT INTO "Station" (id, "cityId", "externalId", "ctaStationId", name, latitude, longitude, lines) VALUES
                          ('w-ohare', 'c', '40670', '40310', 'Western (O''Hare)', 0, 0, '["Blue"]'),
                          ('w-orange', 'c', '40310', '40670', 'Western (Orange)', 0, 0, '["Orange"]'),
                          ('washington', 'c', '40370', '40500', 'Washington', 0, 0, '["Blue"]'),
                          ('jefferson', 'c', '41280', NULL, 'Jefferson Park Transit Center', 0, 0, '["Blue"]'),
                          ('w-pink', 'c', '40740', '40740', 'Western (Pink)', 0, 0, '["Pink"]')`);
                    await tx.$executeRawUnsafe(`
                        INSERT INTO "DataSource" (id, code, name, url) VALUES ('src', 'cta_socrata', 'CTA', 'https://example.test')`);
                    await tx.$executeRawUnsafe(`
                        INSERT INTO "StationFact" (id, "stationId", "factKey", value, "valueType", unit, geography, methodology, "sourceId") VALUES
                          ('f1', 'w-ohare', 'ridership_2001_avg', 1, 'number', 'riders/day', 'station', 'm', 'src'),
                          ('f2', 'w-orange', 'ridership_2001_avg', 2, 'number', 'riders/day', 'station', 'm', 'src')`);
                    await tx.$executeRawUnsafe(`
                        INSERT INTO "StationNarrative" (id, "stationId", "archetypeKey", "renderedStory", "evidenceFactKeys", "templateVersion", confidence) VALUES
                          ('n1', 'w-ohare', 'a', 'story', '[]', 'v1.0', 0.5)`);
                    await tx.$executeRawUnsafe(`
                        INSERT INTO "StationMetrics" (id, "stationId", "ghostScore", "lastUpdated", "serviceDateMax") VALUES
                          ('m1', 'w-ohare', 67, now(), '2025-11-30')`);
                    await tx.$executeRawUnsafe(`
                        INSERT INTO "RidershipDaily" (id, "stationId", "serviceDate", entries) VALUES
                          ('r1', 'w-ohare', '2025-11-30', 100)`);

                    for (const statement of migrationStatements(migrations[v2Index])) {
                        await tx.$executeRawUnsafe(statement);
                    }

                    const stations = await tx.$queryRawUnsafe<{ id: string; ctaStationId: string | null }[]>(
                        `SELECT id, "ctaStationId" FROM "Station"`,
                    );
                    const [{ facts }] = await tx.$queryRawUnsafe<{ facts: bigint }[]>(
                        `SELECT count(*) AS facts FROM "StationFact"`,
                    );
                    const [{ narratives }] = await tx.$queryRawUnsafe<{ narratives: bigint }[]>(
                        `SELECT count(*) AS narratives FROM "StationNarrative"`,
                    );
                    const metrics = await tx.$queryRawUnsafe<{ scoreVersion: number; ghostScore: number }[]>(
                        `SELECT "scoreVersion", "ghostScore" FROM "StationMetrics"`,
                    );
                    const columns = await tx.$queryRawUnsafe<{ column_name: string }[]>(
                        `SELECT column_name FROM information_schema.columns
                         WHERE table_schema = '${SCHEMA}' AND table_name = 'RidershipDaily' ORDER BY column_name`,
                    );
                    const unique = await tx.$queryRawUnsafe<{ indexname: string }[]>(
                        `SELECT indexname FROM pg_indexes
                         WHERE schemaname = '${SCHEMA}' AND indexname = 'Station_cityId_ctaStationId_key'`,
                    );

                    observed = {
                        ids: Object.fromEntries(stations.map((s) => [s.id, s.ctaStationId])),
                        facts: Number(facts),
                        narratives: Number(narratives),
                        metrics,
                        ridershipColumns: columns.map((c) => c.column_name),
                        ctaIdUnique: unique.length === 1,
                    };
                    throw ROLLBACK;
                },
                { timeout: 60_000 },
            )
            .catch((e: unknown) => {
                if (e !== ROLLBACK) throw e;
            });

        expect(observed).toEqual({
            ids: {
                "w-ohare": "40670",
                "w-orange": "40310",
                washington: "40370",
                jefferson: "41280",
                "w-pink": "40740",
            },
            facts: 2,
            narratives: 1,
            metrics: [{ scoreVersion: 1, ghostScore: 67 }],
            ridershipColumns: ["dayType", "entries", "serviceDate", "stationId"],
            ctaIdUnique: true,
        });

        const leftover = await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM information_schema.schemata WHERE schema_name = ${SCHEMA}
        `;
        expect(Number(leftover[0].n)).toBe(0);
    });
});
