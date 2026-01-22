import CTALineBadge from "@/components/station/CTALineBadge";
import GhostScoreBadge from "@/components/ghost/GhostScoreBadge";
import { Users } from "lucide-react";

interface Station {
  id: string;
  name: string;
  lines: string[];
  ghostScore: number;
  rolling30dAvg: number;
  dataStatus?: 'available' | 'missing' | 'zero';
}

interface MapTooltipProps {
  station: Station;
  x: number;
  y: number;
}

export default function MapTooltip({ station, x, y }: MapTooltipProps) {
  return (
    <div
      className="absolute pointer-events-none z-50 animate-ghost-fade"
      style={{
        left: x + 15,
        top: y - 10,
        transform: "translateY(-100%)",
      }}
    >
      <div className="glass rounded-ui p-3 shadow-hover min-w-[200px]">
        {/* Ghost mist effect */}
        <div className="absolute inset-0 ghost-mist rounded-ui opacity-30" />

        <div className="relative z-10">
          {/* Station Name */}
          <h3 className="font-semibold text-ui-sm text-text-primary mb-2">
            {station.name}
          </h3>

          {/* Lines */}
          <div className="flex flex-wrap gap-1 mb-2">
            {(Array.isArray(station.lines) ? station.lines : []).map((line) => (
              <CTALineBadge key={line} line={line} size="sm" />
            ))}
          </div>

          {/* Score and Metrics */}
          <div className="flex items-center justify-between">
            <GhostScoreBadge score={station.ghostScore} size="sm" dataStatus={station.dataStatus} />

            <div className="flex items-center gap-1 text-ui-xs text-text-secondary">
              <Users className="w-3 h-3" />
              <span>
                {station.dataStatus === 'missing'
                  ? '—'
                  : Math.round(station.rolling30dAvg).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}