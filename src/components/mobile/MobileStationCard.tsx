import { normalizeStationLines } from "@/lib/cta/normalizeStationLines";
import { CTALine, CTA_LINE_COLORS } from "@/lib/cta/explodeAndStitchSegments";
import Sparkline from "@/components/charts/Sparkline";

interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lines: string[];
  ghostScore: number;
  rolling30dAvg: number;
  trend: number | null;
  dataStatus?: 'available' | 'missing' | 'zero';
  sparkline?: number[];
}

interface MobileStationCardProps {
  rank: number;
  station: Station;
  onClick: () => void;
}

export default function MobileStationCard({ rank, station, onClick }: MobileStationCardProps) {
  // Normalize station lines and clean name
  const { lines, cleanName } = normalizeStationLines({ name: station.name, lines: station.lines });
  const primaryLineColor = lines[0] ? CTA_LINE_COLORS[lines[0] as CTALine] : '#6366f1';
  const isGhosty = station.ghostScore >= 65;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`mobile-station-card w-full text-left${isGhosty ? " is-ghosty" : ""}`}
      style={{ touchAction: 'manipulation' }}
    >
      <div className="rank">{rank}</div>

      <div className="station-info">
        <div className="station-name">{cleanName || station.name}</div>
        <div className="station-lines">
          {lines.map((line) => (
            <span
              key={line}
              className="w-5 h-5 rounded-full text-xs text-white font-bold flex items-center justify-center"
              style={{ backgroundColor: CTA_LINE_COLORS[line as CTALine] }}
            >
              {line.charAt(0)}
            </span>
          ))}
        </div>
      </div>

      {/* Sparkline */}
      {station.sparkline && station.sparkline.length > 1 && (
        <div className="sparkline-container flex-shrink-0 mr-2">
          <Sparkline
            data={station.sparkline}
            width={44}
            height={20}
            color={primaryLineColor}
          />
        </div>
      )}

      <div className="ghost-score">
        <div className="ghost-score-value">{station.ghostScore.toFixed(0)}</div>
      </div>
    </button>
  );
}