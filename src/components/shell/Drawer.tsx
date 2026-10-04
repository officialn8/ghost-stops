"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { useShell } from "./ShellContext";

/**
 * Where a station page renders (KTD12). From 768px it is the 440px drawer over the map's right
 * edge; on a phone it is the page below the shared map. Any Escape that reaches the window closes
 * it; the search field clears a non-empty query first and stops the key there. There is no
 * `defaultPrevented` check: the phone's always-open bottom sheet (vaul, on Radix's
 * DismissableLayer) prevents every Escape on the document.
 */
export function Drawer({
  entrance = true,
  children,
}: {
  /** Slide in from the right on mount (240ms). Off for the drawer present on the first render. */
  entrance?: boolean;
  children: React.ReactNode;
}) {
  const { closeStation } = useShell();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeStation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeStation]);

  return (
    <motion.section
      aria-label="Station"
      initial={entrance ? { opacity: 0, x: 24 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex-none bg-surface md:absolute md:inset-y-0 md:right-0 md:z-drawer md:w-[440px] md:max-w-full md:overflow-y-auto md:overscroll-contain md:border-l md:border-rule md:shadow-panel"
      data-drawer
    >
      {children}
    </motion.section>
  );
}
