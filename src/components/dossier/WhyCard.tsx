import { Fragment } from "react";
import Link from "next/link";
import { PresenceMark, TIER_LABEL } from "@/components/marks/PresenceMark";
import type { ScoreTierName, StationBadge, StationDetailResponse, WhyCard as WhyCardData, WhyPeers } from "@/types/station";
import { Chip } from "./parts";
import { closedPhrase, riders, type Standing } from "./standing";

const TIER_RANGE: Readonly<Record<ScoreTierName, string>> = {
  ghost: "scores 90 and above",
  fading: "scores 75 to 89",
  quiet: "scores 50 to 74",
  healthy: "scores below 50",
};

const BADGE: Readonly<Record<StationBadge, { label: string; note: string }>> = {
  "small-but-steady": {
    label: "Small but steady",
    note: "Far fewer riders than its peers, but it is not losing them.",
  },
  "small-but-growing": {
    label: "Small but growing",
    note: "Far fewer riders than its peers, but its ridership is growing.",
  },
};

/** "A", "A and B", "A, B, and C", as React nodes. */
function joinNodes(nodes: React.ReactNode[]): React.ReactNode {
  return nodes.map((node, i) => (
    <Fragment key={i}>
      {i > 0 && (nodes.length === 2 ? " and " : i === nodes.length - 1 ? ", and " : ", ")}
      {node}
    </Fragment>
  ));
}

/** Past this many peers (a hub's whole branch) the card counts them instead of naming each. */
const MAX_NAMED_PEERS = 8;

/** Which stations the residual compared the station with, and their baseline (KTD8). */
function Peers({ peers }: { peers: WhyPeers }) {
  if (peers.basis === "none" || peers.stations.length === 0) {
    return <p className="mt-4 text-13 text-ink-2">No station on the line qualified as a peer, so riders against peers has no value.</p>;
  }
  const names =
    peers.stations.length > MAX_NAMED_PEERS
      ? null
      : joinNodes(
          peers.stations.map((p) =>
            p.slug ? (
              <Link
                key={p.id}
                href={`/station/${p.slug}`}
                className="rounded text-ink underline decoration-ink/40 underline-offset-2 hover:decoration-ink"
              >
                {p.displayName}
              </Link>
            ) : (
              <span key={p.id} className="text-ink">
                {p.displayName}
              </span>
            ),
          ),
        );
  const line = peers.line ? `${peers.line} Line` : "line";
  const who =
    peers.basis === "loop" ? (
      <>the other Loop stations{names && <>, {names}</>}</>
    ) : peers.basis === "branch-median" ? (
      names ? (
        <>the stations on its {line} branch, {names}</>
      ) : (
        <>the {peers.stations.length} other stations on its {line} branch</>
      )
    ) : (
      <>{names ?? `${peers.stations.length} stations`}, its nearest neighbors on the {line}</>
    );

  return (
    <p className="mt-4 text-13 text-ink-2">
      Peers: {who}.
      {peers.baseline !== null && (
        <>
          {" "}
          Their median is <span className="font-mono tabular text-ink">{riders(peers.baseline)}</span> riders a day over the
          last 12 months.
        </>
      )}
    </p>
  );
}

function ComponentRows({ card }: { card: WhyCardData }) {
  return (
    <div className="mt-6">
      <div className="flex items-baseline gap-3 border-b border-rule pb-1 text-11 text-ink-2" aria-hidden>
        <span className="flex-1">Part of the score</span>
        <span className="w-12 text-right">Weight</span>
        <span className="w-[4.5rem] text-right">Percentile</span>
      </div>
      <ol aria-label="Score parts">
        {card.components.map((c) => (
          <li key={c.key} className="border-b border-rule py-3" data-component={c.key}>
            <div className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 text-15 font-medium">{c.label}</span>
              <span className="w-12 text-right font-mono text-13 tabular text-ink-2">
                <span className="sr-only">weight </span>
                {Math.round(c.weight * 100)}%
              </span>
              <span className="w-[4.5rem] text-right font-mono text-15 tabular">
                <span className="sr-only">percentile </span>
                {c.pct === null ? "n/a" : Math.round(c.pct)}
              </span>
            </div>
            {c.nullReason ? (
              <p className="mt-1.5">
                <Chip>{c.nullReason.text}</Chip>
              </p>
            ) : (
              <p className="mt-1 text-15 text-ink-2">{c.sentence}</p>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-13 text-ink-2">
        Each percentile ranks that part among the ranked stations; higher means emptier.
      </p>
    </div>
  );
}

/**
 * The "why this score" card (R18), the core of the dossier: the 0 to 100 score, shown here and
 * nowhere else (R26), with its tier and the 30-day average (KTD18); the small-station badge and the
 * data-quality chips; one row per component with its weight, its percentile, and its sentence, or
 * the reason it has no value as a chip (R16); and the peers the residual used.
 *
 * Variants: a closed station states its closure and has no component rows; a station with no
 * recent riders states why it is not ranked and keeps its rows, without percentiles.
 */
export function WhyCard({
  card,
  detail,
  standing,
}: {
  card: WhyCardData | null;
  detail: StationDetailResponse;
  standing: Standing;
}) {
  if (card === null) {
    return <p className="text-15 text-ink-2">Score details are not available yet.</p>;
  }

  const name = detail.station.displayName;

  if (standing.kind === "closed") {
    const chips = card.chips.filter((chip) => chip.kind !== "closed");
    return (
      <div>
        <p className="text-15">
          {name} has been {closedPhrase(standing.since, standing.temporary)}. Closed stations are left out of the ranking,
          so it has no score.
        </p>
        {chips.length > 0 && (
          <ul aria-label="Data notes" className="mt-3 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <li key={chip.kind}>
                <Chip>{chip.text}</Chip>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const badge = card.badge ? BADGE[card.badge] : null;
  const avg30d = detail.metrics.avg30d;

  return (
    <div>
      {standing.kind === "no-data" ? (
        <p className="text-15">{name} has no riders in recent data, so it is left out of the ranking and has no score.</p>
      ) : (
        <dl className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <dt className="text-13 text-ink-2">Ghost score</dt>
            <dd>
              <span className="font-mono text-36 tabular">{card.score === null ? "n/a" : card.score}</span>{" "}
              <span className="text-13 text-ink-2">of 100</span>
            </dd>
          </div>
          {avg30d !== null && (
            <div>
              <dt className="text-13 text-ink-2">30-day average</dt>
              <dd>
                <span className="font-mono text-18 tabular">{riders(avg30d)}</span>{" "}
                <span className="text-13 text-ink-2">riders a day</span>
              </dd>
            </div>
          )}
        </dl>
      )}
      {standing.kind === "ranked" && (
        <p className="mt-2 flex items-center gap-2 text-13">
          <PresenceMark tier={standing.tier} size={10} className="shrink-0" />
          <span>
            {TIER_LABEL[standing.tier]} tier, {TIER_RANGE[standing.tier]}.{" "}
            <span className="text-ink-2">100 is the emptiest station for its context, 0 the busiest.</span>
          </span>
        </p>
      )}
      {(badge || card.chips.length > 0) && (
        <ul aria-label="Data notes" className="mt-4 flex flex-wrap gap-2">
          {badge && (
            <li>
              <Chip strong>{badge.label}</Chip>
            </li>
          )}
          {card.chips.map((chip) => (
            <li key={chip.kind}>
              <Chip>{chip.text}</Chip>
            </li>
          ))}
        </ul>
      )}
      {badge && <p className="mt-2 text-13 text-ink-2">{badge.note}</p>}
      <ComponentRows card={card} />
      <Peers peers={card.peers} />
    </div>
  );
}
