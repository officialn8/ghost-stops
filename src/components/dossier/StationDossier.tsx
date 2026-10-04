"use client";

import { useEffect, useRef } from "react";
import type { StationDetailResponse } from "@/types/station";
import { BackToMap, CloseDrawer } from "./CloseControls";

/**
 * A station's dossier (U21), rendered in the drawer on wide screens and as the page on a phone.
 * Focus moves to its heading when it opens (R28).
 */
export function StationDossier({ detail }: { detail: StationDetailResponse }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <article className="px-5 pb-10 pt-3">
      <div className="flex h-10 items-center justify-between">
        <BackToMap />
        <span className="ml-auto">
          <CloseDrawer />
        </span>
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-3 font-narrow text-36 font-bold uppercase outline-none" data-dossier-heading>
        {detail.station.displayName}
      </h1>
    </article>
  );
}
