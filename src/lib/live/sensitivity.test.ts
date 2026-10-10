import { describe, expect, it } from "vitest";
import { medianGapMinutes, platformRouteKey, type DaySchedule, type ScheduledStop } from "./schedule";
import { formatSensitivityTable, sensitivityTable } from "./sensitivity";
import { parseChicagoLocal, serviceDayStart } from "./serviceDay";
import { createDayTracker, slotKey, type TrackerState } from "./tracker";

const DAY = "2026-10-14";
const at = (hhmm: string) => parseChicagoLocal(`${DAY} ${hhmm}:00`);
const JARVIS = "41190";
const SOUTH = "30228";

function schedule(instants: number[]): DaySchedule {
    const stops: ScheduledStop[] = instants.map((instant, i) => ({ stopId: SOUTH, stationId: JARVIS, route: "red", direction: "1", tripId: `t${i}`, instant, calendarDate: DAY, seconds: 0 }));
    const entry = { stopId: SOUTH, stationId: JARVIS, route: "red" as const, instants, scheduledGapMin: medianGapMinutes(instants) };
    return { serviceDate: DAY, version: "v", stops, byStation: new Map([[JARVIS, stops]]), platformRoutes: new Map([[platformRouteKey(SOUTH, "red"), entry]]), start: serviceDayStart(DAY), end: serviceDayStart("2026-10-15") };
}

function tracker(): TrackerState {
    const t = createDayTracker(DAY);
    for (let i = 0; i < 1_440; i++) t.minutes[String(i)] = { p: 1, f: [], t: null, m: 0 };
    return t;
}

describe("sensitivityTable", () => {
    it("scores the same day under each tolerance and reports the probe-day shares", () => {
        const t = tracker();
        // 17:00 fulfilled from the passage log; 17:08 a ghost at every tolerance; 17:16 replaced by its run 6 minutes late.
        t.passages.push({ stationId: JARVIS, stopId: SOUTH, route: "red", run: "1", arrivedAt: at("17:01"), lastSeen: at("17:00"), vanishedAt: at("17:02") });
        const ghost = { key: slotKey(JARVIS, SOUTH, "red", at("17:08")), stationId: JARVIS, stopId: SOUTH, route: "red" as const, scheduledAt: at("17:08"), scheduledText: "x", firstSeen: at("16:58"), lastSeen: at("17:12"), runs: ["2"], fault: false, liveSameRunAt: null };
        const late = { key: slotKey(JARVIS, SOUTH, "red", at("17:16")), stationId: JARVIS, stopId: SOUTH, route: "red" as const, scheduledAt: at("17:16"), scheduledText: "x", firstSeen: at("17:04"), lastSeen: at("17:20"), runs: ["3"], fault: false, liveSameRunAt: at("17:22") };
        t.slots[ghost.key] = ghost;
        t.slots[late.key] = late;

        const table = sensitivityTable([{ serviceDate: DAY, tracker: t, schedule: schedule([at("17:00"), at("17:08"), at("17:16")]) }], [2, 5, 8]);

        expect(table.days).toEqual([DAY]);
        expect(table.rows.map((r) => [r.tolerance, r.scheduled, r.ghosts, r.ghostsPer100])).toEqual([
            [2, 3, 1, 33.3],
            [5, 3, 1, 33.3],
            [8, 3, 1, 33.3],
        ]);
        // At 2 and 5 the late run arrived after the window; at 8 it is within it.
        expect(table.rows.map((r) => r.fulfilledLateByRun)).toEqual([50, 50, 0]);
        expect(table.rows[0].fulfilledFromPassages).toBe(50); // one of two fulfilled stops had no slot
        expect(table.rows[0].perRoute.red).toBe(33.3);
        expect(table.rows[0].perRoute.blue).toBeNull();
        expect(table.rows[0].slots).toBe(2);
        expect(table.rows[0].unmappedSlots).toBe(0);
        expect(table.postedMinutes).toBe(15); // (14 + 16) / 2
        expect(table.horizonMinutes).toBe(11); // (10 + 12) / 2
    });

    it("formats the table with one row per tolerance", () => {
        const text = formatSensitivityTable(sensitivityTable([{ serviceDate: DAY, tracker: tracker(), schedule: schedule([]) }]));
        expect(text.split("\n")).toHaveLength(2 + 1 + 4);
        expect(text).toContain("days: 2026-10-14");
        expect(text).toMatch(/\n  2 /);
    });
});
