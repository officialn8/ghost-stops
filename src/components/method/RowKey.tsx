"use client";

import { useState } from "react";
import type { RowCell } from "@/components/ledger/LedgerRow";
import type { LedgerStation } from "@/components/ledger/useLedgerModel";
import { LineBars } from "@/components/marks/LineBars";
import { PresenceMark, TIER_LABEL } from "@/components/marks/PresenceMark";
import { formatCalendarDate, formatRiders, linesLabel } from "@/lib/format";
import { ordinal } from "@/lib/stations/metadata";
import type { ScoreTierName } from "@/types/station";
import { AnnotatedRow } from "./AnnotatedRow";
import { KeyRow, Meaning, Mono, Term } from "./key";

/** Which cells of the row each entry explains, in the row's reading order. Constant, so the memoized row sees stable props. */
const CELLS = {
  rank: ["rank"],
  score: ["score"],
  mark: ["mark"],
  name: ["name", "lines"],
  week: ["spark"],
  riders: ["riders"],
} as const satisfies Record<string, readonly RowCell[]>;

/** A tier's mark drawn beside the words that name it, so the sentence shows what it says. */
function Glyph({ tier, children }: { tier: ScoreTierName; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <PresenceMark tier={tier} size={10} className="shrink-0" />
      {children}
    </span>
  );
}

/**
 * The row and its key. The real ledger row stays pinned at the top of the viewport while the key
 * reads beneath it, and pointing at an entry lights the cell it explains: every other cell of the
 * row fades to 35%, the Ink Presence Rule turned into an interaction, so the reader sees which
 * part of the sign a term means without a second diagram. The words carry the meaning on their
 * own; the spotlight is a pointer affordance, and the keyboard path loses nothing.
 */
export function RowKey({ station, rankedCount }: { station: LedgerStation; rankedCount: number }) {
  const [spotlight, setSpotlight] = useState<readonly RowCell[] | null>(null);
  const week = station.sparkline;
  const lastDay = week ? (week.values[week.values.length - 1] ?? null) : null;
  const point = (cells: readonly RowCell[]) => ({
    onPointerEnter: () => setSpotlight(cells),
    onPointerLeave: () => setSpotlight(null),
  });

  return (
    <div>
      <p className="text-13 text-ink-2">
        Each term below lights its part of the row. The row itself opens {station.displayName}.
      </p>
      {/* The row stays pinned at the top of the viewport while its key reads beneath it. */}
      <div className="sticky top-0 mt-3 bg-surface pb-2">
        <AnnotatedRow station={station} spotlight={spotlight} />
      </div>
      <dl>
        <KeyRow {...point(CELLS.rank)}>
          <Term>Rank</Term>
          <Meaning>
            Where the station stands among the <Mono>{rankedCount}</Mono> ranked stations; 1 is the most ghost-like.{" "}
            {station.displayName} is <Mono>{ordinal(station.rank ?? 0)}</Mono>.
          </Meaning>
        </KeyRow>
        <KeyRow {...point(CELLS.score)}>
          <Term>Ghost score</Term>
          <Meaning>
            A percentile over the same stations, from 0 to 100: 100 is the emptiest station for its context, 0 the
            busiest. {station.displayName} scores <Mono>{station.score}</Mono>.
          </Meaning>
        </KeyRow>
        <KeyRow {...point(CELLS.mark)}>
          <Term>The mark</Term>
          <Meaning>
            The tier at a glance, in ink rather than color: <Glyph tier="healthy">a solid dot for healthy</Glyph>,{" "}
            <Glyph tier="quiet">a ring for quiet</Glyph>, <Glyph tier="fading">a fainter ring for fading</Glyph>,{" "}
            <Glyph tier="ghost">a small ghost for a ghost stop</Glyph>. {station.displayName} is{" "}
            <span className="inline-flex items-center gap-1.5 text-ink">
              {station.tier && <PresenceMark tier={station.tier} size={12} />}
              {station.tier ? TIER_LABEL[station.tier].toLowerCase() : "unranked"}
            </span>
            .
          </Meaning>
        </KeyRow>
        <KeyRow {...point(CELLS.name)}>
          <Term>Name and lines</Term>
          <Meaning>
            The station, over a bar in the official color of each line it serves:{" "}
            <span className="inline-flex items-center gap-2 text-ink">
              <LineBars lines={station.lines} decorative barClassName="h-[3px] w-4" />
              {linesLabel(station.lines)}
            </span>
            .
          </Meaning>
        </KeyRow>
        <KeyRow {...point(CELLS.week)}>
          <Term>Last week</Term>
          <Meaning>
            Seven days of riders as one stroke, scaled to the week&apos;s own low and high, with a dot on the last day. A
            break is a day with no data, never a zero.
            {week && lastDay !== null && (
              <>
                {" "}
                On <Mono>{formatCalendarDate(week.end, { month: "short", day: "numeric" })}</Mono>, the stroke&apos;s last
                day, {station.displayName} had <Mono>{formatRiders(lastDay)}</Mono>.
              </>
            )}
          </Meaning>
        </KeyRow>
        <KeyRow {...point(CELLS.riders)}>
          <Term>Riders per day</Term>
          <Meaning>
            The average daily entries over the last 12 months, the figure the peers comparison uses.{" "}
            {station.displayName} averages <Mono>{station.avg12m === null ? "n/a" : formatRiders(station.avg12m)}</Mono>.
          </Meaning>
        </KeyRow>
      </dl>
    </div>
  );
}
