import { ChevronRight, ExternalLink } from "lucide-react";
import { linkClass } from "@/components/dossier/parts";
// The formatters module, not the narratives index, so the archetype tables stay off the client.
import { formatTimeframe, getFactLabel } from "@/lib/narratives/formatters";
import type { FactKey, FactValue, Geography } from "@/types/narrative";

const WHERE: Readonly<Record<Geography, string>> = {
  station: "at the station",
  "walkshed_0.5mi": "within half a mile",
  region_il: "across Illinois",
};

/** "2001", "2010 to 2024", "since 2001", or nothing when the fact has no timeframe. */
function timeframe(start?: number | null, end?: number | null): string | null {
  return start == null && end == null ? null : formatTimeframe(start, end);
}

/**
 * One evidence fact as a definition-list row: its label with when and where it was measured, its
 * value, and its method and source in a disclosure that opens by tap or keyboard (no hover-only
 * affordance). Renders a `<div>` of `<dt>`/`<dd>`, so it belongs inside a `<dl>`.
 */
export function FactCard({ factKey, fact }: { factKey: FactKey; fact: FactValue & { label?: string } }) {
  const label = fact.label ?? getFactLabel(factKey);
  const context = [timeframe(fact.timeframeStart, fact.timeframeEnd), WHERE[fact.geography]].filter(Boolean).join(", ");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-rule py-2.5">
      <dt className="text-15">
        {label}
        {context && <span className="block text-13 text-ink-2">{context}</span>}
      </dt>
      <dd className="text-right font-mono text-15 tabular">{fact.displayValue}</dd>
      <dd className="col-span-2 mt-1">
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-13 text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" strokeWidth={1.75} aria-hidden />
            Method and source
          </summary>
          <div className="mt-1.5 space-y-1 pl-[18px] text-13 text-ink-2">
            <p>{fact.methodology}</p>
            {fact.sourceNote && <p>{fact.sourceNote}</p>}
            {fact.qualityNote && <p>{fact.qualityNote}</p>}
            <p>
              <a
                href={fact.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${linkClass} inline-flex items-center gap-1`}
              >
                {fact.source.name}
                <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden />
              </a>
            </p>
          </div>
        </details>
      </dd>
    </div>
  );
}
