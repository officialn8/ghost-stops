"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getGhostScoreColor } from "@/lib/utils";

interface GhostScoreHeroProps {
  score: number;
  label?: string;
  dataStatus?: 'available' | 'missing' | 'zero';
  className?: string;
}

export default function GhostScoreHero({
  score,
  label = "Ghost Score",
  dataStatus = 'available',
  className,
}: GhostScoreHeroProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const color = dataStatus === 'missing' ? '#9CA3AF' : getGhostScoreColor(score);

  useEffect(() => {
    setIsAnimating(true);
    const timer = setTimeout(() => setIsAnimating(false), 600);
    return () => clearTimeout(timer);
  }, [score]);

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center p-8",
        className
      )}
    >
      {/* Animated ghost glow background */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="w-32 h-32 rounded-full animate-ghost-pulse opacity-20 blur-3xl"
          style={{
            background: `radial-gradient(circle, ${color}40, transparent)`,
          }}
        />
      </div>

      {/* Shimmer overlay */}
      <div className="absolute inset-0 overflow-hidden rounded-panel">
        <div
          className={cn(
            "absolute inset-0 ghost-shimmer",
            isAnimating && "animate-ghost-shimmer"
          )}
        />
      </div>

      {/* Score */}
      <div className="relative z-10">
        <div
          className={cn(
            "text-7xl font-display font-bold transition-all duration-500",
            isAnimating && "animate-ghost-fade"
          )}
          style={{ color }}
        >
          {dataStatus === 'missing' ? '—' : score}
        </div>
        <div className="text-center mt-2 text-ui-sm font-medium text-text-secondary">
          {dataStatus === 'missing' ? 'No Data' : label}
        </div>
      </div>

      {/* Mist effect */}
      <div className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-t from-ghost-mist to-transparent animate-mist-drift" />
      </div>
    </div>
  );
}