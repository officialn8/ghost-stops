"use client";

import { useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";

const subscribeNever = () => () => {};

/**
 * Whether a dossier part plays its one entrance (the number's count, the chart's draw): only when
 * it mounts in the browser, after a click or a neighbor hop, and the reader has not asked for
 * reduced motion (R29). A server-rendered page is already on screen with its final values, so
 * hydration keeps them rather than counting again; `useSyncExternalStore` reports the server
 * snapshot during hydration and the client one on a fresh mount. Read once, so a re-render never
 * replays it.
 */
export function useMountMotion(): boolean {
  const reduced = useReducedMotion();
  const freshClientMount = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [play] = useState(() => freshClientMount && !reduced);
  return play;
}
