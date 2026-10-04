import { formatCalendarDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StationSparkline } from "@/types/station";

const PAD = 2;

/** Two decimals is finer than a pixel; anything more only bloats the path. */
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The stroke for a week of daily riders, scaled to the week's own low and high: the lowest day
 * on the bottom edge, the highest on the top, a flat week across the middle. A missing day lifts
 * the pen, so a gap reads as a gap and never as a dip to zero. `last` is the last day with data.
 */
export function sparklinePath(
  values: readonly (number | null)[],
  width: number,
  height: number,
): { d: string; last: { x: number; y: number } | null } {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return { d: "", last: null };

  const min = Math.min(...present);
  const max = Math.max(...present);
  const step = values.length > 1 ? (width - PAD * 2) / (values.length - 1) : 0;
  const x = (i: number) => round(values.length > 1 ? PAD + i * step : width / 2);
  const y = (value: number) =>
    round(max === min ? height / 2 : PAD + (height - PAD * 2) * (1 - (value - min) / (max - min)));

  let d = "";
  let penDown = false;
  let last: { x: number; y: number } | null = null;
  values.forEach((value, i) => {
    if (value === null) {
      penDown = false;
      return;
    }
    const point = { x: x(i), y: y(value) };
    const isolated = !penDown && (i === values.length - 1 || values[i + 1] === null);
    // A day with no neighbor on either side is a zero-length segment: a dot under a round cap.
    d += `${penDown ? "L" : "M"}${point.x},${point.y}${isolated ? "h0" : ""}`;
    penDown = true;
    last = point;
  });

  return { d, last };
}

/**
 * The accessible name (R25): what the line shows and the days it covers, e.g. "Riders per day,
 * Jul 25 to Jul 31, 2026". Calendar dates, read in UTC so they never shift a day (KTD17).
 */
export function sparklineLabel({ start, end }: Pick<StationSparkline, "start" | "end">): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const to = formatCalendarDate(end, { month: "short", day: "numeric", year: "numeric" });
  if (start === end) return `Riders per day, ${to}`;
  const from = formatCalendarDate(start, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `Riders per day, ${from} to ${to}`;
}

export interface SparklineProps {
  /** The list route's last seven days for the station, or null when it has no ridership. */
  sparkline: StationSparkline | null;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Seven days of riders as one ink stroke: no fill, no axes, a dot on the last day with data.
 * It draws in the current text color, so an inverted (selected) ledger row inverts it too. Pure
 * SVG, cheap enough for every row of the ledger. The date range is the image's accessible name,
 * not a hover title.
 */
export function Sparkline({ sparkline, width = 56, height = 24, className }: SparklineProps) {
  const { d, last } = sparkline ? sparklinePath(sparkline.values, width, height) : { d: "", last: null };

  if (!sparkline || !last) {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center font-mono tabular text-13 opacity-60", className)}
        style={{ width, height }}
      >
        n/a
      </span>
    );
  }

  return (
    <svg
      role="img"
      aria-label={sparklineLabel(sparkline)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible", className)}
      focusable="false"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={1.75} fill="currentColor" />
    </svg>
  );
}

export default Sparkline;
