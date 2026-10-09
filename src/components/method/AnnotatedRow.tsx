"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { LedgerRow } from "@/components/ledger/LedgerRow";
import type { LedgerStation } from "@/components/ledger/useLedgerModel";

const noop = () => {};

/**
 * One real row of the ledger, the component itself, so what the page explains is exactly what the
 * reader saw; it opens the station like any row. Alone in its list and its own Tab stop.
 */
export function AnnotatedRow({ station }: { station: LedgerStation }) {
  const router = useRouter();
  const open = useCallback((slug: string) => router.push(`/station/${slug}`), [router]);
  return (
    <ol aria-label="One row of the ledger" className="w-full max-w-[360px] border-t border-rule">
      <LedgerRow
        station={station}
        exclusion={null}
        outsideFilter={false}
        selected={false}
        tabIndex={0}
        tierWord={false}
        onOpen={open}
        onFocus={noop}
      />
    </ol>
  );
}
