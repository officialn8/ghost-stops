import { describe, expect, it } from "vitest";
import { STATION_CLOSURES } from "@/lib/cta/closures";
import { CTA_ROSTER } from "@/lib/cta/roster";
import { missingDataReason, neighborClosures, windowBlock, type AvailabilityContext, type ClosureRange } from "./availability";

const closures = (ctaStationId: string) =>
    STATION_CLOSURES.filter((c) => c.ctaStationId === ctaStationId).map(({ startDate, endDate }) => ({ startDate, endDate }));

/** Every recorded closure, by CTA station id, as scoring and the why card key them. */
const CLOSURES_BY_CTA: ReadonlyMap<string, readonly ClosureRange[]> = new Map(
    STATION_CLOSURES.map((c) => [c.ctaStationId, closures(c.ctaStationId)]),
);

const lawrence = (dataThrough: string): AvailabilityContext => ({ dataThrough, openedAt: null, closures: closures("40770"), neighbors: [] });
const stateLake = (dataThrough: string): AvailabilityContext => ({ dataThrough, openedAt: null, closures: closures("40260"), neighbors: [] });
const damenGreen = (dataThrough: string): AvailabilityContext => ({ dataThrough, openedAt: "2024-08-05", closures: [], neighbors: [] });

/** A real station on `dataThrough`: its own opening and closures, and its neighbors' recorded closures. */
const station = (ctaStationId: string, dataThrough: string): AvailabilityContext => ({
    dataThrough,
    openedAt: CTA_ROSTER.find((s) => s.ctaStationId === ctaStationId)?.openedAt ?? null,
    closures: closures(ctaStationId),
    neighbors: neighborClosures(ctaStationId, CLOSURES_BY_CTA),
});

/** An open station whose one neighbor has these closures. */
const besideClosures = (dataThrough: string, neighbor: ClosureRange[], own: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
    dataThrough,
    openedAt: null,
    closures: [],
    neighbors: [{ ctaStationId: "40260", closures: neighbor }],
    ...own,
});

const WASHINGTON_WABASH = "41700";
const CLARK_LAKE = "40380";
const WILSON = "40540";
const ARGYLE = "41200";
const BRYN_MAWR = "41380";

describe("windowBlock", () => {
    it("AE1: Lawrence through 2026-07-31 has its 12-month windows but not a clean year-ago window", () => {
        expect(windowBlock("residual", lawrence("2026-07-31"))).toBeNull();
        expect(windowBlock("longRun", lawrence("2026-07-31"))).toBeNull();
        expect(windowBlock("erratic", lawrence("2026-07-31"))).toBeNull();
        // The year-ago window (2025-05-03 to 2025-07-31) still holds closed days until data reaches
        // 2026-10-17, when it starts on the reopening day.
        expect(windowBlock("yoy", lawrence("2026-07-31"))).toEqual({
            kind: "reopened",
            closedFrom: "2021-05-16",
            reopenedOn: "2025-07-20",
            availableFrom: "2026-10-17",
        });
        expect(windowBlock("yoy", lawrence("2026-10-16"))).not.toBeNull();
        expect(windowBlock("yoy", lawrence("2026-10-17"))).toBeNull();
    });

    it("blocks Lawrence's 12-month components through 2025-11-30, the snapshot's last day", () => {
        const reopened = { kind: "reopened", closedFrom: "2021-05-16", reopenedOn: "2025-07-20", availableFrom: "2026-07-19" };
        expect(windowBlock("residual", lawrence("2025-11-30"))).toEqual(reopened);
        expect(windowBlock("longRun", lawrence("2025-11-30"))).toEqual(reopened);
        expect(windowBlock("erratic", lawrence("2025-11-30"))).toBeNull();
    });

    it("marks every component of a station closed on the data-through date as closed", () => {
        for (const component of ["residual", "yoy", "longRun", "erratic"] as const) {
            expect(windowBlock(component, stateLake("2026-07-31"))).toEqual({ kind: "closed", closedFrom: "2026-01-05" });
        }
    });

    it("ignores a closure that starts after the data-through date", () => {
        expect(windowBlock("yoy", stateLake("2025-11-30"))).toBeNull();
    });

    it("treats a bounded closure still in progress on the data-through date as closed", () => {
        expect(windowBlock("erratic", lawrence("2023-06-30"))).toEqual({ kind: "closed", closedFrom: "2021-05-16" });
    });

    it("blocks a component whose window starts before the station opened, until it no longer does", () => {
        // 2019 never moves, so Damen (Green) never gets a long-run comparison.
        expect(windowBlock("longRun", damenGreen("2026-07-31"))).toEqual({ kind: "new", openedAt: "2024-08-05", availableFrom: null });
        expect(windowBlock("residual", damenGreen("2026-07-31"))).toBeNull();
        expect(windowBlock("yoy", damenGreen("2026-07-31"))).toBeNull();

        expect(windowBlock("residual", damenGreen("2025-07-31"))).toEqual({ kind: "new", openedAt: "2024-08-05", availableFrom: "2025-08-04" });
        expect(windowBlock("yoy", damenGreen("2025-07-31"))).toEqual({ kind: "new", openedAt: "2024-08-05", availableFrom: "2025-11-02" });
        expect(windowBlock("erratic", damenGreen("2025-07-31"))).toBeNull();
    });

    it("blocks nothing for a station open throughout", () => {
        const ctx: AvailabilityContext = { dataThrough: "2026-07-31", openedAt: null, closures: [], neighbors: [] };
        for (const component of ["residual", "yoy", "longRun", "erratic"] as const) {
            expect(windowBlock(component, ctx)).toBeNull();
        }
    });
});

describe("neighborClosures", () => {
    it("keeps the closures of the stations next to one on its lines, and only those", () => {
        expect(neighborClosures(WASHINGTON_WABASH, CLOSURES_BY_CTA)).toEqual([
            { ctaStationId: "40260", closures: [{ startDate: "2026-01-05", endDate: null }] },
        ]);
        expect(neighborClosures(ARGYLE, CLOSURES_BY_CTA).map((n) => n.ctaStationId)).toEqual(["40340", "40770"]);
        expect(neighborClosures("40020", CLOSURES_BY_CTA)).toEqual([]); // Harlem/Lake
        expect(neighborClosures(null, CLOSURES_BY_CTA)).toEqual([]);
    });
});

describe("windowBlock for a closure next door", () => {
    // Data through 2026-07-31: the trailing window is 2026-05-03 to 2026-07-31, the year-ago one
    // 2025-05-03 to 2025-07-31.
    const D = "2026-07-31";

    it("sets aside Washington/Wabash and Clark/Lake's year-over-year: State/Lake closed between the windows", () => {
        for (const cta of [WASHINGTON_WABASH, CLARK_LAKE]) {
            // Comparable again once both windows fall inside the closure: the year-ago window starts 2026-01-05.
            expect(windowBlock("yoy", station(cta, D)), cta).toEqual({
                kind: "neighbor-closure",
                neighborCtaStationId: "40260",
                change: "closed",
                date: "2026-01-05",
                availableFrom: "2027-04-04",
            });
            expect(windowBlock("yoy", station(cta, "2027-04-03")), cta).toMatchObject({ kind: "neighbor-closure" });
            expect(windowBlock("yoy", station(cta, "2027-04-04")), cta).toBeNull();
        }
    });

    it("sets aside Wilson, Argyle, and Bryn Mawr's year-over-year: Lawrence and Berwyn reopened inside the year-ago window", () => {
        const reopened = (neighborCtaStationId: string) => ({
            kind: "neighbor-closure",
            neighborCtaStationId,
            change: "reopened",
            date: "2025-07-20",
            availableFrom: "2026-10-17",
        });
        expect(windowBlock("yoy", station(WILSON, D))).toEqual(reopened("40770"));
        // Both of Argyle's neighbors reopened the same day; the first on the line names it.
        expect(windowBlock("yoy", station(ARGYLE, D))).toEqual(reopened("40340"));
        expect(windowBlock("yoy", station(BRYN_MAWR, D))).toEqual(reopened("40340"));
        for (const cta of [WILSON, ARGYLE, BRYN_MAWR]) {
            expect(windowBlock("yoy", station(cta, "2026-10-16")), cta).not.toBeNull();
            expect(windowBlock("yoy", station(cta, "2026-10-17")), cta).toBeNull();
        }
    });

    it("sets aside Wilson's year-over-year on the snapshot's 2025-11-30: Lawrence closed a year earlier, open now", () => {
        expect(windowBlock("yoy", station(WILSON, "2025-11-30"))).toEqual({
            kind: "neighbor-closure",
            neighborCtaStationId: "40770",
            change: "reopened",
            date: "2025-07-20",
            availableFrom: "2026-10-17",
        });
        // State/Lake's closure had not begun.
        expect(windowBlock("yoy", station(WASHINGTON_WABASH, "2025-11-30"))).toBeNull();
    });

    it("touches only year-over-year, and no station farther along the line", () => {
        for (const component of ["residual", "longRun", "erratic"] as const) {
            expect(windowBlock(component, station(WASHINGTON_WABASH, D)), component).toBeNull();
            expect(windowBlock(component, station(WILSON, D)), component).toBeNull();
        }
        expect(windowBlock("yoy", station("40680", D))).toBeNull(); // Adams/Wabash, two stops from State/Lake
        expect(windowBlock("yoy", station("40080", D))).toBeNull(); // Sheridan, two stops from Lawrence
    });

    it("does not set aside a neighbor closed throughout both windows, or open throughout both", () => {
        expect(windowBlock("yoy", besideClosures(D, [{ startDate: "2025-01-01", endDate: null }]))).toBeNull();
        expect(windowBlock("yoy", besideClosures(D, [{ startDate: "2025-01-01", endDate: "2026-09-01" }]))).toBeNull();
        // Two back-to-back closures read as one: the seam, 2025-06-15, falls inside the year-ago
        // window (2025-05-03 to 2025-07-31), which neither closure covers alone.
        expect(
            windowBlock("yoy", besideClosures(D, [{ startDate: "2025-01-01", endDate: "2025-06-15" }, { startDate: "2025-06-15", endDate: null }])),
        ).toBeNull();
        // An overlapping pair, the second ending inside the first, keeps the first's open end.
        expect(
            windowBlock("yoy", besideClosures(D, [{ startDate: "2025-01-01", endDate: null }, { startDate: "2025-06-01", endDate: "2025-06-20" }])),
        ).toBeNull();
        // Open throughout both: before them, between them, and after them.
        expect(windowBlock("yoy", besideClosures(D, [{ startDate: "2020-01-01", endDate: "2021-01-01" }]))).toBeNull();
        expect(windowBlock("yoy", besideClosures(D, [{ startDate: "2025-09-01", endDate: "2025-10-01" }]))).toBeNull();
        expect(windowBlock("yoy", besideClosures(D, [{ startDate: "2026-08-01", endDate: null }]))).toBeNull();
    });

    it("sets aside a neighbor that closed between the windows, or was closed for part of either", () => {
        const block = (neighbor: ClosureRange[]) => windowBlock("yoy", besideClosures(D, neighbor));
        // Closed between the windows: open a year ago, closed throughout now.
        expect(block([{ startDate: "2026-01-05", endDate: null }])).toMatchObject({ change: "closed", date: "2026-01-05" });
        // Reopened inside the year-ago window.
        expect(block([{ startDate: "2021-05-16", endDate: "2025-07-20" }])).toMatchObject({ change: "reopened", date: "2025-07-20" });
        // Reopened between the windows: closed throughout a year ago, open throughout now.
        expect(block([{ startDate: "2024-01-01", endDate: "2025-09-01" }])).toMatchObject({ change: "reopened", date: "2025-09-01" });
        // Closed for two weeks inside the trailing window; the reopening is the latest change.
        expect(block([{ startDate: "2026-06-01", endDate: "2026-06-15" }])).toMatchObject({ change: "reopened", date: "2026-06-15" });
        // Closed at the start of the trailing window's last day.
        expect(block([{ startDate: "2026-07-31", endDate: null }])).toMatchObject({ change: "closed", date: "2026-07-31" });
        // Closed for part of both windows: the same state in each, but neither window is like for like.
        expect(
            block([
                { startDate: "2025-06-01", endDate: "2025-06-10" },
                { startDate: "2026-06-01", endDate: "2026-06-10" },
            ]),
        ).toMatchObject({ change: "reopened", date: "2026-06-10" });
    });

    it("names the neighbor with the latest change, and waits for every neighbor before comparing again", () => {
        const ctx: AvailabilityContext = {
            dataThrough: D,
            openedAt: null,
            closures: [],
            neighbors: [
                { ctaStationId: "40770", closures: closures("40770") }, // reopened 2025-07-20: clear from 2026-10-17
                { ctaStationId: "40260", closures: closures("40260") }, // closed 2026-01-05: clear from 2027-04-04
            ],
        };
        expect(windowBlock("yoy", ctx)).toEqual({
            kind: "neighbor-closure",
            neighborCtaStationId: "40260",
            change: "closed",
            date: "2026-01-05",
            availableFrom: "2027-04-04",
        });
    });

    it("keeps the station's own reason first: its own reopening, closure, or opening", () => {
        const stateLakeNextDoor = [{ startDate: "2026-01-05", endDate: null }];
        // Its own reopening clears on 2026-10-17, but State/Lake next door holds year-over-year
        // until 2027-04-04, so that is when it is available.
        const reopenedBeside = (dataThrough: string) => besideClosures(dataThrough, stateLakeNextDoor, { closures: closures("40770") });
        expect(windowBlock("yoy", reopenedBeside(D))).toEqual({
            kind: "reopened",
            closedFrom: "2021-05-16",
            reopenedOn: "2025-07-20",
            availableFrom: "2027-04-04",
        });
        expect(windowBlock("yoy", reopenedBeside("2026-10-17"))).toMatchObject({ kind: "neighbor-closure", availableFrom: "2027-04-04" });
        expect(windowBlock("yoy", reopenedBeside("2027-04-03"))).not.toBeNull();
        expect(windowBlock("yoy", reopenedBeside("2027-04-04"))).toBeNull();
        expect(windowBlock("yoy", besideClosures(D, stateLakeNextDoor, { closures: [{ startDate: "2026-03-01", endDate: null }] }))).toEqual({
            kind: "closed",
            closedFrom: "2026-03-01",
        });
        expect(windowBlock("yoy", besideClosures(D, stateLakeNextDoor, { openedAt: "2025-09-15" }))).toMatchObject({ kind: "new" });
    });

    it("dates a closure next door by every rule: the station's own later closure holds year-over-year too", () => {
        // State/Lake next door clears on 2027-04-04; the station's own closure from 2026-12-01 to
        // 2027-01-15 leaves the trailing window on 2027-04-14.
        const ctx = (dataThrough: string) =>
            besideClosures(dataThrough, [{ startDate: "2026-01-05", endDate: null }], { closures: [{ startDate: "2026-12-01", endDate: "2027-01-15" }] });
        expect(windowBlock("yoy", ctx(D))).toEqual({
            kind: "neighbor-closure",
            neighborCtaStationId: "40260",
            change: "closed",
            date: "2026-01-05",
            availableFrom: "2027-04-14",
        });
        expect(windowBlock("yoy", ctx("2027-04-13"))).toMatchObject({ kind: "reopened" });
        expect(windowBlock("yoy", ctx("2027-04-14"))).toBeNull();
    });
});

describe("missingDataReason", () => {
    const open: AvailabilityContext = { dataThrough: "2026-07-31", openedAt: null, closures: [], neighbors: [] };
    /** How readers compose a null component's reason: the window block first, then missing data. */
    const reason = (component: "residual" | "yoy", ctx: AvailabilityContext, basis: "neighbors" | "none") =>
        windowBlock(component, ctx) ?? missingDataReason(component, basis);

    it("names missing peers for the residual only, and missing data otherwise", () => {
        expect(missingDataReason("residual", "none")).toEqual({ kind: "no-peers" });
        expect(missingDataReason("residual", "neighbors")).toEqual({ kind: "no-data" });
        expect(missingDataReason("residual", null)).toEqual({ kind: "no-data" });
        expect(missingDataReason("yoy", "none")).toEqual({ kind: "no-data" });
    });

    it("is the fallback behind a window block, which readers check first", () => {
        expect(reason("yoy", lawrence("2026-07-31"), "neighbors")).toMatchObject({ kind: "reopened" });
        expect(reason("residual", open, "none")).toEqual({ kind: "no-peers" });
        expect(reason("yoy", open, "none")).toEqual({ kind: "no-data" });
    });
});
