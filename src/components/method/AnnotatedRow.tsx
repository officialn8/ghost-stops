"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { LedgerRow, type RowCell } from "@/components/ledger/LedgerRow";
import type { LedgerStation } from "@/components/ledger/useLedgerModel";

const noop = () => {};

/**
 * One real row of the ledger, the component itself, so what the page explains is exactly what the
 * reader saw; it opens the station like any row. Alone in its list and its own Tab stop, and as
 * wide as the reading column, so its riders figure sits on the text's right edge.
 */
export function AnnotatedRow({ station, spotlight = null }: { station: LedgerStation; spotlight?: readonly RowCell[] | null }) {
  const router = useRouter();
  const open = useCallback((slug: string) => router.push(`/station/${slug}`), [router]);
  return (
    <ol aria-label="One row of the ledger" className="w-full border-t border-rule">
      <LedgerRow
        station={station}
        exclusion={null}
        outsideFilter={false}
        selected={false}
        tabIndex={0}
        tierWord={false}
        spotlight={spotlight}
        onOpen={open}
        onFocus={noop}
      />
    </ol>
  );
}
