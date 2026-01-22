"use client";

import { Users, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useMemo } from "react";
import CTALineBadge from "./CTALineBadge";
import GhostScoreBadge from "@/components/ghost/GhostScoreBadge";
import { cn } from "@/lib/utils";
import { normalizeStationLines } from "@/lib/cta/normalizeStationLines";
import { CTA_LINE_COLORS } from "@/lib/cta/explodeAndStitchSegments";

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

  // Get primary line color for rank badge
  const primaryLineColor = normalizedLines[0] ? CTA_LINE_COLORS[normalizedLines[0]] : '#6B7280';

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative p-4 cursor-pointer transition-all duration-200",
        "hover:translate-y-[-2px] hover:shadow-lg rounded-lg",
        selected && "bg-white/60 backdrop-blur-sm shadow-md",
        className
      )}
      style={{
        // Custom hover glow effect
        transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
      }}
    >
      {/* Selected Indicator */}
      {selected && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-400 to-emerald-600 rounded-r-full" />
      )}

      {/* Mini Bento Layout */}
      <div className="flex items-center gap-4">
        {/* Rank Badge with gradient */}
        <div
          className="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center font-display font-bold text-lg shadow-sm"
          style={{
            background: `linear-gradient(135deg, ${primaryLineColor}15 0%, ${primaryLineColor}25 100%)`,
            color: primaryLineColor,
            border: `1px solid ${primaryLineColor}20`
          }}
        >
          {rank}
        </div>

        {/* Center: Station Info */}
        <div className="flex-1 min-w-0">
          {/* Station Name */}
          <h3 className="text-ui-md font-display font-semibold text-text-primary truncate mb-1">
            {cleanName || name}
          </h3>

          {/* Line Badges and Ridership */}
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {normalizedLines.map((line) => (
                <CTALineBadge key={line} line={line} size="sm" gradient />
              ))}
            </div>

            <div className="flex items-center gap-1 text-ui-xs text-text-secondary">
              <Users className="w-3 h-3" />
              <span className="font-mono">
                {dataStatus === 'missing'
                  ? '—'
                  : Math.round(dailyAverage).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Ghost Score as Circular Indicator */}
        <div className="flex-shrink-0 relative">
          <div className="w-14 h-14 rounded-full flex flex-col items-center justify-center relative">
            {/* Circular progress background */}
            <svg className="absolute inset-0 w-full h-full -rotate-90">
              <circle
                cx="28"
                cy="28"
                r="24"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                className="text-gray-200"
              />
              <circle
                cx="28"
                cy="28"
                r="24"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={100 - ghostScore}
                className={cn(
                  "transition-all duration-500",
                  ghostScore > 80 ? "text-red-500" :
                  ghostScore > 60 ? "text-orange-500" :
                  ghostScore > 40 ? "text-amber-500" :
                  "text-emerald-500"
                )}
              />
            </svg>
            <span className="font-display font-bold text-lg">
              {Math.round(ghostScore)}
            </span>
            <span className="text-[9px] font-medium text-text-tertiary uppercase tracking-wider">
              Ghost
            </span>
          </div>
        </div>
      </div>

      {/* Hover Effect Overlay */}
      <div
        className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{
          background: `linear-gradient(135deg, ${primaryLineColor}05 0%, transparent 50%)`,
          boxShadow: `0 8px 30px ${primaryLineColor}15`
        }}
      />
    </div>
  );
}