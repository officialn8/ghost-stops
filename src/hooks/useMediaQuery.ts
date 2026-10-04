import { useSyncExternalStore } from "react";

/**
 * Whether a media query matches, for the few things CSS cannot decide: mounting the phone's
 * bottom sheet (a portal) and choosing the map camera's padding. Layout itself is CSS (KTD13).
 * The server and the first client render report false.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The phone layout: below Tailwind's md breakpoint (768px). */
export const PHONE_QUERY = "(max-width: 767.98px)";

export const useIsPhone = () => useMediaQuery(PHONE_QUERY);
