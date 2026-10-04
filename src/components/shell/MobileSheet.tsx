"use client";

import { useState } from "react";
import { Drawer as Sheet } from "vaul";
import { Ledger } from "@/components/ledger/Ledger";

const SNAP_POINTS: (number | string)[] = [0.25, 0.5, 0.92];

/**
 * The phone's station list: a bottom sheet over the full-bleed map, holding the same ledger as
 * the desktop column. It is mounted only on the map page and is always open while mounted.
 * Toggling the sheet's open state on navigation is what swallowed the first tap on a phone
 * (Reddit report B1, KTD16), so nothing here ever changes `open`; a station page unmounts it.
 */
export function MobileSheet() {
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0]);

  return (
    <Sheet.Root
      open
      modal={false}
      dismissible={false}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Sheet.Portal>
        <Sheet.Content
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
