"use client";

import Link from "next/link";
import { Ghost } from "lucide-react";
import { ThemeToggle } from "@/components/theme";
import { useShell } from "./ShellContext";

/**
 * The platform sign across the top: the ghost and the wordmark (a link to the map, which closes
 * any open station), the data-through date as plain text, and the theme switch. No status dots: freshness
 * is a dated sentence (R13).
 */
export function TopBar() {
  const { list } = useShell();
  const dataThrough = list.status === "ready" ? list.data.dataThrough : null;

  return (
    <header className="z-chrome flex h-14 shrink-0 items-center gap-3 border-b border-rule bg-surface px-4 md:gap-4 md:px-5">
      <Link
        href="/"
        className="-mx-1 flex items-center gap-2 rounded px-1 py-1"
        aria-label="Ghost Stops: back to the map"
      >
        <Ghost className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden data-logo />
        <span className="font-narrow text-18 font-bold uppercase tracking-[0.06em]">Ghost Stops</span>
        <span className="hidden text-13 text-ink-2 md:inline">Chicago L</span>
      </Link>
      <p
        className="ml-auto text-13 text-ink-2"
        title="CTA publishes daily ridership about two months after the fact."
      >
        {dataThrough && (
          <>
            Data through <time className="font-mono tabular text-ink" dateTime={dataThrough}>{dataThrough}</time>
          </>
        )}
      </p>
      <ThemeToggle className="-mr-2" />
    </header>
  );
}
