import Link from "next/link";
import { Ghost } from "lucide-react";
import { ThemeToggle } from "@/components/theme";

/**
 * The method page's bar, the shell's top bar without the shell: the ghost and wordmark as the way
 * back to the map, the data-through date as a dated sentence, and the theme switch.
 */
export function MethodBar({ dataThrough }: { dataThrough: string | null }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 whitespace-nowrap border-b border-rule bg-surface px-4 md:gap-4 md:px-5">
      <Link
        href="/"
        className="-mx-1 flex shrink-0 items-center gap-1.5 rounded px-1 py-1 md:gap-2"
        aria-label="Ghost Stops: back to the map"
      >
        <Ghost className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden data-logo />
        <span className="font-narrow text-15 font-bold uppercase tracking-[0.06em] md:text-18">Ghost Stops</span>
        <span className="hidden text-13 text-ink-2 md:inline">Chicago L</span>
      </Link>
      <p className="ml-auto min-w-0 truncate text-13 text-ink-2">
        {dataThrough && (
          <>
            Data through{" "}
            <time className="font-mono tabular text-ink" dateTime={dataThrough}>
              {dataThrough}
            </time>
          </>
        )}
      </p>
      <ThemeToggle className="-mr-2" />
    </header>
  );
}
