"use client";

import { Users } from "lucide-react";
import { useMemo } from "react";
import CTALineBadge from "./CTALineBadge";
import GhostScoreBadge from "@/components/ghost/GhostScoreBadge";
import { cn } from "@/lib/utils";
import { normalizeStationLines } from "@/lib/cta/normalizeStationLines";

interface StationRowProps {
  rank: number;
  name: string;
  lines: string[];
  ghostScore: number;
  dailyAverage: number;
  dataStatus?: 'available' | 'missing' | 'zero';
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export default function StationRow({
  rank,
  name,
  lines,
  ghostScore,
  dailyAverage,
  dataStatus = 'available',
  selected = false,
  onClick,
  className,
}: StationRowProps) {
  // Normalize lines for consistent rendering
  const { lines: normalizedLines, cleanName } = useMemo(() => {
    return normalizeStationLines({ name, lines });
  }, [name, lines]);

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative px-4 py-4 cursor-pointer transition-all duration-200",
        "hover:bg-white/40 hover:backdrop-blur-sm",
        selected && "bg-white/60 backdrop-blur-sm shadow-sm",
        className
      )}
    >
      {/* Selected Indicator */}
      {selected && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald rounded-r-full" />
      )}

      <div className="flex items-start justify-between gap-3">
        {/* Left: Rank, Name, Lines */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-ui-sm font-medium text-text-tertiary">
              #{rank}
            </span>
            <h3 className="text-ui-md font-semibold text-text-primary truncate">
              {cleanName || name}
            </h3>
          </div>

          <div className="flex flex-wrap gap-1">
            {normalizedLines.map((line) => (
              <CTALineBadge key={line} line={line} size="sm" />
            ))}
          </div>
        </div>

        {/* Right: Score and Metrics */}
        <div className="flex flex-col items-end gap-2">
          <GhostScoreBadge score={ghostScore} size="sm" dataStatus={dataStatus} />

          <div className="flex items-center gap-1 text-ui-xs text-text-secondary">
            <Users className="w-3 h-3" />
            <span>
              {dataStatus === 'missing'
                ? '—'
                : Math.round(dailyAverage).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Hover Effect */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>
    </div>
  );
}