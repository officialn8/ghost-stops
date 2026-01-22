import CTALineBadge from "@/components/station/CTALineBadge";
import GhostScoreBadge from "@/components/ghost/GhostScoreBadge";
import { Users } from "lucide-react";
import { normalizeStationLines, warnIfNameContainsLineInfo } from "@/lib/cta/normalizeStationLines";
import { useMemo } from "react";

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
  // Normalize station lines for consistent rendering
  const { lines, cleanName, rawLineString } = useMemo(() => {
    const result = normalizeStationLines(station);

    // Debug warning if station name still contains line info in parentheses
    if (process.env.NODE_ENV === 'development') {
      warnIfNameContainsLineInfo(station.name, station.id);
    }

    return result;
  }, [station]);

  // Determine if we should show a fallback
  const showFallback = lines.length === 0 && rawLineString;

  if (showFallback && process.env.NODE_ENV === 'development') {
    console.warn(
      `[CTA Line Pills] Could not parse lines for station "${station.name}" (id: ${station.id}). ` +
      `Raw line data: "${rawLineString}"`
    );
  }

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
          {/* Station Name (clean, without parenthetical line info) */}
          <h3 className="font-semibold text-ui-sm text-text-primary mb-2">
            {cleanName || station.name}
          </h3>

          {/* Lines */}
          <div className="flex flex-wrap gap-1 mb-2">
            {lines.length > 0 ? (
              lines.map((line) => (
                <CTALineBadge key={line} line={line} size="sm" />
              ))
            ) : showFallback ? (
              <span className="text-ui-xs text-text-tertiary italic">
                Lines unavailable
              </span>
            ) : null}
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