import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    ExportHistoryError,
    MISATTRIBUTED_BEFORE,
    WESTERN_STATIONS,
    deriveDayType,
    exportHistory,
    normalizeServiceDate,
    readStationIdList,
    type ExportOptions,
} from "../../scripts/export-history";
import { makeTempDir, writeFixtureSnapshot, type FixtureSnapshot } from "./fixtures/history/snapshot-db";

const STATION_A = "a".repeat(32);
const STATION_B = "b".repeat(32);
const ORPHAN = "c".repeat(32);
const [WESTERN_BLUE, WESTERN_ORANGE] = WESTERN_STATIONS.map((station) => station.id);
const [WASHINGTON] = MISATTRIBUTED_BEFORE;

const BASE_STATIONS: FixtureSnapshot["stations"] = [
    { id: STATION_A, externalId: "40010" },
    { id: STATION_B, externalId: "40020" },
    { id: WESTERN_BLUE, externalId: "40670" },
    { id: WESTERN_ORANGE, externalId: "40310" },
    { id: WASHINGTON.id, externalId: "40370" },
];
const PRODUCTION_IDS = new Set(BASE_STATIONS.map((station) => station.id));

let dir: string;

beforeEach(() => {
    dir = makeTempDir("export-history-");
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

function run(fixture: Partial<FixtureSnapshot> & Pick<FixtureSnapshot, "rows">, options: Partial<ExportOptions> = {}) {
    const sqlitePath = writeFixtureSnapshot(dir, { stations: BASE_STATIONS, ...fixture });
    const outPath = path.join(dir, "out", "ridership-history.csv");
    const summary = exportHistory({
        sqlitePath,
        productionStationIds: PRODUCTION_IDS,
        outPath,
        through: "2025-11-30",
        ...options,
    });
    return { summary, outPath };
}

function csvLines(outPath: string): string[] {
    return fs.readFileSync(outPath, "utf8").trimEnd().split("\n");
}

function expectExportFailure(fn: () => unknown, message: RegExp): ExportHistoryError {
    let caught: unknown;
    try {
        fn();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(ExportHistoryError);
    const failure = caught as ExportHistoryError;
    expect(failure.message).toMatch(message);
    expect(failure.summary.ok).toBe(false);
    return failure;
}

describe("normalizeServiceDate", () => {
    it("recognizes the ETL's RFC3339 midnight and the manual script's space-separated shape", () => {
        expect(normalizeServiceDate("2025-11-15T00:00:00Z")).toEqual({ date: "2025-11-15", format: "rfc3339" });
        expect(normalizeServiceDate("2025-11-15 00:00:00")).toEqual({ date: "2025-11-15", format: "manual" });
    });

    it.each([
        "2025-11-15",
        "2025-11-15T05:00:00Z",
        "2025-11-15T00:00:00.000Z",
        "2025-11-15T00:00:00+00:00",
        "2025-02-30T00:00:00Z",
        "2025-13-01 00:00:00",
        "15/11/2025",
        "",
    ])("rejects the unrecognized shape %j instead of guessing a date", (raw) => {
        expect(normalizeServiceDate(raw)).toBeNull();
    });
});

describe("deriveDayType", () => {
    it("marks Saturdays A, Sundays U, and weekdays W from the calendar alone", () => {
        expect(deriveDayType("2025-11-15")).toBe("A"); // Saturday
        expect(deriveDayType("2025-11-16")).toBe("U"); // Sunday
        expect(deriveDayType("2025-11-17")).toBe("W"); // Monday
        expect(deriveDayType("2025-11-21")).toBe("W"); // Friday
        expect(deriveDayType("2001-01-06")).toBe("A"); // Saturday
        expect(deriveDayType("2001-01-07")).toBe("U"); // Sunday
    });

    it("leaves weekday holidays as W, because the sync overwrites day types with Socrata's value", () => {
        expect(deriveDayType("2025-12-25")).toBe("W"); // Thursday, Christmas
    });

    it("throws on a malformed date", () => {
        expect(() => deriveDayType("2025-11-31")).toThrow(/not a calendar date/);
    });
});

describe("exportHistory", () => {
    it("emits one row for a mixed-format duplicate pair, keeping the RFC3339 row", () => {
        const { summary, outPath } = run({
            rows: [
                [STATION_A, "2025-11-15T00:00:00Z", 120],
                [STATION_A, "2025-11-15 00:00:00", 120],
            ],
        });

        expect(csvLines(outPath)).toEqual(["stationId,serviceDate,entries,dayType", `${STATION_A},2025-11-15,120,A`]);
        expect(summary).toMatchObject({
            ok: true,
            rowsRead: 2,
            rfc3339RowsKept: 1,
            nonRfc3339RowsDropped: 1,
            nonRfc3339RowsWithoutTwin: 0,
            rowsWritten: 1,
            distinctStationDates: 1,
        });
        expect(summary.twinDisagreements.exported).toBe(0);
    });

    it("excludes an orphan row whose station id is not in Station", () => {
        const { summary, outPath } = run({
            rows: [
                [STATION_A, "2025-11-17T00:00:00Z", 300],
                [ORPHAN, "2025-11-17 00:00:00", 999],
            ],
        });

        expect(csvLines(outPath)).toEqual(["stationId,serviceDate,entries,dayType", `${STATION_A},2025-11-17,300,W`]);
        expect(summary.orphanRowsDropped).toBe(1);
        expect(summary.orphanStationIds).toEqual([ORPHAN]);
    });

    it("excludes every row for the two Western station uuids, in either format", () => {
        const { summary, outPath } = run({
            rows: [
                [STATION_A, "2019-03-04T00:00:00Z", 500],
                [WESTERN_BLUE, "2019-03-04T00:00:00Z", 3000],
                [WESTERN_ORANGE, "2019-03-04T00:00:00Z", 2000],
                [WESTERN_ORANGE, "2025-11-03T00:00:00Z", 3424],
                [WESTERN_ORANGE, "2025-11-03 00:00:00", 2478],
            ],
        });

        const body = csvLines(outPath).slice(1);
        expect(body).toEqual([`${STATION_A},2019-03-04,500,W`]);
        expect(summary.excludedRowsDropped).toEqual({ [WESTERN_BLUE]: 1, [WESTERN_ORANGE]: 3 });
        // The disagreeing pair belongs to an excluded station, so it is reported but does not fail the export.
        expect(summary.twinDisagreements).toMatchObject({ exported: 0, excluded: 1 });
        expect(summary.ok).toBe(true);
    });

    it("drops Washington (Blue) rows dated before 2010, where its history is mixed with the retired 40500", () => {
        expect(WASHINGTON).toMatchObject({ ctaStationId: "40370", before: "2010-01-01" });
        const { summary, outPath } = run({
            rows: [
                [WASHINGTON.id, "2001-01-02T00:00:00Z", 6000],
                [WASHINGTON.id, "2009-12-31T00:00:00Z", 3000],
                [WASHINGTON.id, "2010-01-01T00:00:00Z", 4000],
                [WASHINGTON.id, "2025-11-30T00:00:00Z", 5000],
            ],
        });

        expect(csvLines(outPath).slice(1)).toEqual([
            `${WASHINGTON.id},2010-01-01,4000,W`,
            `${WASHINGTON.id},2025-11-30,5000,U`,
        ]);
        expect(summary.misattributedRowsDropped).toEqual({ [WASHINGTON.id]: 2 });
        expect(summary.rowsWritten).toBe(2);
        expect(summary.distinctStations).toBe(1);
    });

    it("writes the load-ready CSV sorted by station then date with a summary of what it wrote", () => {
        const { summary, outPath } = run({
            rows: [
                [STATION_B, "2001-01-07T00:00:00Z", 40],
                [STATION_A, "2025-11-30T00:00:00Z", 10],
                [STATION_B, "2001-01-02T00:00:00Z", 30],
                [STATION_A, "2001-01-06T00:00:00Z", 20],
                [STATION_A, "2025-11-29T00:00:00Z", 0],
            ],
        });

        expect(csvLines(outPath)).toEqual([
            "stationId,serviceDate,entries,dayType",
            `${STATION_A},2001-01-06,20,A`,
            `${STATION_A},2025-11-29,0,A`,
            `${STATION_A},2025-11-30,10,U`,
            `${STATION_B},2001-01-02,30,W`,
            `${STATION_B},2001-01-07,40,U`,
        ]);
        expect(summary).toMatchObject({
            ok: true,
            output: outPath,
            rowsWritten: 5,
            distinctStationDates: 5,
            distinctStations: 2,
            minDate: "2001-01-02",
            maxDate: "2025-11-30",
            rowsPerYear: { "2001": 3, "2025": 2 },
            serviceDateShapes: { rfc3339: 5, manual: 0, unrecognized: 0 },
        });
    });

    it("fails loudly when a non-RFC3339 row has no RFC3339 twin, and leaves no output file", () => {
        const failure = expectExportFailure(
            () =>
                run({
                    rows: [
                        [STATION_A, "2025-11-15T00:00:00Z", 120],
                        [STATION_B, "2025-11-15 00:00:00", 77],
                        [STATION_B, "2025-11-16 00:00:00", 78],
                    ],
                }),
            /2 non-RFC3339 rows have no RFC3339 twin/,
        );

        expect(failure.summary.untwinnedByStation).toEqual({
            [STATION_B]: { rows: 2, minDate: "2025-11-15", maxDate: "2025-11-16" },
        });
        expect(failure.summary.output).toBeNull();
        expect(fs.readdirSync(path.join(dir, "out"))).toEqual([]);
    });

    it("keeps untwinned rows only for a station named explicitly, and records that choice", () => {
        const { summary, outPath } = run(
            { rows: [[STATION_B, "2025-11-15 00:00:00", 77]] },
            { keepUntwinnedStationIds: [STATION_B] },
        );

        expect(csvLines(outPath).slice(1)).toEqual([`${STATION_B},2025-11-15,77,A`]);
        expect(summary.nonRfc3339RowsKept).toBe(1);
        expect(summary.options.keepUntwinnedStationIds).toEqual([STATION_B]);
    });

    it("drops an extra station only when named explicitly, and records that choice", () => {
        const { summary, outPath } = run(
            {
                rows: [
                    [STATION_A, "2025-11-15T00:00:00Z", 120],
                    [STATION_B, "2025-11-15 00:00:00", 77],
                ],
            },
            { excludeStationIds: [STATION_B] },
        );

        expect(csvLines(outPath).slice(1)).toEqual([`${STATION_A},2025-11-15,120,A`]);
        expect(summary.excludedRowsDropped).toEqual({ [STATION_B]: 1 });
        expect(summary.options.extraExcludedStationIds).toEqual([STATION_B]);
    });

    it("fails when a twin pair disagrees on entries for an exported station", () => {
        const failure = expectExportFailure(
            () =>
                run({
                    rows: [
                        [STATION_A, "2025-11-15T00:00:00Z", 120],
                        [STATION_A, "2025-11-15 00:00:00", 95],
                    ],
                }),
            /1 RFC3339 twin pairs disagree on entries/,
        );

        expect(failure.summary.twinDisagreements.examples).toEqual([
            { stationId: STATION_A, serviceDate: "2025-11-15", rfc3339Entries: 120, nonRfc3339Entries: 95 },
        ]);
    });

    it("fails the distinct-count assertion when a duplicate station-date survives filtering", () => {
        const failure = expectExportFailure(
            () =>
                run({
                    uniqueStationDate: false,
                    rows: [
                        [STATION_A, "2025-11-15T00:00:00Z", 120],
                        [STATION_A, "2025-11-15T00:00:00Z", 121],
                    ],
                }),
            /distinct station-dates \(1\) does not equal rows written \(2\)/,
        );

        expect(failure.summary.duplicateStationDates).toBe(1);
    });

    it("fails when an exported station id is missing from the production id list", () => {
        const failure = expectExportFailure(
            () =>
                run(
                    { rows: [[STATION_A, "2025-11-15T00:00:00Z", 120]] },
                    { productionStationIds: new Set([STATION_B]) },
                ),
            new RegExp(`not in the production Station list: ${STATION_A}`),
        );

        expect(failure.summary.stationIdsMissingFromProduction).toEqual([STATION_A]);
    });

    it("fails rather than trims when a row is dated after the through date", () => {
        const failure = expectExportFailure(
            () =>
                run({
                    rows: [
                        [STATION_A, "2025-11-30T00:00:00Z", 120],
                        [STATION_A, "2025-12-01T00:00:00Z", 121],
                    ],
                }),
            /1 rows are dated after 2025-11-30/,
        );

        expect(failure.summary.rowsAfterThrough).toBe(1);
    });

    it("fails on a serviceDate shape it does not recognize", () => {
        const failure = expectExportFailure(
            () => run({ rows: [[STATION_A, "2025-11-15T06:00:00Z", 120]] }),
            /1 rows have an unrecognized serviceDate shape/,
        );

        expect(failure.summary.serviceDateShapes.unrecognized).toBe(1);
        expect(failure.summary.unrecognizedServiceDateExamples).toEqual(["2025-11-15T06:00:00Z"]);
    });

    it("refuses to write its output over the snapshot", () => {
        const sqlitePath = writeFixtureSnapshot(dir, { stations: BASE_STATIONS, rows: [] });
        expect(() =>
            exportHistory({ sqlitePath, productionStationIds: PRODUCTION_IDS, outPath: sqlitePath, through: "2025-11-30" }),
        ).toThrow(/would overwrite the snapshot/);
    });
});

describe("readStationIdList", () => {
    it("reads a plain list of one uuid per line", () => {
        const file = path.join(dir, "ids.txt");
        fs.writeFileSync(file, `${STATION_A}\n\n${STATION_B}\r\n`);
        expect(readStationIdList(file)).toEqual(new Set([STATION_A, STATION_B]));
    });

    it("reads the id column of a production Station CSV with quoted, comma-bearing fields", () => {
        const file = path.join(dir, "stations.csv");
        fs.writeFileSync(
            file,
            [
                "id,name,lines",
                `${STATION_A},"Harold Washington Library-State/Van Buren","[""Brown"",""Orange""]"`,
                `${STATION_B},"Clark/Lake","[""Blue"",
""Green""]"`,
                "",
            ].join("\n"),
        );
        expect(readStationIdList(file)).toEqual(new Set([STATION_A, STATION_B]));
    });

    it("throws on an empty list", () => {
        const file = path.join(dir, "empty.csv");
        fs.writeFileSync(file, "id,name\n");
        expect(() => readStationIdList(file)).toThrow(/no station ids/);
    });

    it("throws on a multi-column file without an id header", () => {
        const file = path.join(dir, "headerless.csv");
        fs.writeFileSync(file, `${STATION_A},Clark/Lake\n`);
        expect(() => readStationIdList(file)).toThrow(/first column header "id"/);
    });
});
