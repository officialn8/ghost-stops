import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StationSeries } from "@/types/station";

const motion = vi.hoisted(() => ({ reduced: false }));

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motion.reduced,
}));

const { chartGeometry, RidershipChart, seriesRange } = await import("./RidershipChart");

beforeEach(() => {
  motion.reduced = false;
});

/** Consecutive days from `start`, one per entry; null is a day with no row. */
function series(start: string, entries: (number | null)[]): StationSeries {
  const days = entries.map((value, i) => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    return { date: date.toISOString().slice(0, 10), entries: value, dayType: value === null ? null : "W" };
  });
  return { start, end: days[days.length - 1].date, days };
}

const xs = (d: string) => [...d.matchAll(/[ML](\d+),/g)].map((m) => Number(m[1]));

describe("RidershipChart", () => {
  it("breaks the line at missing days instead of drawing them as zero, and says so", () => {
    const gappy = series("2026-05-02", [300, 320, 310, 290, null, null, null, 305, 315, 330]);
    const { container } = render(<RidershipChart series={gappy} line="Green" />);

    const paths = [...container.querySelectorAll("path")].map((p) => p.getAttribute("d")!);
    expect(paths).toHaveLength(2);
    expect(xs(paths[0])).toEqual([0, 1, 2, 3]);
    expect(xs(paths[1])).toEqual([7, 8, 9]);
    // No point sits on the zero line (y = 100 in the plot's units).
    expect(paths.join(" ")).not.toMatch(/,100(?![\d.])/);

    expect(screen.getByText(/^Daily riders, May 2 to May 11, 2026\./)).toHaveTextContent(
      "Daily riders, May 2 to May 11, 2026. Breaks in the line are days with no data (3).",
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Daily riders, May 2 to May 11, 2026. Average 310, lowest 290 on May 5, highest 330 on May 11. No data for 3 days.",
    );
  });

  it("strokes the line in the primary line's color", () => {
    const { container } = render(<RidershipChart series={series("2026-05-02", [10, 20, 30])} line="Brown" />);
    expect(container.querySelector("path")).toHaveAttribute("stroke", "#62361B");
  });

  it("draws a lone day between gaps as a dot", () => {
    const { paths } = chartGeometry(series("2026-05-02", [null, 40, null]));
    // 40 riders on an axis topped at 50: a fifth of the way down.
    expect(paths).toEqual(["M1,20h0"]);
  });

  it("says when no riders were recorded instead of drawing a flat line", () => {
    render(<RidershipChart series={series("2026-05-02", [0, 0, null, 0])} line="Brown" />);
    expect(screen.getByText("No riders recorded from May 2 to May 5, 2026.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("names both years when the range crosses one", () => {
    expect(seriesRange({ start: "2025-11-02", end: "2026-01-31" })).toBe("Nov 2, 2025 to Jan 31, 2026");
    expect(seriesRange({ start: "2026-05-02", end: "2026-07-31" })).toBe("May 2 to Jul 31, 2026");
  });

  it("reads calendar dates in UTC, so the first and last days never shift", () => {
    expect(seriesRange({ start: "2026-07-01", end: "2026-07-31" })).toBe("Jul 1 to Jul 31, 2026");
  });

  it("draws once, left to right, when it mounts in the browser", async () => {
    const { container } = render(<RidershipChart series={series("2026-05-02", [10, 20, 30])} line="Green" />);
    const cover = container.querySelector<HTMLElement>("[data-chart-cover]")!;
    expect(cover).toHaveAttribute("aria-hidden", "true");
    await waitFor(() => expect(cover.style.transform).toMatch(/scaleX\(0\)/), { timeout: 2000 });
  });

  it("does not animate under reduced motion", () => {
    motion.reduced = true;
    const { container } = render(<RidershipChart series={series("2026-05-02", [10, 20, 30])} line="Green" />);
    expect(container.querySelector("[data-chart-cover]")).toBeNull();
    expect(container.querySelector("path")).not.toBeNull();
  });
});
