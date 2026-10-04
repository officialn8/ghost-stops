"use client";

import { ListStatus } from "@/components/shell/ListStatus";
import { useShell } from "@/components/shell/ShellContext";
import { cn } from "@/lib/utils";

/**
 * The station ledger (U20): every station as a keyboard-reachable row, with search, the line
 * filter, and sort in a sticky header. `column` is the desktop column; `sheet` the phone's
 * bottom sheet.
 */
export function Ledger({ variant }: { variant: "column" | "sheet" }) {
  const { list, retryList, stations, selectedSlug, openStation, query, setQuery } = useShell();
  const needle = query.trim().toLowerCase();
  const rows = needle ? stations.filter((s) => s.displayName.toLowerCase().includes(needle)) : stations;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", variant === "sheet" && "pb-[env(safe-area-inset-bottom)]")}>
      <div className="border-b border-rule p-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          aria-label="Search stations"
          placeholder="Search stations"
          className="h-9 w-full rounded border border-rule bg-surface-2 px-3 text-15 placeholder:text-ink-3"
          data-ledger-search
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.status !== "ready" ? (
          <ListStatus list={list} onRetry={retryList} />
        ) : (
          <ol>
            {rows.map((s) =>
              s.slug ? (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => openStation(s.slug!)}
                    aria-current={s.slug === selectedSlug ? "true" : undefined}
                    className="flex h-14 w-full items-center gap-3 border-b border-rule px-4 text-left"
                    data-station-row={s.slug}
                  >
                    <span className="flex-1 truncate">{s.displayName}</span>
                    <span className="font-mono text-13">{s.avg12m === null ? "n/a" : Math.round(s.avg12m)}</span>
                  </button>
                </li>
              ) : null,
            )}
          </ol>
        )}
      </div>
    </div>
  );
}
