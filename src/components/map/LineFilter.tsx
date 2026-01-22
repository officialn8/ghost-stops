"use client";

import { CTA_LINE_ORDER, CTA_LINE_COLORS } from "@/lib/cta/explodeSegments";
import { cn } from "@/lib/utils";

interface LineFilterProps {
  activeLines: Record<string, boolean>;
  onToggleLine: (line: string) => void;
}

export default function LineFilter({ activeLines, onToggleLine }: LineFilterProps) {
  const displayLines = CTA_LINE_ORDER;

  return (
    <div className="absolute top-20 right-4 z-40">
      <div className="glass rounded-ui p-3 shadow-hover">
        <h3 className="text-ui-xs font-semibold text-text-secondary mb-2">
          Filter Lines
        </h3>

        <div className="flex flex-wrap gap-1.5 max-w-[200px]">
          {displayLines.map((line) => {
            const isActive = activeLines[line];
            const color = CTA_LINE_COLORS[line];

            return (
              <button
                key={line}
                onClick={() => onToggleLine(line)}
                className={cn(
                  "filter-pill px-2.5 py-1 rounded-full text-ui-xs font-medium",
                  isActive && "active"
                )}
                style={{
                  // Line color for text when inactive, background when active
                  color: isActive ? "white" : color,
                  backgroundColor: isActive ? color : undefined,
                  // Glow shadow when active
                  boxShadow: isActive
                    ? `0 4px 12px ${color}66, 0 1px 2px rgba(0, 0, 0, 0.1)`
                    : undefined,
                  // CSS variables for enhanced effects
                  "--pill-color": color,
                  "--pill-color-shadow": `${color}20`,
                  "--pill-color-border": `${color}20`,
                  "--pill-color-glow": `${color}40`,
                  "--pill-color-border-dark": `${color}30`,
                } as React.CSSProperties}
              >
                {line}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
