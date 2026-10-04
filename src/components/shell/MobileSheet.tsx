"use client";

import { useState } from "react";
import { Drawer as Sheet } from "vaul";
import { Ledger } from "@/components/ledger/Ledger";
import { cn } from "@/lib/utils";

const SNAP_POINTS: (number | string)[] = [0.25, 0.5, 0.92];

/**
 * The phone's station list: a bottom sheet over the full-bleed map, holding the same ledger as
 * the desktop column. It is always open; a station page hides it with CSS rather than closing
 * it. Toggling the sheet's open state on navigation is what swallowed the first tap on a phone
 * (Reddit report B1, KTD16), so nothing here ever changes `open`.
 */
export function MobileSheet({ hidden }: { hidden: boolean }) {
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
          className={cn(
            "fixed inset-x-0 bottom-0 z-sheet flex h-[92dvh] flex-col border-t border-rule bg-surface outline-none",
            hidden && "hidden",
          )}
        >
          <Sheet.Handle className="!my-2 !h-1 !w-10 !rounded-full !bg-ink/25" />
          <Sheet.Title className="sr-only">Stations</Sheet.Title>
          <Ledger variant="sheet" />
        </Sheet.Content>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
