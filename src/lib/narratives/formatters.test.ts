import { describe, expect, it } from "vitest";
import { formatChange, formatPercent, formatPercentChange, getFactLabel } from "./formatters";

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
