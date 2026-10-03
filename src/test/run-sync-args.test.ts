import { describe, expect, it } from "vitest";
import { parseRunSyncArgs } from "../../scripts/run-sync";

describe("parseRunSyncArgs", () => {
    it("runs the daily trailing window with no arguments", () => {
        expect(parseRunSyncArgs([])).toEqual({
            trigger: "local",
            mode: "daily",
            cityCode: "chicago",
            since: undefined,
            ctaStationIds: undefined,
        });
    });

    it("names a per-station backfill in its trigger, so the run record says what it fetched", () => {
        expect(parseRunSyncArgs(["--since", "2001-01-01", "--station-id", "40670", "--station-id", "40310"])).toEqual({
            trigger: "local --since 2001-01-01 --station-id 40670 --station-id 40310",
            mode: "daily",
            cityCode: "chicago",
            since: "2001-01-01",
            ctaStationIds: ["40670", "40310"],
        });
    });

    it("selects reconciliation with --reconcile", () => {
        expect(parseRunSyncArgs(["--reconcile"])).toMatchObject({ trigger: "local --reconcile", mode: "weekly" });
    });

    it("refuses bad dates, bad station ids, unknown flags, and a station-scoped reconciliation", () => {
        expect(() => parseRunSyncArgs(["--since", "2001-02-30"])).toThrow(/YYYY-MM-DD/);
        expect(() => parseRunSyncArgs(["--station-id", "4067"])).toThrow(/five-digit/);
        expect(() => parseRunSyncArgs(["--sincee", "2001-01-01"])).toThrow();
        expect(() => parseRunSyncArgs(["--reconcile", "--station-id", "40670"])).toThrow(/every station/);
    });
});
