import { normalizeStationLines } from "@/lib/cta/normalizeStationLines";
import { CTALine, CTA_LINE_COLORS } from "@/lib/cta/explodeAndStitchSegments";

interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lines: string[];
  ghostScore: number;
  rolling30dAvg: number;
  lastDayEntries: number;
  dataStatus?: 'available' | 'missing' | 'zero';
}

interface MobileStationCardProps {
  rank: number;
  station: Station;
  onClick: () => void;
}

export default function MobileStationCard({ rank, station, onClick }: MobileStationCardProps) {
  // Normalize station lines
  const { lines } = normalizeStationLines({ lines: station.lines });

  return (
    <button
      onClick={onClick}
      className="mobile-station-card w-full text-left"
    >
      <div className="rank">{rank}</div>

      <div className="station-info">
        <div className="station-name">{station.name}</div>
        <div className="station-lines">
          {lines.map((line) => (
            <span
              key={line}
              className="inline-block w-5 h-5 rounded-full text-xs text-white font-bold flex items-center justify-center"
              style={{ backgroundColor: CTA_LINE_COLORS[line as CTALine] }}
            >
              {line.charAt(0)}
            </span>
          ))}
        </div>
      </div>

      <div className="ghost-score">
        <div className="ghost-score-value">{station.ghostScore.toFixed(0)}</div>
        <div className="ghost-label">GHOST</div>
      </div>
    </button>
  );
}