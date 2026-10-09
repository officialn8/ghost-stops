"use client";

import Link from "next/link";
import { ChevronRight, ExternalLink, TriangleAlert } from "lucide-react";
import { useShell } from "@/components/shell/ShellContext";
import { formatChicagoDay } from "@/lib/format";
import { CTA_RIDERSHIP_URL } from "@/lib/site";
import type { DataSourceInfo } from "@/types/narrative";
import type { StationDetailResponse } from "@/types/station";
import { linkClass, Section } from "./parts";

const CADENCE: Readonly<Record<NonNullable<DataSourceInfo["refreshCadence"]>, string>> = {
  daily: "updated daily",
  annual: "updated yearly",
  static: "fixed",
};

/**
 * Where the numbers come from (R13). CTA's publishing lag is stated on its own, with the
 * data-through date as a calendar string (AE6), so a two-month-old date never reads as a failure.
 * A failed refresh is a separate sentence, shown on the shell's one freshness signal: the last
 * successful refresh is more than ten days old. The sources of the station's facts follow as a disclosure.
 */
export function Sources({ detail }: { detail: StationDetailResponse }) {
  const { list } = useShell();
  const stale = list.status === "ready" && list.stale;
  const cited = detail.sources ?? [];

  return (
    <Section title="Sources">
      <p className="text-15 text-ink-2">
        Ridership from the{" "}
        <a href={CTA_RIDERSHIP_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
          CTA&apos;s daily station entries
        </a>
        , published about two months after the fact
        {detail.dataThrough && (
          <>
            {" "}
            (data through{" "}
            <time dateTime={detail.dataThrough} className="font-mono tabular text-ink">
              {detail.dataThrough}
            </time>
            )
          </>
        )}
        .
      </p>
      <p className="mt-2 text-13 text-ink-2">
        <Link href="/method" className={linkClass}>
          How the Ghost score works
        </Link>
      </p>
      {stale && (
        <p className="mt-3 flex items-start gap-2 text-15">
          <TriangleAlert className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {detail.lastSuccessfulFetch
            ? `The last successful refresh was on ${formatChicagoDay(detail.lastSuccessfulFetch)}.`
            : "No refresh has succeeded yet."}
        </p>
      )}
      {cited.length > 0 && (
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-13 text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" strokeWidth={1.75} aria-hidden />
            Sources for the station facts ({cited.length})
          </summary>
          <ul className="mt-2 space-y-2 pl-[18px]">
            {cited.map((source) => (
              <li key={source.code} className="text-13">
                <a href={source.url} target="_blank" rel="noopener noreferrer" className={`${linkClass} inline-flex items-center gap-1`}>
                  {source.name}
                  <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden />
                </a>
                {source.refreshCadence && <span className="text-ink-2">, {CADENCE[source.refreshCadence]}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
