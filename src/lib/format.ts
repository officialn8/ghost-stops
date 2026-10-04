/**
 * Pure text formatters with no imports, shared by the narratives and the score card so both quote
 * one number the same way.
 *
 * CONVENTION: Percents are stored as decimals (0.52 = 52%).
 */

/**
 * Format a decimal as a percentage.
 * Examples: 0.52 → "52%", -0.12 → "-12%", 0.1567 → "16%"
 *
 * CONVENTION: Input is a decimal (0.52 = 52%), output is "52%"
 */
export function formatPercent(value: number, decimals = 0): string {
  const { formatted, sign } = roundPercent(value, decimals);
  return sign < 0 ? `-${formatted}%` : `${formatted}%`;
}

/**
 * A decimal as a rounded, unsigned percentage, and the sign of what is shown: a value that
 * rounds to zero has sign 0, so it never prints as "-0%" or "+0%".
 */
function roundPercent(value: number, decimals: number): { formatted: string; sign: -1 | 0 | 1 } {
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(value * 100) * factor) / factor;
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return { formatted, sign: rounded === 0 ? 0 : value < 0 ? -1 : 1 };
}

/**
 * Format a change percentage with explicit sign.
 * Examples: 0.12 → "+12%", -0.12 → "-12%", 0 → "0%"
 *
 * Use this for change metrics where direction matters.
 */
export function formatPercentChange(value: number, decimals = 0): string {
  const { formatted, sign } = roundPercent(value, decimals);
  if (sign > 0) return `+${formatted}%`;
  if (sign < 0) return `-${formatted}%`;
  return `${formatted}%`;
}

/**
 * Whether a change reads as level: exactly when `formatChange` prints it as "0%", under 0.05
 * percentage points either way. The score card's "Unchanged" and the narratives' direction (their
 * archetype and their gaining or losing wording) both read this one band, so a story never says
 * "losing riders" beside a card that says "Unchanged".
 *
 * CONVENTION: Input is a decimal (0.0004 = 0.04%).
 */
export function isLevelChange(value: number): boolean {
  return Math.round(Math.abs(value * 100) * 10) === 0;
}

/**
 * A change as narratives and the score card show it: always signed, in whole percents, with one
 * decimal when a whole percent would read as zero, so a small rise still shows as one.
 * Examples: 0.0398 → "+4%", -0.384 → "-38%", 0.003 → "+0.3%", 0.0004 → "0%"
 */
export function formatChange(value: number): string {
  if (isLevelChange(value)) return "0%";
  return formatPercentChange(value, Math.round(Math.abs(value * 100)) >= 1 ? 0 : 1);
}

/** One formatter per option set: building an Intl.DateTimeFormat costs far more than using one. */
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", options);
    dateFormats.set(key, format);
  }
  return format;
}

/**
 * A YYYY-MM-DD calendar date in US English, read and printed in UTC so it never shifts a day
 * (KTD17): `{ month: "short", year: "numeric" }` gives "Jul 2025".
 */
export function formatCalendarDate(
  date: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone">,
): string {
  return dateFormat({ ...options, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** "Jan 2026", for a calendar date. */
export function formatMonthYear(date: string): string {
  return formatCalendarDate(date, { month: "short", year: "numeric" });
}

/** "May 2 to Jul 31, 2026", or "Nov 2, 2025 to Jan 31, 2026" across a new year. */
export function formatDateRange(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const from = formatCalendarDate(start, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `${from} to ${formatCalendarDate(end, { month: "short", day: "numeric", year: "numeric" })}`;
}

/**
 * "Sep 20, 2026": the day an instant (an ISO timestamp, such as a sync run's finish) fell on in
 * Chicago, where the data and its readers are.
 */
export function formatChicagoDay(iso: string): string {
  return dateFormat({ month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }).format(new Date(iso));
}

/** Riders as a whole number with thousands separators: 1,782. */
export function formatRiders(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** "Green Line", or "Brown, Green, Orange, Purple, Pink Lines". */
export function linesLabel(lines: readonly string[]): string {
  return `${lines.join(", ")} ${lines.length === 1 ? "Line" : "Lines"}`;
}
