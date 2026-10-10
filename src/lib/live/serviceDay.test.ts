import { describe, expect, it } from "vitest";
import {
    chicagoWallClock,
    dayCloseInstant,
    expectedPolls,
    formatChicagoLocal,
    instantOfChicagoLocal,
    instantOfGtfsTime,
    latestClosedServiceDay,
    parseChicagoLocal,
    parseGtfsTime,
    serviceDateOf,
    serviceDayStart,
} from "./serviceDay";

// 2026: CDT (UTC-5) from 2026-03-08 02:00 to 2026-11-01 02:00, CST (UTC-6) otherwise.
const utc = (iso: string) => Date.parse(`${iso}Z`);

describe("chicagoWallClock", () => {
    it("reads the Chicago wall clock in daylight and standard time", () => {
        expect(chicagoWallClock(utc("2026-10-14T06:30:00"))).toEqual({ date: "2026-10-14", hour: 1, minute: 30, second: 0 });
        expect(chicagoWallClock(utc("2026-12-14T06:30:00"))).toEqual({ date: "2026-12-14", hour: 0, minute: 30, second: 0 });
    });

    it("reads midnight as hour 0, never 24", () => {
        expect(chicagoWallClock(utc("2026-10-14T05:00:00"))).toEqual({ date: "2026-10-14", hour: 0, minute: 0, second: 0 });
    });
});

describe("parseChicagoLocal and instantOfChicagoLocal", () => {
    it("parses both documented Train Tracker shapes to the same instant", () => {
        expect(parseChicagoLocal("20260925 17:05:00")).toBe(utc("2026-09-25T22:05:00"));
        expect(parseChicagoLocal("2026-09-25T17:05:00")).toBe(utc("2026-09-25T22:05:00"));
        expect(parseChicagoLocal("2026-09-25 17:05:00")).toBe(utc("2026-09-25T22:05:00"));
    });

    it("converts a standard-time wall clock with the winter offset", () => {
        expect(parseChicagoLocal("2026-12-01 17:05:00")).toBe(utc("2026-12-01T23:05:00"));
    });

    it("resolves the ambiguous fall-back hour by the poll epoch, not the string", () => {
        const first = utc("2026-11-01T06:30:00"); // 01:30 CDT
        const second = utc("2026-11-01T07:30:00"); // 01:30 CST, an hour later
        expect(parseChicagoLocal("2026-11-01 01:30:00", first - 60_000)).toBe(first);
        expect(parseChicagoLocal("2026-11-01 01:30:00", second + 60_000)).toBe(second);
        // Without a reference, the first occurrence.
        expect(parseChicagoLocal("2026-11-01 01:30:00")).toBe(first);
    });

    it("moves a wall clock inside the spring-forward gap forward by the gap", () => {
        // 02:30 on 2026-03-08 does not exist; it is read as 03:30 CDT.
        expect(instantOfChicagoLocal({ date: "2026-03-08", hour: 2, minute: 30, second: 0 })).toBe(utc("2026-03-08T08:30:00"));
    });

    it("throws on a malformed timestamp rather than returning an invalid instant", () => {
        expect(() => parseChicagoLocal("2026-02-30 01:00:00")).toThrow(/calendar date/);
        expect(() => parseChicagoLocal("yesterday")).toThrow(/timestamp/);
        expect(() => parseChicagoLocal("2026-10-14 25:00:00")).toThrow(/time of day/);
    });
});

describe("serviceDateOf", () => {
    it("assigns the hours before 03:00 to the previous service date", () => {
        expect(serviceDateOf(parseChicagoLocal("2026-10-14 01:30:00"))).toBe("2026-10-13");
        expect(serviceDateOf(parseChicagoLocal("2026-10-14 02:59:59"))).toBe("2026-10-13");
        expect(serviceDateOf(parseChicagoLocal("2026-10-14 03:00:00"))).toBe("2026-10-14");
        expect(serviceDateOf(parseChicagoLocal("2026-10-14 23:59:59"))).toBe("2026-10-14");
    });

    it("keeps both 01:30s of the fall-back night on 2026-10-31", () => {
        expect(serviceDateOf(utc("2026-11-01T06:30:00"))).toBe("2026-10-31");
        expect(serviceDateOf(utc("2026-11-01T07:30:00"))).toBe("2026-10-31");
        expect(serviceDateOf(utc("2026-11-01T09:00:00"))).toBe("2026-11-01"); // 03:00 CST
    });
});

describe("GTFS times", () => {
    it("parses times past 24:00", () => {
        expect(parseGtfsTime("25:10:00")).toBe(25 * 3600 + 10 * 60);
        expect(parseGtfsTime("7:05:30")).toBe(7 * 3600 + 5 * 60 + 30);
        expect(() => parseGtfsTime("7:05")).toThrow(/GTFS time/);
    });

    it("places 25:10:00 on 2026-10-13 at 01:10 on 2026-10-14", () => {
        expect(instantOfGtfsTime("2026-10-13", parseGtfsTime("25:10:00"))).toBe(parseChicagoLocal("2026-10-14 01:10:00"));
    });

    it("places 24:00:00 at midnight of the next calendar day", () => {
        expect(instantOfGtfsTime("2026-10-13", parseGtfsTime("24:00:00"))).toBe(parseChicagoLocal("2026-10-14 00:00:00"));
    });

    it("keeps a stop after 01:00 on the fall-back night on its trip's service date (AE11)", () => {
        // 26:30:00 on 2026-10-31 is 01:30 CST (the second 01:30), 25 hours and 30 minutes after noon minus 12.
        expect(instantOfGtfsTime("2026-10-31", parseGtfsTime("26:30:00"))).toBe(utc("2026-11-01T07:30:00"));
        expect(serviceDateOf(instantOfGtfsTime("2026-10-31", parseGtfsTime("26:30:00")))).toBe("2026-10-31");
    });

    it("counts spring-forward hours by the GTFS rule: noon minus twelve hours", () => {
        // 2026-03-08 has 23 hours, so noon minus twelve falls at 23:00 CST the evening before and
        // 03:00:00 is three hours later: 03:00 CDT, the same instant the service day starts.
        expect(instantOfGtfsTime("2026-03-08", parseGtfsTime("03:00:00"))).toBe(utc("2026-03-08T08:00:00"));
        expect(instantOfGtfsTime("2026-03-08", parseGtfsTime("12:00:00"))).toBe(utc("2026-03-08T17:00:00"));
    });
});

describe("service day bounds", () => {
    it("starts a service day at 03:00 Chicago", () => {
        expect(serviceDayStart("2026-10-14")).toBe(utc("2026-10-14T08:00:00"));
        expect(serviceDayStart("2026-12-14")).toBe(utc("2026-12-14T09:00:00"));
    });

    it("expects 1,440 polls on an ordinary day, 1,500 on the fall-back day, 1,380 on the spring-forward day (AE11)", () => {
        expect(expectedPolls("2026-10-14")).toBe(1_440);
        expect(expectedPolls("2026-10-31")).toBe(1_500);
        expect(expectedPolls("2026-03-07")).toBe(1_380);
    });

    it("reads a 1,440-poll fall-back day as 96% coverage, which counts", () => {
        expect(1_440 / expectedPolls("2026-10-31")).toBeCloseTo(0.96, 5);
    });

    it("closes a day at 03:00 plus the tolerance plus ten minutes", () => {
        expect(dayCloseInstant("2026-10-14", 5)).toBe(utc("2026-10-15T08:15:00"));
        // The fall-back day closes at 03:15 CST on 2026-11-01.
        expect(dayCloseInstant("2026-10-31", 5)).toBe(utc("2026-11-01T09:15:00"));
    });

    it("waits for the feed's latest scheduled stop when it runs past 03:00, never closing before 03:15", () => {
        expect(dayCloseInstant("2026-10-14", 5, parseGtfsTime("27:40:00"))).toBe(utc("2026-10-15T08:55:00"));
        expect(dayCloseInstant("2026-10-14", 5, parseGtfsTime("26:00:00"))).toBe(utc("2026-10-15T08:15:00"));
    });

    it("rejects a malformed service date", () => {
        expect(() => serviceDayStart("2026-13-01")).toThrow(/calendar date/);
        expect(() => expectedPolls("20261014")).toThrow(/calendar date/);
    });
});

describe("latestClosedServiceDay", () => {
    it("is yesterday once yesterday's close instant has passed, else the day before", () => {
        expect(latestClosedServiceDay(utc("2026-10-14T08:00:00"), 5)).toBe("2026-10-12"); // 03:00 CDT, before 03:15
        expect(latestClosedServiceDay(utc("2026-10-14T08:15:00"), 5)).toBe("2026-10-13");
        expect(latestClosedServiceDay(utc("2026-10-14T20:00:00"), 5)).toBe("2026-10-13");
        expect(latestClosedServiceDay(utc("2026-10-15T07:59:00"), 5)).toBe("2026-10-13"); // 02:59, still service day Oct 14
    });
});

describe("formatChicagoLocal", () => {
    it("writes the Chicago wall clock as YYYY-MM-DD HH:mm:ss", () => {
        expect(formatChicagoLocal(utc("2026-10-14T06:05:09"))).toBe("2026-10-14 01:05:09");
    });
});
