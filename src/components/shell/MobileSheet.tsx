"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Drawer as Sheet } from "vaul";
import { Ledger } from "@/components/ledger/Ledger";
import { SHEET_OPEN_SNAP } from "./model";

/** The handle's row: 4px of handle inside 8px margins. */
const HANDLE_PX = 20;
/** The ledger's head on a 375px phone, until it is measured: lede, search, bars, sort heads. */
const HEAD_FALLBACK_PX = 140;

/**
 * The phone's station list: a bottom sheet over the full-bleed map, holding the same ledger as
 * the desktop column. It is mounted only on the map page and is always open while mounted.
 * Toggling the sheet's open state on navigation is what swallowed the first tap on a phone
 * (Reddit report B1, KTD16), so nothing here ever changes `open`; a station page unmounts it.
 *
 * It opens just over half the viewport, so the first screen shows the ledger's head and four rows.
 * Its lowest snap is the head alone, measured, so the sort heads never clip at the bottom edge
 * and pulling the sheet down reveals the whole network.
 */
export function MobileSheet() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [headPx, setHeadPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const head = contentRef.current?.querySelector<HTMLElement>("[data-ledger-head]");
    if (!head || typeof ResizeObserver === "undefined") return;
    const measure = () => setHeadPx(head.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(head);
    return () => observer.disconnect();
  }, []);

  const points = useMemo<(number | string)[]>(
    () => [`${HANDLE_PX + (headPx ?? HEAD_FALLBACK_PX)}px`, SHEET_OPEN_SNAP, 0.92],
    [headPx],
  );
  const [snap, setSnap] = useState<number | string | null>(SHEET_OPEN_SNAP);

  return (
    <Sheet.Root
      open
      modal={false}
      dismissible={false}
      snapPoints={points}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Sheet.Portal>
        <Sheet.Content
          ref={contentRef}
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-sheet flex h-[92dvh] flex-col border-t border-rule bg-surface outline-none"
        >
          <Sheet.Handle className="!my-2 !h-1 !w-10 !rounded-full !bg-ink/25" />
          <Sheet.Title className="sr-only">Stations</Sheet.Title>
          <Ledger variant="sheet" />
        </Sheet.Content>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
