"use client";

import type { Ref } from "react";
import { LineBars } from "@/components/marks/LineBars";
import { PresenceMark, TIER_LABEL } from "@/components/marks/PresenceMark";
import { ordinal } from "@/lib/stations/metadata";
import type { StationDetailResponse } from "@/types/station";
import { CountOnce } from "./CountOnce";
import { closedLabel, linesLabel, stationTags, type Standing } from "./standing";

/**
 * The top of the dossier, set like a platform sign: the station name in the condensed cut, its line
 * bars, and the Transfer or Terminal tag; then the number (12-month riders per day, the ledger's
 * figure, R25) with the tier word and rank beside it (R26). A closed or no-data station shows its
 * status and date where the tier and rank would be.
 *
 * The heading takes focus when the dossier opens (R28).
 */
export function SignHeader({
  detail,
  standing,
  headingRef,
}: {
  detail: StationDetailResponse;
  standing: Standing;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const { displayName, lines } = detail.station;
  const tags = stationTags(detail);

  return (
    <header>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="break-words font-narrow text-36 font-bold uppercase"
        data-dossier-heading
      >
        {displayName}
      </h1>
      {(lines.length > 0 || tags.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {lines.length > 0 && (
            <span className="flex items-center gap-2.5">
              <LineBars lines={lines} decorative barClassName="h-1 w-8" />
              <span className="text-13 text-ink-2">{linesLabel(lines)}</span>
            </span>
          )}
          {tags.map((tag) => (
            <span key={tag} className="rounded border border-rule px-1.5 text-11 text-ink-2">
              {tag}
            </span>
          ))}
        </div>
      )}
      <Headline detail={detail} standing={standing} />
    </header>
  );
}

function RidersNumber({ value }: { value: number }) {
  return (
    <p className="font-mono text-56 tabular tracking-tight">
      <CountOnce value={value} />
    </p>
  );
}

function Headline({ detail, standing }: { detail: StationDetailResponse; standing: Standing }) {
  const avg12m = detail.metrics.avg12m;

  if (standing.kind === "closed") {
    return (
      <div className="mt-6">
        <p className="flex items-center gap-2.5 text-24 font-medium">
          <PresenceMark tier={null} excluded="closed" size={16} className="shrink-0" />
          {closedLabel(standing.since, standing.temporary)}
        </p>
        <p className="mt-1 text-13 text-ink-2">Closed stations are not ranked against the others.</p>
      </div>
    );
  }

  const status =
    standing.kind === "ranked" ? (
      <div className="pb-1.5">
        <p className="flex items-center gap-2 text-18 font-medium">
          <PresenceMark tier={standing.tier} size={12} className="shrink-0" />
          {TIER_LABEL[standing.tier]}
        </p>
        <p className="text-13 text-ink-2">
          <span className="font-mono tabular text-ink">{ordinal(standing.rank)}</span> of{" "}
          <span className="font-mono tabular">{standing.rankedCount}</span> ranked
        </p>
      </div>
    ) : standing.kind === "no-data" ? (
      <div className="pb-1.5">
        <p className="flex items-center gap-2 text-18 font-medium">
          <PresenceMark tier={null} excluded="no-data" size={12} className="shrink-0" />
          No recent data
        </p>
        <p className="text-13 text-ink-2">
          {standing.lastDay ? (
            <>
              Last riders recorded <span className="font-mono tabular">{standing.lastDay}</span>
            </>
          ) : (
            "Not ranked until riders appear again"
          )}
        </p>
      </div>
    ) : (
      <p className="pb-1.5 text-13 text-ink-2">Not ranked yet</p>
    );

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {avg12m !== null && <RidersNumber value={avg12m} />}
        {status}
      </div>
      {avg12m !== null && <p className="mt-1 text-13 text-ink-2">Riders per day over the last 12 months.</p>}
      <p className="text-13 text-ink-2">
        {standing.kind === "no-data"
          ? "Stations without recent riders are not ranked against the others."
          : "Tiers compare each station with the other ranked stations."}
      </p>
    </div>
  );
}
