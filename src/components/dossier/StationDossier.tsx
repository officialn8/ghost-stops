"use client";

import { useEffect, useRef } from "react";
import { StationStory } from "@/components/narrative";
import type { StationDetailResponse } from "@/types/station";
import { AlongTheLine } from "./AlongTheLine";
import { Baselines } from "./Baselines";
import { BackToMap, CloseDrawer } from "./CloseControls";
import { Section } from "./parts";
import { RidershipChart } from "./RidershipChart";
import { SignHeader } from "./SignHeader";
import { Sources } from "./Sources";
import { standingOf } from "./standing";
import { WhyCard } from "./WhyCard";

/**
 * A station's dossier (U21), the drawer's content from 768px and the page below the 28vh map on a
 * phone. One order everywhere (docs/audit-2026-10-02/design.md, Direction A): the sign header with
 * the number, the baselines, why it ranks where it does (the card, then the story), the last 90
 * days, the stations either side, and the sources. Closed and no-data stations keep the order,
 * with their status in place of the tier and rank and no comparisons.
 *
 * Focus moves to the station name when the dossier opens (R28); the shell returns it to the ledger
 * on close.
 */
export function StationDossier({ detail }: { detail: StationDetailResponse }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const standing = standingOf(detail);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <article className="px-5 pb-16">
      <div className="sticky top-0 z-chrome -mx-5 flex h-14 items-center justify-between bg-surface px-5">
        <BackToMap />
        <span className="ml-auto">
          <CloseDrawer />
        </span>
      </div>
      <SignHeader detail={detail} standing={standing} headingRef={headingRef} />
      <Baselines detail={detail} />
      <Section title={standing.kind === "closed" || standing.kind === "no-data" ? "Why it is not ranked" : "Why it ranks here"}>
        <WhyCard card={detail.whyCard} detail={detail} standing={standing} />
        {detail.narrative && (
          <div className="mt-6 border-t border-rule pt-5">
            <StationStory narrative={detail.narrative} facts={detail.facts} />
          </div>
        )}
      </Section>
      {detail.series && (
        <Section title="Last 90 days">
          <RidershipChart series={detail.series} line={detail.comparisons.primaryLine} />
        </Section>
      )}
      <AlongTheLine detail={detail} />
      <Sources detail={detail} />
    </article>
  );
}
