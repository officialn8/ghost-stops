"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { formatRiders } from "@/lib/format";
import { useMountMotion } from "./useMountMotion";

/**
 * A whole number that counts up from zero once, over 600ms, when the dossier opens (R29), and is
 * otherwise shown final: on the server, on hydration, and under reduced motion. Screen readers
 * get the final value only, never the count.
 */
export function CountOnce({ value, className }: { value: number; className?: string }) {
  const play = useMountMotion();
  const count = useMotionValue(play ? 0 : value);
  const text = useTransform(count, formatRiders);

  useEffect(() => {
    if (!play) {
      count.set(value);
      return;
    }
    const controls = animate(count, value, { duration: 0.6, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [play, count, value]);

  return (
    <>
      <motion.span aria-hidden className={className} data-count-once>
        {text}
      </motion.span>
      <span className="sr-only">{formatRiders(value)}</span>
    </>
  );
}
