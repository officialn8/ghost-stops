"use client";

import { CTA_LINE_ORDER, CTA_LINE_COLORS } from "@/lib/cta/explodeSegments";

interface LineFilterProps {
  activeLines: Record<string, boolean>;
  onToggleLine: (line: string) => void;
}

export default function LineFilter({ activeLines, onToggleLine }: LineFilterProps) {
  const displayLines = CTA_LINE_ORDER;

  return (
    <div className="absolute top-20 right-4 z-40">
      <div className="glass rounded-ui p-3 shadow-hover">
        <h3 className="text-ui-xs font-semibold text-text-secondary mb-2">Filter Lines</h3>

        <div className="flex flex-wrap gap-1.5 max-w-[200px]">
          {displayLines.map((line) => {
            const isActive = activeLines[line];
            const color = CTA_LINE_COLORS[line];

            return (
              <button
                key={line}
                onClick={() => onToggleLine(line)}
                className={`
                  px-2.5 py-1 rounded-pill text-ui-xs font-medium
                  transition-all duration-200
                  ${isActive
                    ? 'text-white shadow-sm'
                    : 'text-text-secondary bg-neutral-surface-muted'}
                `}
                style={{
                  backgroundColor: isActive ? color : undefined,
                  boxShadow: isActive ? `0 2px 8px ${color}33` : undefined
                }}
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