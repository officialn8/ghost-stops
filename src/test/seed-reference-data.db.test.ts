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

        // Opening dates for the stations that opened after the ridership data begins (2001).
        const opened = await prisma.station.findMany({ where: { cityId, openedAt: { not: null } }, orderBy: { openedAt: "asc" } });
        expect(opened.map((s) => [s.ctaStationId, s.openedAt?.toISOString().slice(0, 10)])).toEqual([
            ["41670", "2001-06-30"], // Conservatory-Central Park Drive
            ["41680", "2012-04-30"], // Oakton-Skokie
            ["41510", "2012-05-18"], // Morgan
            ["41690", "2015-02-08"], // Cermak-McCormick Place
            ["41700", "2017-08-31"], // Washington/Wabash
            ["41710", "2024-08-05"], // Damen (Green)
        ]);
        expect(report.stationUpdates.find((u) => u.ctaStationId === "41710")?.fields).toContain("openedAt");

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

    it("repairs drifted rows on a re-run and then reports zero changes", async () => {
        const [ohare, forestPark] = [await station("40670"), await station("40220")];
        await prisma.station.update({ where: { id: ohare.id }, data: { slug: "swap-in-progress" } });
        await prisma.station.update({ where: { id: forestPark.id }, data: { slug: "western-blue-ohare" } });
        await prisma.station.update({ where: { id: ohare.id }, data: { slug: "western-blue-forest-park" } });
        await prisma.stationLineSequence.create({
            data: { stationId: ohare.id, line: "Test", branch: "stray", seq: 0 },
        });
        const lawrence = await prisma.stationClosure.findFirstOrThrow({ where: { stationId: "seed-40770" } });
        await prisma.stationClosure.update({ where: { id: lawrence.id }, data: { reason: "edited by hand" } });
        await prisma.stationClosure.create({
            data: { stationId: "seed-41200", startDate: new Date("2022-01-01"), reason: "not a real closure" },
        });
        await prisma.stationAlias.create({
            data: { stationId: "seed-40780", aliasName: "Central-Lake", normalized: "central lake" },
        });
        await prisma.station.update({ where: { id: "seed-41510" }, data: { openedAt: new Date("2012-05-24") } }); // Morgan's ceremony, not its first day
        await prisma.station.update({ where: { id: "seed-40900" }, data: { openedAt: new Date("1908-05-16") } });

        const report = await seedReferenceData(prisma, { cityCode: CITY, asOf: AS_OF });
        expect(report.stationUpdates).toEqual(
            expect.arrayContaining([
                { ctaStationId: "41510", fields: ["openedAt"] },
                { ctaStationId: "40900", fields: ["openedAt"] },
            ]),
        );
        expect(report.stationUpdates.filter((u) => u.fields.includes("slug"))).toEqual([
            { ctaStationId: expect.any(String), fields: ["slug"] },
            { ctaStationId: expect.any(String), fields: ["slug"] },
        ]);
        expect(report.stationUpdates).toHaveLength(4);
        expect(report.closures).toEqual({ created: 0, updated: 1, deleted: 1 });
        expect(report.sequenceRows).toEqual({ inserted: 0, deleted: 1 });
        expect(report.aliases).toEqual({ added: 0, removed: 1 });
        expect((await station("40670")).slug).toBe("western-blue-ohare");
        expect((await station("40220")).slug).toBe("western-blue-forest-park");
        expect((await station("41510")).openedAt?.toISOString().slice(0, 10)).toBe("2012-05-18");
        expect((await station("40900")).openedAt).toBeNull();

        expect((await seedReferenceData(prisma, { cityCode: CITY, asOf: AS_OF })).changes).toBe(0);
    });

    it("derives TEMP_CLOSED for a bounded closure in progress, and reverts when it ends", async () => {
        const during = await seedReferenceData(prisma, { cityCode: CITY, asOf: "2023-01-01" });
        expect(during.stationUpdates.map((u) => u.ctaStationId).sort()).toEqual(["40260", "40340", "40770"]);
        expect(await station("40770")).toMatchObject({ status: "TEMP_CLOSED" });
        expect((await station("40770")).closedAt?.toISOString().slice(0, 10)).toBe("2021-05-16");
        expect(await station("40260")).toMatchObject({ status: "ACTIVE", closedAt: null });

        const after = await seedReferenceData(prisma, { cityCode: CITY, asOf: AS_OF });
        expect(after.stationUpdates).toHaveLength(3);
        expect(await station("40770")).toMatchObject({ status: "ACTIVE", closedAt: null });
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

    it("refuses to seed when roster stations other than State/Lake are missing", async () => {
        const bad = await prisma.city.findUniqueOrThrow({ where: { code: BAD_CITY } });
        await prisma.station.updateMany({ where: { cityId: bad.id }, data: { ctaStationId: "40370" } });

        await expect(seedReferenceData(prisma, { cityCode: BAD_CITY, asOf: AS_OF })).rejects.toThrow(
            /Roster stations missing from the database: .*Howard/,
        );
    });
});
