"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { useShell } from "./ShellContext";

/**
 * Where a station page renders (KTD12). From 768px it is the 440px drawer over the map's right
 * edge; on a phone it is the page below the shared map. Escape closes it, unless something inside
 * already handled the key (the search field clears its query first).
 */
export function Drawer({ children }: { children: React.ReactNode }) {
  const { closeStation } = useShell();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      closeStation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeStation]);

  return (
    <motion.section
      aria-label="Station"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex-none bg-surface md:absolute md:inset-y-0 md:right-0 md:z-drawer md:w-[440px] md:max-w-full md:overflow-y-auto md:overscroll-contain md:border-l md:border-rule md:shadow-panel"
      data-drawer
    >
      {children}
    </motion.section>
  );
}
