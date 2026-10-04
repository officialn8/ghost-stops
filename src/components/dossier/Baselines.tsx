import { ArrowDown, ArrowUp, Equal } from "lucide-react";
import { LineBars } from "@/components/marks/LineBars";
import type { StationDetailResponse } from "@/types/station";
import { Section } from "./parts";
import { riders } from "./standing";

/** Differences inside this band read "about the same": a rounding away from zero. */
const SAME_BAND_PCT = 3;

interface Row {
  key: string;
  label: string;
  /** The stations behind a neighbors' average, named under the label. */
  detail?: string;
  line?: string;
  baseline: number;
  /** The station against the baseline, in percent: -38 is 38% below. */
  diff: number;
}

function difference(diff: number) {
  if (Math.abs(diff) < SAME_BAND_PCT) return { Icon: Equal, words: "about the same", amount: null };
  return diff < 0
    ? { Icon: ArrowDown, words: "below", amount: `${Math.abs(diff)}%` }
    : { Icon: ArrowUp, words: "above", amount: `${diff}%` };
}

/**
 * The station against three baselines (the system median, its primary line's median, and its
 * neighbors' average), as a number and a small direction mark, never a filled track. The
 * comparisons are on 30-day averages, so the station's own 30-day figure is stated with them.
 * Stations outside the ranking are not compared (R5).
 */
export function Baselines({ detail }: { detail: StationDetailResponse }) {
  const { comparisons: c, metrics } = detail;
  if (!metrics.ranked) return null;

  const neighbors = [c.neighbors.prev, c.neighbors.next].flatMap((n) => (n ? [n.displayName] : []));
  const rows: Row[] = [
    { key: "system", label: "System median", baseline: c.systemMedian, diff: c.vsSystemMedian },
    ...(c.primaryLine
      ? [{ key: "line", label: `${c.primaryLine} Line median`, line: c.primaryLine, baseline: c.lineMedian, diff: c.vsLineMedian }]
      : []),
    {
      key: "neighbors",
      label: "Neighbors' average",
      detail: neighbors.join(" and "),
      baseline: c.neighbors.neighborAvg,
      diff: c.vsNeighbors,
    },
  ].filter((row) => row.baseline > 0);
  if (rows.length === 0) return null;

  const own = metrics.avg30d ?? detail.station.rolling30dAvg;

  return (
    <Section title="Against baselines">
      <p className="text-13 text-ink-2">
        Riders per day over the last 30 days
        {own !== null && (
          <>
            . This station: <span className="font-mono tabular text-ink">{riders(own)}</span>
          </>
        )}
        .
      </p>
      <dl className="mt-1">
        {rows.map((row) => {
          const { Icon, words, amount } = difference(row.diff);
          return (
            <div key={row.key} className="flex items-baseline gap-3 border-b border-rule py-2.5 last:border-b-0">
              <dt className="min-w-0 flex-1 text-15">
                <span className="flex items-center gap-2">
                  {row.line && <LineBars lines={[row.line]} decorative barClassName="h-[3px] w-3" />}
                  {row.label}
                </span>
                {row.detail && <span className="block text-13 text-ink-2">{row.detail}</span>}
              </dt>{" "}
              <dd className="font-mono text-15 tabular">{riders(row.baseline)}</dd>{" "}
              <dd className="flex w-[7.5rem] shrink-0 items-center justify-end gap-1 text-13 text-ink-2">
                <Icon className="h-3.5 w-3.5 shrink-0 self-center" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">This station is </span>
                {amount && (
                  <>
                    <span className="font-mono tabular text-ink">{amount}</span>{" "}
                  </>
                )}
                {words}
              </dd>
            </div>
          );
        })}
      </dl>
    </Section>
  );
}
