import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline, sparklineLabel, sparklinePath } from "./Sparkline";

const WEEK = { start: "2026-07-25", end: "2026-07-31", values: [772, 460, 683, 865, 879, 1111, 988] };

describe("Sparkline", () => {
  it("is an image named by its date range, not a hover title", () => {
    const { container } = render(<Sparkline sparkline={WEEK} />);
    const image = screen.getByRole("img", { name: "Riders per day, Jul 25 to Jul 31, 2026" });
    expect(image).toBeInTheDocument();
    expect(container.querySelector("title, [title]")).toBeNull();
  });

  it("draws one stroke in the current color, with no fill", () => {
    const { container } = render(<Sparkline sparkline={WEEK} />);
    const path = container.querySelector("path");
    expect(path).toHaveAttribute("stroke", "currentColor");
    expect(path).toHaveAttribute("fill", "none");
    expect(container.querySelectorAll("path")).toHaveLength(1);
  });

  it("shows n/a for a station with no ridership", () => {
    render(<Sparkline sparkline={null} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("n/a")).toBeInTheDocument();
  });

  it("shows n/a when every day is missing", () => {
    render(<Sparkline sparkline={{ ...WEEK, values: [null, null, null, null, null, null, null] }} />);
    expect(screen.getByText("n/a")).toBeInTheDocument();
  });
});

describe("sparklineLabel", () => {
  it("names the year once when the range sits in one year", () => {
    expect(sparklineLabel({ start: "2026-07-25", end: "2026-07-31" })).toBe("Riders per day, Jul 25 to Jul 31, 2026");
  });

  it("names both years when the range crosses New Year", () => {
    expect(sparklineLabel({ start: "2025-12-29", end: "2026-01-04" })).toBe(
      "Riders per day, Dec 29, 2025 to Jan 4, 2026",
    );
  });

  it("reads calendar dates in UTC, so the first of the month stays the first", () => {
    expect(sparklineLabel({ start: "2026-07-01", end: "2026-07-07" })).toBe("Riders per day, Jul 1 to Jul 7, 2026");
  });
});

describe("sparklinePath", () => {
  it("spans the box, with the highest day at the top and the lowest at the bottom", () => {
    const { d } = sparklinePath([0, 10], 56, 24);
    expect(d).toBe("M2,22L54,2");
  });

  it("breaks the line at a missing day rather than drawing through it", () => {
    const { d } = sparklinePath([1, 2, null, 3, 4], 56, 24);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).not.toContain("NaN");
  });

  it("draws a flat week across the middle", () => {
    const { d } = sparklinePath([0, 0, 0], 56, 24);
    expect(d).toBe("M2,12L28,12L54,12");
  });

  it("marks the last day with data", () => {
    expect(sparklinePath([5, 6, null], 56, 24).last).toEqual({ x: 28, y: 2 });
    expect(sparklinePath([null, null], 56, 24).last).toBeNull();
  });
});
