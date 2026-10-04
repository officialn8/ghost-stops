import { describe, expect, it } from "vitest";
import { isLevelChange } from "@/lib/format";
import { formatChange, formatPercent, formatPercentChange, formatTimeframe, getFactLabel } from "./formatters";

describe("formatChange", () => {
  it("signs every change, with a decimal only when the whole percent would read as zero", () => {
    expect(formatChange(0.0398)).toBe("+4%");
    expect(formatChange(-0.384)).toBe("-38%");
    expect(formatChange(0.003)).toBe("+0.3%");
    expect(formatChange(-0.0012)).toBe("-0.1%");
    expect(formatChange(0.0004)).toBe("0%");
    expect(formatChange(0)).toBe("0%");
  });
});

describe("isLevelChange", () => {
  it("is true exactly when formatChange prints 0%: under 0.05 percentage points either way", () => {
    for (const value of [0, 0.0004, -0.0004, 0.00049, -0.00049]) {
      expect(isLevelChange(value), String(value)).toBe(true);
      expect(formatChange(value)).toBe("0%");
    }
    for (const value of [0.0005, -0.0005, 0.003, -0.384]) {
      expect(isLevelChange(value), String(value)).toBe(false);
      expect(formatChange(value)).not.toBe("0%");
    }
  });
});

describe("formatPercent and formatPercentChange", () => {
  it("never print a signed zero", () => {
    expect(formatPercent(-0.001)).toBe("0%");
    expect(formatPercentChange(-0.001)).toBe("0%");
    expect(formatPercentChange(0.001)).toBe("0%");
    expect(formatPercentChange(0.12)).toBe("+12%");
  });
});

describe("getFactLabel", () => {
  it("labels every stored fact key from one table", () => {
    expect(getFactLabel("ridership_2001_avg")).toBe("2001 Ridership");
    expect(getFactLabel("ridership_2006_avg")).toBe("2006 Ridership");
    expect(getFactLabel("ridership_2012_avg")).toBe("2012 Ridership");
    expect(getFactLabel("station_opened")).toBe("Station Opened");
    expect(getFactLabel("airport_arrivals")).toBe("Airport Arrivals");
  });

  it("humanizes a key it does not know", () => {
    expect(getFactLabel("bus_routes_cut")).toBe("Bus Routes Cut");
  });
});

describe("formatTimeframe", () => {
    it("writes a range of years in words, never with a dash (R19)", () => {
        expect(formatTimeframe(2010, 2024)).toBe("2010 to 2024");
        expect(formatTimeframe(2010, 2024, "as_of")).toBe("2010 to 2024");
        expect(formatTimeframe(2010, 2024)).not.toMatch(/[\u2013\u2014]/);
    });

    it("collapses a one-year range and names open ends", () => {
        expect(formatTimeframe(2019, 2019)).toBe("2019");
        expect(formatTimeframe(2001, null)).toBe("since 2001");
        expect(formatTimeframe(null, 2024)).toBe("as of 2024");
    });
});
