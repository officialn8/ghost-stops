import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { CTA_ROSTER } from "@/lib/cta/roster";
import { directoryEntrySource, extractRailSchedule, type RailSchedule } from "./gtfs";
import { activeServices, boardingStops, countByRoute, medianGapMinutes, platformRouteKey, scheduledStopsFor } from "./schedule";
import { parseChicagoLocal, parseGtfsTime, serviceDateOf } from "./serviceDay";

const SLICE_DIR = fileURLToPath(new URL("./__fixtures__/gtfs-rail-slice/", import.meta.url));
const JARVIS = "41190";
const HOWARD = "40900";
const CLARK_LAKE = "40380";

let schedule: RailSchedule;

beforeAll(async () => {
    schedule = await extractRailSchedule(directoryEntrySource(SLICE_DIR), { rosterIds: new Set(CTA_ROSTER.map((s) => s.ctaStationId)), hash: "slice" });
});

describe("activeServices", () => {
    it("follows the calendar's day bits and the exceptions", () => {
        expect(activeServices(schedule, "2026-10-14")).toEqual(new Set(["109201"])); // Wednesday
        expect(activeServices(schedule, "2026-10-17")).toEqual(new Set(["109206"])); // Saturday
        expect(activeServices(schedule, "2026-10-18")).toEqual(new Set(["109209"])); // Sunday
        expect(activeServices(schedule, "2026-11-26")).toEqual(new Set(["109209"])); // Thanksgiving: the Sunday pattern
        expect(activeServices(schedule, "2026-12-01")).toEqual(new Set()); // past the calendar's end
    });
});

describe("boardingStops", () => {
    it("drops a trip's last stop and its exit-only platforms", () => {
        const red = schedule.trips.find((t) => t.id === "92275698970")!;
        expect(boardingStops(red)).toHaveLength(32);
        expect(boardingStops(red).at(-1)?.[0]).toBe("30227"); // Jarvis stays; Howard, the arrival, goes
        const green = schedule.trips.find((t) => t.id === "92275546232")!;
        expect(boardingStops(green).some(([stop]) => stop === "30217")).toBe(false);
        expect(boardingStops(green)).toHaveLength(green.stops.length - 2);
    });
});

describe("scheduledStopsFor", () => {
    it("yields the weekday pattern for Wednesday 2026-10-14: 886 stops, six at Jarvis, eight at Howard", () => {
        const day = scheduledStopsFor(schedule, "2026-10-14");

        expect(day.serviceDate).toBe("2026-10-14");
        expect(day.version).toBe("slice");
        expect(day.stops).toHaveLength(886);
        expect(countByRoute(day)).toEqual({ red: 192, blue: 192, brn: 110, g: 160, org: 66, p: 58, pink: 102, y: 6 });
        expect(day.byStation.get(JARVIS)).toHaveLength(6);
        // Three Red departures, three Purple stops, one Yellow departure, and the Purple express's
        // northbound call; the Red and Yellow arrivals are each trip's last stop. One late Red trip's
        // rows sit out of sequence order in the feed, so the count depends on sorting by stop_sequence.
        expect(day.byStation.get(HOWARD)).toHaveLength(8);
        expect(day.byStation.get("40830")).toHaveLength(6); // 18th
        expect(day.byStation.get("41680")).toHaveLength(3); // Oakton-Skokie
        expect(day.byStation.get("40260")).toBeUndefined(); // State/Lake, closed, has no scheduled stop
        for (const stop of day.stops) expect(stop.instant >= day.start && stop.instant < day.end).toBe(true);
    });

    it("keeps a northbound Red trip's stop at Jarvis and drops its arrival at Howard", () => {
        const day = scheduledStopsFor(schedule, "2026-10-14");
        const trip = day.stops.filter((s) => s.tripId === "92275698970");

        expect(trip.map((s) => s.stopId)).toContain("30227");
        expect(trip.some((s) => s.stationId === HOWARD)).toBe(false);
        expect(trip.find((s) => s.stopId === "30227")).toMatchObject({
            stationId: JARVIS,
            route: "red",
            direction: "1",
            calendarDate: "2026-10-14",
            seconds: parseGtfsTime("04:08:00"),
            instant: parseChicagoLocal("2026-10-14 04:08:00"),
        });
    });

    it("counts a Loop station per route and platform", () => {
        const day = scheduledStopsFor(schedule, "2026-10-14");
        expect(day.byStation.get(CLARK_LAKE)).toHaveLength(21);
        const counts = Object.fromEntries(
            [...day.platformRoutes.values()].filter((p) => p.stationId === CLARK_LAKE).map((p) => [platformRouteKey(p.stopId, p.route), p.instants.length]),
        );
        expect(counts).toEqual({
            "30074|g": 3,
            "30074|org": 3,
            "30074|p": 1,
            "30074|pink": 3,
            "30075|brn": 2,
            "30075|g": 3,
            "30374|blue": 3,
            "30375|blue": 3,
        });
    });

    it("yields the Sunday pattern on a Sunday and on Thanksgiving, the Saturday pattern on a Saturday", () => {
        const sunday = scheduledStopsFor(schedule, "2026-10-18");
        expect(sunday.stops).toHaveLength(291);
        expect(sunday.byStation.get(JARVIS)).toHaveLength(2);
        expect(sunday.byStation.get(HOWARD)).toHaveLength(2);
        expect(sunday.byStation.get(CLARK_LAKE)).toHaveLength(7);

        const thanksgiving = scheduledStopsFor(schedule, "2026-11-26");
        expect(thanksgiving.stops.map((s) => [s.stopId, s.route, s.seconds])).toEqual(sunday.stops.map((s) => [s.stopId, s.route, s.seconds]));
        expect(thanksgiving.stops.every((s) => s.calendarDate === "2026-11-26")).toBe(true);

        const saturday = scheduledStopsFor(schedule, "2026-10-17");
        expect(saturday.stops).toHaveLength(291);
        expect(saturday.byStation.get(HOWARD)).toHaveLength(1);
    });

    it("places a 25:10 stop on the prior service date, the one its trip is listed under", () => {
        const late = scheduledStopsFor(schedule, "2026-10-14").stops.find((s) => s.tripId === "92281366083" && s.stopId === "30190");
        expect(late).toMatchObject({ seconds: parseGtfsTime("25:10:00"), calendarDate: "2026-10-14", instant: parseChicagoLocal("2026-10-15 01:10:00") });
        expect(serviceDateOf(late!.instant)).toBe("2026-10-14");
        expect(scheduledStopsFor(schedule, "2026-10-15").stops.some((s) => s.tripId === "92281366083" && s.calendarDate === "2026-10-14")).toBe(false);
    });

    it("gives each platform and route its scheduled gap", () => {
        const day = scheduledStopsFor(schedule, "2026-10-14");
        const jarvisSouth = day.platformRoutes.get(platformRouteKey("30228", "red"))!;
        // 03:02, 08:02, 23:54:30: gaps of 300 and 952.5 minutes, median 626.3.
        expect(jarvisSouth.instants).toHaveLength(3);
        expect(jarvisSouth.scheduledGapMin).toBe(626.3);
        expect(day.platformRoutes.get(platformRouteKey("30074", "p"))?.scheduledGapMin).toBeNull();
    });

    it("yields no stops past the calendar's end", () => {
        expect(scheduledStopsFor(schedule, "2026-12-05").stops).toEqual([]);
    });
});

describe("medianGapMinutes", () => {
    it("takes the median of consecutive gaps, to a tenth of a minute", () => {
        const base = parseChicagoLocal("2026-10-14 08:00:00");
        expect(medianGapMinutes([base, base + 5 * 60_000, base + 12 * 60_000, base + 17 * 60_000])).toBe(5);
        expect(medianGapMinutes([base + 7 * 60_000, base])).toBe(7);
        expect(medianGapMinutes([base])).toBeNull();
        expect(medianGapMinutes([])).toBeNull();
    });
});
