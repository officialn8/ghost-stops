"use client";

import { useCallback, useEffect, useState } from "react";
import { olderThanDays, STALE_AFTER_DAYS } from "@/lib/staleness";
import type { StationListResponse } from "@/types/station";
import type { ListState } from "./ShellContext";

export const STATION_LIST_URL = "/api/chicago/stations";

/** After this long without an answer, the skeleton gives way to the error row and its retry. */
export const SLOW_LIST_MS = 8_000;

/** Whether a last successful refresh is old enough to warn about (R13); no refresh at all is stale. */
export function isStale(lastSuccessfulFetch: string | null, now: number): boolean {
  return olderThanDays(lastSuccessfulFetch === null ? null : Date.parse(lastSuccessfulFetch), STALE_AFTER_DAYS, now);
}

/**
 * Fetches the station list once per mount, and again on retry. A response that is still pending
 * after SLOW_LIST_MS shows the error row while the request keeps going: if it then lands, the
 * list appears.
 */
export function useStationList(): { list: ListState; retry: () => void } {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let settled = false;
    const slowTimer = window.setTimeout(() => {
      if (!settled) setList({ status: "error", reason: "slow" });
    }, SLOW_LIST_MS);

    fetch(STATION_LIST_URL, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Station list answered ${response.status}`);
        const data = (await response.json()) as StationListResponse;
        if (!Array.isArray(data.stations)) throw new Error("Station list has no stations");
        settled = true;
        setList({ status: "ready", data, stale: isStale(data.lastSuccessfulFetch, Date.now()) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        settled = true;
        console.error("Failed to load stations:", error);
        setList({ status: "error", reason: "failed" });
      })
      .finally(() => window.clearTimeout(slowTimer));

    return () => {
      controller.abort();
      window.clearTimeout(slowTimer);
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setList({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { list, retry };
}
