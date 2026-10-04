"use client";

import { useEffect, useRef } from "react";
import { animate } from "motion/react";
import { formatCalendarDate } from "@/lib/format";
import { getLineColor } from "@/lib/utils";
import type { StationSeries } from "@/types/station";
import { riders } from "./standing";
import { useMountMotion } from "./useMountMotion";

/** The plot's height in viewBox units; the x unit is one day. */
const PLOT_UNITS = 100;

const shortDay = (date: string) => formatCalendarDate(date, { month: "short", day: "numeric" });
const fullDay = (date: string) => formatCalendarDate(date, { month: "short", day: "numeric", year: "numeric" });

/** "May 2 to Jul 31, 2026", or "Nov 2, 2025 to Jan 31, 2026" across a new year (UTC, KTD17). */
export function seriesRange(series: Pick<StationSeries, "start" | "end">): string {
  const sameYear = series.start.slice(0, 4) === series.end.slice(0, 4);
  return `${sameYear ? shortDay(series.start) : fullDay(series.start)} to ${fullDay(series.end)}`;
}

/** The smallest of 1, 2, 2.5, or 5 times a power of ten at or above `value`, for the axis top. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value)!;
  return step * power;
}

interface Geometry {
  /** One path per run of days with data: a missing day breaks the line, it is never drawn as zero. */
  paths: string[];
  yMax: number;
  gaps: number;
  summary: string;
  /** No day with riders: the chart would be a flat line at zero. */
  empty: boolean;
}

export function chartGeometry(series: StationSeries): Geometry {
  const days = series.days;
  const known = days.flatMap((d) => (d.entries === null ? [] : [{ date: d.date, entries: d.entries }]));
  const gaps = days.length - known.length;
  const max = known.reduce((m, d) => Math.max(m, d.entries), 0);
  const yMax = niceCeiling(max);
  const y = (entries: number) => Math.round((PLOT_UNITS - (entries / yMax) * PLOT_UNITS) * 100) / 100;

  const paths: string[] = [];
  let run: string[] = [];
  const flush = () => {
    // A lone day between gaps is a zero-length subpath, which a round cap draws as a dot.
    if (run.length === 1) run.push(`h0`);
    if (run.length > 0) paths.push(run.join(""));
    run = [];
  };
  days.forEach((d, x) => {
    if (d.entries === null) return flush();
    run.push(`${run.length === 0 ? "M" : "L"}${x},${y(d.entries)}`);
  });
  flush();

  const range = seriesRange(series);
  let summary = `Daily riders, ${range}: no days with data.`;
  if (known.length > 0) {
    const low = known.reduce((a, b) => (b.entries < a.entries ? b : a));
    const high = known.reduce((a, b) => (b.entries > a.entries ? b : a));
    const average = known.reduce((sum, d) => sum + d.entries, 0) / known.length;
    summary =
      `Daily riders, ${range}. Average ${riders(average)}, lowest ${riders(low.entries)} on ${shortDay(low.date)}, ` +
      `highest ${riders(high.entries)} on ${shortDay(high.date)}.` +
      (gaps > 0 ? ` No data for ${gaps} ${gaps === 1 ? "day" : "days"}.` : "");
  }
  return { paths, yMax, gaps, summary, empty: max === 0 };
}

/**
 * The station's last 90 days of daily riders (the series ends at its own last day of data): a
 * line in its primary line's color on ink axes, with no box around it. Days without a row are gaps,
 * never zeros. It draws once, left to right, when the dossier opens; never under reduced motion
 * (R29). The caption states the date range, and the chart's accessible name summarizes it.
 */
export function RidershipChart({ series, line }: { series: StationSeries; line: string | null }) {
  const draw = useMountMotion();
  const cover = useRef<HTMLDivElement>(null);

  // Imperative, like the count: a hop to the next station inside an already open drawer still
  // draws, which a declarative `initial` would not after the drawer mounted with the page.
  useEffect(() => {
    if (!draw || !cover.current) return;
    const controls = animate(cover.current, { scaleX: [1, 0] }, { duration: 0.8, ease: [0.33, 1, 0.68, 1] });
    return () => controls.stop();
  }, [draw]);
  const { paths, yMax, gaps, summary, empty } = chartGeometry(series);
  const range = seriesRange(series);

  if (empty) {
    return <p className="text-15 text-ink-2">No riders recorded from {range}.</p>;
  }

  const ticks = [yMax, yMax / 2, 0];
  const width = Math.max(series.days.length - 1, 1);
  const color = line ? getLineColor(line) : "currentColor";

  return (
    <figure>
      <div className="flex gap-2">
        <div className="relative h-[140px] w-11 shrink-0 font-mono text-11 tabular text-ink-2" aria-hidden>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${(1 - t / yMax) * 100}%` }}
            >
              {riders(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div role="img" aria-label={summary} className="relative h-[140px]">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute inset-x-0 border-t border-rule"
                style={{ top: `${(1 - t / yMax) * 100}%` }}
                aria-hidden
              />
            ))}
            <svg
              viewBox={`0 0 ${width} ${PLOT_UNITS}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
              aria-hidden
              focusable="false"
            >
              {paths.map((d) => (
                <path
                  key={d}
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {draw && <div ref={cover} aria-hidden className="absolute -inset-1 origin-right bg-surface" data-chart-cover />}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-11 tabular text-ink-2" aria-hidden>
            <span>{shortDay(series.start)}</span>
            <span>{shortDay(series.end)}</span>
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-13 text-ink-2">
        Daily riders, {range}.
        {gaps > 0 && ` Breaks in the line are days with no data (${gaps}).`}
      </figcaption>
    </figure>
  );
}
