"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { cn, getGhostScoreColor } from "@/lib/utils";
import { CTA_LINE_COLORS, type CTALine } from "@/lib/cta/explodeAndStitchSegments";

interface NeighborStation {
  id: string;
  name: string;
  rolling30dAvg: number;
  ghostScore: number;
}

interface NeighborPillsProps {
  primaryLine: string | null;
  prevStation: NeighborStation | null;
  nextStation: NeighborStation | null;
  onStationClick: (id: string) => void;
  className?: string;
}

export default function NeighborPills({
  primaryLine,
  prevStation,
  nextStation,
  onStationClick,
  className,
}: NeighborPillsProps) {
  const lineColor = primaryLine ? CTA_LINE_COLORS[primaryLine as CTALine] || '#6366f1' : '#6366f1';

  // Don't render if no neighbors
  if (!prevStation && !nextStation) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {/* Previous station */}
      {prevStation ? (
        <motion.button
          onClick={() => onStationClick(prevStation.id)}
          className={cn(
            "flex-1 flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-full",
            "bg-neutral-100/80 dark:bg-neutral-800/50",
            "hover:bg-neutral-200 dark:hover:bg-neutral-700/50",
            "transition-all cursor-pointer group border border-transparent hover:border-neutral-200 dark:hover:border-neutral-700"
          )}
          whileHover={{ x: -1 }}
          whileTap={{ scale: 0.98 }}
        >
          <ChevronLeft className="w-3 h-3 text-text-tertiary flex-shrink-0" />
          <span className="text-[11px] font-medium text-text-secondary truncate">
            {prevStation.name}
          </span>
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
            style={{ backgroundColor: getGhostScoreColor(prevStation.ghostScore) }}
          >
            {prevStation.ghostScore}
          </div>
        </motion.button>
      ) : (
        <div className="flex-1" />
      )}

      {/* Center line dot */}
      <div
        className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-neutral-900"
        style={{ backgroundColor: lineColor }}
        title={primaryLine || undefined}
      />

      {/* Next station */}
      {nextStation ? (
        <motion.button
          onClick={() => onStationClick(nextStation.id)}
          className={cn(
            "flex-1 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-full",
            "bg-neutral-100/80 dark:bg-neutral-800/50",
            "hover:bg-neutral-200 dark:hover:bg-neutral-700/50",
            "transition-all cursor-pointer group border border-transparent hover:border-neutral-200 dark:hover:border-neutral-700"
          )}
          whileHover={{ x: 1 }}
          whileTap={{ scale: 0.98 }}
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
            style={{ backgroundColor: getGhostScoreColor(nextStation.ghostScore) }}
          >
            {nextStation.ghostScore}
          </div>
          <span className="text-[11px] font-medium text-text-secondary truncate">
            {nextStation.name}
          </span>
          <ChevronRight className="w-3 h-3 text-text-tertiary flex-shrink-0" />
        </motion.button>
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
}
