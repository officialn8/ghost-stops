import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LineBars } from "@/components/marks/LineBars";
import { PresenceMark, TIER_LABEL } from "@/components/marks/PresenceMark";
import type { NeighborEntry, StationDetailResponse } from "@/types/station";
import { Section } from "./parts";
import { closedLabel, neighborStanding } from "./standing";

function NeighborStatus({ neighbor }: { neighbor: NeighborEntry }) {
  const standing = neighborStanding(neighbor);
  const [mark, label] =
    standing.kind === "ranked"
      ? [<PresenceMark key="mark" tier={standing.tier} size={10} />, TIER_LABEL[standing.tier]]
      : standing.kind === "closed"
        ? [<PresenceMark key="mark" tier={null} excluded="closed" size={10} />, closedLabel(standing.since, standing.temporary)]
        : [<PresenceMark key="mark" tier={null} excluded="no-data" size={10} />, "No recent data"];
  return (
    <span className="flex shrink-0 items-center gap-2 text-13">
      {mark}
      {label}
    </span>
  );
}

function NeighborRow({ direction, neighbor, line }: { direction: string; neighbor: NeighborEntry; line: string }) {
  const content = (
    <>
      <LineBars lines={[line]} decorative barClassName="h-9 w-1" />
      <span className="min-w-0 flex-1">
        <span className="block text-13 text-ink-2">{direction}</span>
        <span className="block truncate font-narrow text-18 font-semibold">{neighbor.displayName}</span>
      </span>
      <NeighborStatus neighbor={neighbor} />
    </>
  );
  const row = "flex min-h-16 w-full items-center gap-3 border-b border-rule px-2 py-3";
  if (!neighbor.slug) return <div className={row}>{content}</div>;
  return (
    <Link href={`/station/${neighbor.slug}`} className={`${row} hover:bg-ink/[.06] active:bg-ink/[.08]`}>
      {content}
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

/**
 * The previous and next stations on the primary line as two full-width rows with the line's bar
 * and each station's standing. Every row is a link that pushes history, so back returns here; a
 * closed or no-data neighbor shows its status and opens its own closure dossier (R24, AE2).
 */
export function AlongTheLine({ detail }: { detail: StationDetailResponse }) {
  const { primaryLine, lineNeighbors } = detail.comparisons;
  const rows = [
    { direction: "Previous stop", neighbor: lineNeighbors.prev },
    { direction: "Next stop", neighbor: lineNeighbors.next },
  ].flatMap((r) => (r.neighbor ? [{ ...r, neighbor: r.neighbor }] : []));
  if (!primaryLine || rows.length === 0) return null;

  return (
    <Section title={`Along the ${primaryLine} Line`}>
      <ul className="border-t border-rule">
        {rows.map((r) => (
          <li key={r.direction}>
            <NeighborRow direction={r.direction} neighbor={r.neighbor} line={primaryLine} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
