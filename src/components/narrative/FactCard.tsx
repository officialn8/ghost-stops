"use client";

import { Info, TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FactValue } from "@/types/narrative";
import { getFactLabel, getTrendDirection, formatTimeframe } from "@/lib/narratives";
import SmartTooltip from "@/components/ui/SmartTooltip";

interface FactCardProps {
  factKey: string;
  fact: FactValue;
  className?: string;
}

export default function FactCard({ factKey, fact, className }: FactCardProps) {
  const label = getFactLabel(factKey);
  const trend = getTrendDirection(fact.value);
  const timeframe = formatTimeframe(fact.timeframeStart, fact.timeframeEnd);
  const qualityLabel =
    fact.quality === "HIGH"
      ? "High"
      : fact.quality === "MEDIUM"
      ? "Medium"
      : fact.quality === "LOW"
      ? "Low"
      : "Unknown";
  const qualityClass =
    fact.quality === "HIGH"
      ? "text-emerald-300/90 bg-emerald-500/10 border-emerald-500/20"
      : fact.quality === "MEDIUM"
      ? "text-amber-300/90 bg-amber-500/10 border-amber-500/20"
      : fact.quality === "LOW"
      ? "text-rose-300/90 bg-rose-500/10 border-rose-500/20"
      : "text-text-tertiary bg-white/5 border-white/10";

  // Determine if this is a "change" metric (shows trend)
  const isChangeFact =
    factKey.includes("change") ||
    factKey.includes("decline") ||
    factKey.includes("growth");

  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  const trendColor =
    trend === "up"
      ? isChangeFact && fact.value > 0
        ? "text-emerald-500"
        : "text-red-500"
      : trend === "down"
      ? isChangeFact && fact.value < 0
        ? "text-red-500"
        : "text-emerald-500"
      : "text-text-tertiary";

  const tooltipContent = (
    <div className="space-y-2">
      <p className="text-text-secondary">{fact.methodology}</p>
      {fact.qualityNote && (
        <p className="text-text-tertiary">{fact.qualityNote}</p>
      )}
      {fact.sourceNote && (
        <p className="text-text-tertiary italic">{fact.sourceNote}</p>
      )}
      <a
        href={fact.source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-brandIndigo hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        <span>{fact.source.name}</span>
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );

  return (
    <div
      className={cn(
        "glass-solid rounded-ui p-4 relative group",
        className
      )}
    >
      {/* Label and quality */}
      <div className="mb-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-ui-xs text-text-tertiary">{label}</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] flex-shrink-0",
              qualityClass
            )}
          >
            {qualityLabel}
          </span>
        </div>
        {timeframe && (
          <span className="text-ui-xs text-text-tertiary/70 block mt-0.5">{timeframe}</span>
        )}
      </div>

      {/* Value with trend */}
      <div className="flex items-center justify-between">
        <span className="text-ui-lg font-mono font-semibold text-text-primary">
          {fact.displayValue}
        </span>

        {isChangeFact && (
          <TrendIcon className={cn("w-4 h-4", trendColor)} />
        )}
      </div>

      {/* Info button with smart tooltip */}
      <div className="absolute top-2 right-2">
        <SmartTooltip
          trigger={
            <button
              className="p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10"
              aria-label="Show methodology"
            >
              <Info className="w-3.5 h-3.5 text-text-tertiary" />
            </button>
          }
          content={tooltipContent}
        />
      </div>
    </div>
  );
}
