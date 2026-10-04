"use client";

import { TriangleAlert } from "lucide-react";
import { formatChicagoDay } from "@/lib/format";

/**
 * Shown when the last successful refresh is more than ten days old (R13), the same signal the
 * health check alerts on. The data-through date alone cannot say this: CTA's own publishing lag
 * keeps it about two months behind even when every refresh succeeds.
 */
export function HealthBanner({ lastSuccessfulFetch }: { lastSuccessfulFetch: string | null }) {
  return (
    <div role="status" className="flex shrink-0 items-start gap-3 border-b border-rule bg-surface-2 px-4 py-2 md:px-5">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <p className="text-13">
        {lastSuccessfulFetch
          ? `Ridership has not refreshed since ${formatChicagoDay(lastSuccessfulFetch)}. Figures may be out of date until the daily update runs again.`
          : "Ridership has not refreshed yet. Figures may be out of date until the daily update runs."}
      </p>
    </div>
  );
}
