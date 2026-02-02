"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CTA_LINE_COLORS, type CTALine } from "@/lib/cta/explodeAndStitchSegments";

interface ComparisonItem {
  label: string;
  value: number;
  color?: string;
  isStation?: boolean;
  percentDiff?: number;
}

interface ComparisonBarsProps {
  stationValue: number;
  stationLabel?: string;
  comparisons: ComparisonItem[];
  primaryLineColor?: string;
  className?: string;
}

export default function ComparisonBars({
  stationValue,
  stationLabel = "This Station",
  comparisons,
  primaryLineColor = "#6366f1",
  className,
}: ComparisonBarsProps) {
  // Find max value for scaling bars
  const allValues = [stationValue, ...comparisons.map(c => c.value)];
  const maxValue = Math.max(...allValues);

  // Format numbers with commas
  const formatNumber = (n: number) => Math.round(n).toLocaleString();

  // Calculate bar width percentage
  const getBarWidth = (value: number) => {
    if (maxValue === 0) return 0;
    return Math.max((value / maxValue) * 100, 2); // Minimum 2% width for visibility
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Station's value (highlighted) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-ui-xs">
          <span className="font-medium text-text-primary">{stationLabel}</span>
          <span className="font-mono text-text-secondary">
            {formatNumber(stationValue)}/day
          </span>
        </div>
        <div className="h-6 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: primaryLineColor }}
            initial={{ width: 0 }}
            animate={{ width: `${getBarWidth(stationValue)}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Comparison bars */}
      {comparisons.map((comparison, index) => {
        const percentLabel = comparison.percentDiff !== undefined
          ? `(${comparison.percentDiff > 0 ? '+' : ''}${comparison.percentDiff}%)`
          : '';

        return (
          <div key={index} className="space-y-1.5">
            <div className="flex items-center justify-between text-ui-xs">
              <span className="text-text-secondary">{comparison.label}</span>
              <span className="font-mono text-text-tertiary">
                {formatNumber(comparison.value)}/day{' '}
                {percentLabel && (
                  <span className={cn(
                    comparison.percentDiff && comparison.percentDiff < 0 ? "text-red-500" :
                    comparison.percentDiff && comparison.percentDiff > 0 ? "text-emerald-500" :
                    "text-text-tertiary"
                  )}>
                    {percentLabel}
                  </span>
                )}
              </span>
            </div>
            <div className="h-4 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full opacity-50"
                style={{ backgroundColor: comparison.color || '#9CA3AF' }}
                initial={{ width: 0 }}
                animate={{ width: `${getBarWidth(comparison.value)}%` }}
                transition={{ duration: 0.5, ease: "easeOut", delay: index * 0.1 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Prebuilt comparison bar set for station detail
interface StationComparisonProps {
  stationAvg: number;
  systemMedian: number;
  lineMedian: number;
  neighborAvg: number;
  primaryLine: string | null;
  vsSystemMedian: number;
  vsLineMedian: number;
  vsNeighbors: number;
  className?: string;
}

export function StationComparison({
  stationAvg,
  systemMedian,
  lineMedian,
  neighborAvg,
  primaryLine,
  vsSystemMedian,
  vsLineMedian,
  vsNeighbors,
  className,
}: StationComparisonProps) {
  const lineColor = primaryLine ? CTA_LINE_COLORS[primaryLine as CTALine] || '#6366f1' : '#6366f1';

  const comparisons: ComparisonItem[] = [
    {
      label: "System Median",
      value: systemMedian,
      color: "#6B7280",
      percentDiff: vsSystemMedian,
    },
  ];

  // Only show line median if we have a primary line and it's different from system median
  if (primaryLine && lineMedian > 0) {
    comparisons.push({
      label: `${primaryLine} Line Median`,
      value: lineMedian,
      color: lineColor,
      percentDiff: vsLineMedian,
    });
  }

  // Only show neighbor avg if we have neighbor data
  if (neighborAvg > 0) {
    comparisons.push({
      label: "Neighbor Avg",
      value: neighborAvg,
      color: "#8B5CF6",
      percentDiff: vsNeighbors,
    });
  }

  return (
    <ComparisonBars
      stationValue={stationAvg}
      comparisons={comparisons}
      primaryLineColor={lineColor}
      className={className}
    />
  );
}
