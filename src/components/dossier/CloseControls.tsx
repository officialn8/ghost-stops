"use client";

import { ArrowLeft, X } from "lucide-react";
import { useShell } from "@/components/shell/ShellContext";

/**
 * The way out of a station page, which always lands on the map (R22). A phone gets a labeled
 * "Back to map" control, since its dossier is a whole page; wider screens get a close button on
 * the drawer.
 */
export function BackToMap() {
  const { closeStation } = useShell();
  return (
    <button
      type="button"
      onClick={closeStation}
      className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded px-2 text-13 text-ink-2 hover:text-ink active:translate-y-px md:hidden"
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      Back to map
    </button>
  );
}

export function CloseDrawer() {
  const { closeStation } = useShell();
  return (
    <button
      type="button"
      onClick={closeStation}
      aria-label="Close station"
      title="Close (Esc)"
      className="hidden h-10 w-10 items-center justify-center rounded text-ink-2 hover:bg-ink/[.06] hover:text-ink active:translate-y-px md:inline-flex"
    >
      <X className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
