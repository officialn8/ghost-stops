"use client";

import { RotateCw } from "lucide-react";
import type { ListState } from "./ShellContext";

const SKELETON_ROWS = 9;

/**
 * The ledger before it has stations (KTD12): skeleton rows while the list loads, then an error
 * row with a retry action if the fetch fails or takes too long. Never a skeleton forever.
 */
export function ListStatus({ list, onRetry }: { list: Exclude<ListState, { status: "ready" }>; onRetry: () => void }) {
  if (list.status === "loading") {
    return (
      <ol aria-busy="true" aria-label="Loading stations">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <li key={i} className="flex h-14 items-center gap-3 border-b border-rule px-4" aria-hidden>
            <span className="h-3 w-5 rounded bg-ink/[.08]" />
            <span className="h-3 flex-1 rounded bg-ink/[.08]" style={{ maxWidth: `${46 + ((i * 17) % 34)}%` }} />
            <span className="h-3 w-12 rounded bg-ink/[.08]" />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div role="alert" className="flex items-start gap-3 border-b border-rule px-4 py-4">
      <p className="flex-1 text-13 text-ink-2">
        {list.reason === "slow"
          ? "Stations are taking longer than usual to load."
          : "Stations could not be loaded."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded border border-rule px-3 text-13 hover:bg-ink/[.06] active:translate-y-px"
      >
        <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        Retry
      </button>
    </div>
  );
}
