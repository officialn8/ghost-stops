import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { CountOnce } from "@/components/dossier/CountOnce";
import { linkClass, Section } from "@/components/dossier/parts";
import type { LedgerStation } from "@/components/ledger/useLedgerModel";
import { PresenceMark, TIER_LABEL } from "@/components/marks/PresenceMark";
import { CTA_RIDERSHIP_URL } from "@/lib/site";
import { ordinal } from "@/lib/stations/metadata";
import type { ScoreTierName, StationListItem, StationListResponse } from "@/types/station";
import { KeyLine, KeyRow, Meaning, Mono, Term } from "./key";
import { MethodBar } from "./MethodBar";
import { RowKey } from "./RowKey";

/**
 * The method page: the ledger's figures explained from one live row, then how the score is
 * built, which stations are ranked, where the data comes from, and how to fetch it. A reading
 * page in the shell's world, without the shell: one centered reading column, 640px wide, that
 * every section shares, so the page has a single left edge from the title to the last link. The
 * real ledger row runs the column's full width and stays pinned at the top of the viewport while
 * its key reads beneath it. Every key is a list of terms over their meanings, so a sentence gets
 * the column's whole measure; explanations sit at full ink, and Ink 2 is kept for the lede, the
 * headings, the weights, and the card quotes. Hairline sections, every number in mono. The
 * example station is the first fading one, whose score and rank are both mid-range, falling back
 * to rank 1.
 *
 * The page teaches by showing: pointing at a term lights the part of the row it names (RowKey),
 * the mark's sentence draws the marks it describes, the sign excerpt's number counts up once as
 * the real sign does, and a contents line under the lede names the seven sections.
 */

/** The sections, in reading order, for the contents line under the lede. */
const CONTENTS: readonly { id: string; label: string }[] = [
  { id: "row", label: "The row" },
  { id: "sign", label: "The sign" },
  { id: "parts", label: "The four parts" },
  { id: "tiers", label: "Tiers" },
  { id: "ranked", label: "Who is ranked" },
  { id: "data", label: "The data" },
  { id: "api", label: "The API" },
];

const PARTS: readonly { part: string; weight: string; sentence: string; asks: string }[] = [
  {
    part: "Riders against peers",
    weight: "45%",
    sentence: "Gets X% of the riders its neighbors get",
    asks: "The station's 12-month average against the median of its nearest ranked stations along its primary line. A Loop station's peers are the other Loop stations. Being a terminal or a transfer only chooses the peers; it never adds points.",
  },
  {
    part: "Change from last year",
    weight: "25%",
    sentence: "Down X% from the same period last year",
    asks: "The last 90 days against the same 90 days a year earlier, weekdays and weekends compared separately so a shift in the mix does not read as a decline.",
  },
  {
    part: "Change since 2019",
    weight: "20%",
    sentence: "Carries X% fewer riders than in 2019",
    asks: "The 12-month average against the station's own 2019 average, the last full year before the pandemic.",
  },
  {
    part: "Day-to-day swings",
    weight: "10%",
    sentence: "Ridership swings about X% day to day",
    asks: "How erratic the daily entries are: the typical day's distance from the median, as a share of the median, by day type.",
  },
];

const TIERS: readonly { tier: ScoreTierName; range: string }[] = [
  { tier: "ghost", range: "scores 90 and above" },
  { tier: "fading", range: "scores 75 to 89" },
  { tier: "quiet", range: "scores 50 to 74" },
  { tier: "healthy", range: "scores below 50" },
];

/** The first fading station in rank order, else the first ranked one; null when nothing is ranked. */
export function exampleStation(stations: readonly StationListItem[]): LedgerStation | null {
  const ranked = stations.filter((s): s is LedgerStation => s.slug !== null && s.rank !== null);
  return ranked.find((s) => s.tier === "fading") ?? ranked[0] ?? null;
}

export function MethodPage({ list }: { list: StationListResponse | null }) {
  const stations = list?.stations ?? [];
  const example = exampleStation(stations);
  const total = stations.filter((s) => s.slug !== null).length;
  const rankedTotal = stations.filter((s) => s.slug !== null && s.rank !== null).length;
  const rankedCount = example?.rankedCount ?? rankedTotal;

  return (
    <div className="min-h-dvh bg-surface text-ink">
      <MethodBar dataThrough={list?.dataThrough ?? null} />
      <main className="mx-auto w-full max-w-[640px] px-4 pb-16 pt-8">
        <h1 className="text-24 font-semibold">How the Ghost score works</h1>
        <p className="mt-2 text-15 text-ink-2">
          Every figure in the ledger and on a station&apos;s sign, explained from one real row, then the score, the
          data behind it, and how to get the data yourself.
        </p>
        <nav aria-label="On this page" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-13">
          {CONTENTS.map(({ id, label }) => (
            <a key={id} href={`#${id}`} className={linkClass}>
              {label}
            </a>
          ))}
        </nav>

        <Section id="row" title="A row of the ledger" className="mt-12 scroll-mt-4">
          {example ? (
            <RowKey station={example} rankedCount={rankedCount} />
          ) : (
            <p className="text-15 text-ink-2">The station list is not available right now, so there is no row to show.</p>
          )}
        </Section>

        <Section id="sign" title="The sign at the top of a station's page" className="mt-12 scroll-mt-4">
          {example && (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              {example.avg12m !== null && (
                <p className="font-mono text-56 tabular tracking-tight">
                  <CountOnce value={example.avg12m} />
                </p>
              )}
              {example.tier && example.rank !== null && (
                <div className="pb-1.5">
                  <p className="flex items-center gap-2 text-18 font-medium">
                    <PresenceMark tier={example.tier} size={12} className="shrink-0" />
                    {TIER_LABEL[example.tier]}
                  </p>
                  <p className="text-13 text-ink-2">
                    <Mono>{ordinal(example.rank)}</Mono> of <span className="font-mono tabular">{rankedCount}</span> ranked
                  </p>
                </div>
              )}
            </div>
          )}
          <dl className="mt-2">
            <KeyRow>
              <Term>The number</Term>
              <Meaning>The same riders per day as the ledger, over the last 12 months, counted up once when the page opens.</Meaning>
            </KeyRow>
            <KeyRow>
              <Term>Tier and rank</Term>
              <Meaning>
                The tier word with its mark, and the rank among the ranked stations. The score itself waits in the
                &ldquo;why&rdquo; card below the sign, beside the four parts that produced it.
              </Meaning>
            </KeyRow>
          </dl>
        </Section>

        <Section id="parts" title="The four parts of the score" className="mt-16 scroll-mt-4">
          <p className="text-15">
            Each part becomes a percentile among the ranked stations, so a higher number always means emptier, and each
            writes one sentence on the station&apos;s card.
          </p>
          <dl className="mt-3">
            {PARTS.map((p) => (
              <div key={p.part} className="border-b border-rule py-3">
                <div className="flex items-baseline gap-3">
                  <dt className="min-w-0 flex-1 text-15 font-medium">{p.part}</dt>
                  <dd className="font-mono text-13 tabular text-ink-2">
                    <span className="sr-only">weight </span>
                    {p.weight}
                  </dd>
                </div>
                <dd className="mt-1 text-15">{p.asks}</dd>
                <dd className="mt-1 text-13 text-ink-2">
                  On the card: &ldquo;{p.sentence}&rdquo;
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-15">
            The weighted sum is ranked again, which is why the score is itself a percentile: <Mono>100</Mono> for the
            emptiest station for its context and <Mono>0</Mono> for the busiest, whatever the season or the year. A
            part with no value counts as <Mono>50</Mono>.
          </p>
          <p className="mt-4 text-15">
            A part is set aside, and the card says why, when its window overlaps a closure or reaches back before the
            station opened. The change from last year is also set aside when a station next door closed or reopened
            between the two windows, because the riders it moved make the years incomparable.
          </p>
        </Section>

        <Section id="tiers" title="Tiers" className="mt-12 scroll-mt-4">
          <dl>
            {TIERS.map(({ tier, range }) => (
              <KeyLine key={tier}>
                <Term>
                  <span className="inline-flex items-center gap-2">
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      <PresenceMark tier={tier} size={12} />
                    </span>
                    {TIER_LABEL[tier]}
                  </span>
                </Term>
                <dd className="text-15">{range}</dd>
              </KeyLine>
            ))}
          </dl>
          <p className="mt-4 text-15">
            The bands are fixed, so the top tier is always the emptiest tenth of the ranked stations. A healthy station
            is never called a ghost; its page tells a story of growth or stability instead.
          </p>
        </Section>

        <Section id="ranked" title="Who is ranked" className="mt-12 scroll-mt-4">
          <p className="text-15">
            A station is ranked when it is open and has riders in recent data.
            {total > 0 && (
              <>
                {" "}
                Today <Mono>{rankedTotal}</Mono> of <Mono>{total}</Mono> stations are ranked.
              </>
            )}{" "}
            The rest stay in the ledger&apos;s trailing sections, on the map, and on their own pages, with their status
            in place of a score:
          </p>
          <dl className="mt-2">
            <KeyRow>
              <Term>
                <span className="inline-flex items-center gap-2">
                  <span className="flex w-4 shrink-0 items-center justify-center">
                    <PresenceMark tier={null} excluded="closed" size={12} />
                  </span>
                  Closed
                </span>
              </Term>
              <Meaning>Closed for good or for now. The page says since when.</Meaning>
            </KeyRow>
            <KeyRow>
              <Term>
                <span className="inline-flex items-center gap-2">
                  <span className="flex w-4 shrink-0 items-center justify-center">
                    <PresenceMark tier={null} excluded="no-data" size={12} />
                  </span>
                  No recent data
                </span>
              </Term>
              <Meaning>Open, but with no riders recorded in recent data. Ranked again when riders appear.</Meaning>
            </KeyRow>
          </dl>
          <p className="mt-4 text-15">
            Stations outside the ranking get no score, rank, or tier and take no part in any comparison, including as
            another station&apos;s peer.
          </p>
        </Section>

        <Section id="data" title="The data" className="mt-16 scroll-mt-4">
          <p className="text-15">
            Every number comes from the{" "}
            <a href={CTA_RIDERSHIP_URL} target="_blank" rel="noopener noreferrer" className={`${linkClass} inline-flex items-center gap-1`}>
              CTA&apos;s daily station entries
              <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden />
            </a>{" "}
            on the Chicago Data Portal: the count of riders entering each station through its fare gates, each day,
            back to <Mono>2001</Mono>. An entry is a rider who paid to enter, so a station where more riders enter
            without paying undercounts.
          </p>
          <p className="mt-4 text-15">
            CTA publishes the entries about two months after the fact, in monthly batches on no announced schedule.
            This site checks every morning, refetches the last 60 days so CTA&apos;s revisions are absorbed, and once a
            week compares every month it holds against CTA&apos;s.
            {list?.dataThrough && (
              <>
                {" "}
                The data runs through{" "}
                <time className="font-mono tabular text-ink" dateTime={list.dataThrough}>
                  {list.dataThrough}
                </time>
                .
              </>
            )}
          </p>
        </Section>

        <Section id="api" title="The API" className="mt-12 scroll-mt-4">
          <p className="text-15">
            The same numbers the pages show, as JSON, with no key. Dates are calendar strings, and both routes carry
            the data-through date.
          </p>
          <dl className="mt-2">
            <div className="border-b border-rule py-3">
              <dt className="font-mono text-15 tabular">GET /api/chicago/stations</dt>
              <dd className="mt-1 text-15">
                Every station, rank 1 first, with its tier, rank, score, 12-month and 30-day averages, last week, and
                lines.
              </dd>
            </div>
            <div className="border-b border-rule py-3">
              <dt className="font-mono text-15 tabular">GET /api/chicago/stations/&#123;slug&#125;</dt>
              <dd className="mt-1 text-15">
                One station: its 91-day series, the comparisons, the four parts with their numbers and the peers used,
                the story, and the sources. The slug is the one in the station&apos;s page address.
              </dd>
            </div>
            <div className="border-b border-rule py-3">
              <dt className="font-mono text-15 tabular">GET /api/health</dt>
              <dd className="mt-1 text-15">
                Whether the daily refresh is current. It answers an error status when no refresh has succeeded in ten
                days.
              </dd>
            </div>
          </dl>
        </Section>

        <p className="mt-8 text-13 text-ink-2">
          <Link href="/" className={linkClass}>
            Back to the map
          </Link>
        </p>
      </main>
    </div>
  );
}
