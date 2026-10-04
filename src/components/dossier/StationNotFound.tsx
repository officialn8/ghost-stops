"use client";

import Link from "next/link";
import { LineBars } from "@/components/marks/LineBars";
import { useShell } from "@/components/shell/ShellContext";
import { BackToMap, CloseDrawer } from "./CloseControls";

const MAX_MATCHES = 6;

/**
 * An unknown station address. The search here filters the same list as the ledger, so the reader
 * can find the station they meant without leaving the page.
 */
export function StationNotFound() {
  const { stations, query, setQuery } = useShell();
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? stations.filter((s) => s.slug && s.displayName.toLowerCase().includes(needle)).slice(0, MAX_MATCHES)
    : [];

  return (
    <div className="px-5 pb-16">
      <div className="flex h-14 items-center justify-between">
        <BackToMap />
        <span className="ml-auto">
          <CloseDrawer />
        </span>
      </div>
      <h1 className="mt-2 font-narrow text-24 font-semibold">No station at this address</h1>
      <p className="mt-2 text-15 text-ink-2">The link may be old or mistyped. Search for the station instead.</p>
      <label className="mt-6 block text-13 text-ink-2" htmlFor="not-found-search">
        Station name
      </label>
      <input
        id="not-found-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="mt-2 h-10 w-full rounded border border-rule bg-surface-2 px-3 text-15"
        autoComplete="off"
      />
      {needle && (
        <ul className="mt-3">
          {matches.length === 0 ? (
            <li className="py-3 text-13 text-ink-2">No stations match &ldquo;{query.trim()}&rdquo;.</li>
          ) : (
            matches.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/station/${s.slug}`}
                  className="flex h-11 items-center gap-3 border-b border-rule px-1 text-15 hover:bg-ink/[.06]"
                >
                  <span className="min-w-0 truncate">{s.displayName}</span>
                  <LineBars lines={s.lines} />
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
