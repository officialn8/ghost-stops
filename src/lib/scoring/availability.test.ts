import { describe, expect, it } from "vitest";
import { STATION_CLOSURES } from "@/lib/cta/closures";
import { missingDataReason, windowBlock, type AvailabilityContext } from "./availability";

const closures = (ctaStationId: string) =>
    STATION_CLOSURES.filter((c) => c.ctaStationId === ctaStationId).map(({ startDate, endDate }) => ({ startDate, endDate }));

const lawrence = (dataThrough: string): AvailabilityContext => ({ dataThrough, openedAt: null, closures: closures("40770") });
const stateLake = (dataThrough: string): AvailabilityContext => ({ dataThrough, openedAt: null, closures: closures("40260") });
const damenGreen = (dataThrough: string): AvailabilityContext => ({ dataThrough, openedAt: "2024-08-05", closures: [] });

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
        const ctx: AvailabilityContext = { dataThrough: "2026-07-31", openedAt: null, closures: [] };
        for (const component of ["residual", "yoy", "longRun", "erratic"] as const) {
            expect(windowBlock(component, ctx)).toBeNull();
        }
    });
});

describe("missingDataReason", () => {
    const open: AvailabilityContext = { dataThrough: "2026-07-31", openedAt: null, closures: [] };
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
