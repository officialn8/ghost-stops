"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { DossierBar } from "./CloseControls";

/**
 * A station page that failed to load (KTD12): an inline message and a retry, inside the drawer,
 * with the way back to the map still there.
 */
export function DossierError({ reset }: { reset: () => void }) {
  const router = useRouter();

  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  return (
    <div className="px-5 pb-16">
      <DossierBar />
      <div role="alert" className="mt-2 border-t border-rule pt-5">
        <p className="text-15">This station could not be loaded.</p>
        <p className="mt-1 text-13 text-ink-2">The connection may have dropped. Try again in a moment.</p>
        <button
          type="button"
          onClick={retry}
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded border border-rule px-3 text-13 hover:bg-ink/[.06] active:translate-y-px"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}
