import { tierStyle } from "@/lib/utils";
import type { ScoreTierName } from "@/types/station";

/** The words for each tier, sentence case. A healthy station is never called a ghost (R17, R19). */
export const TIER_LABEL: Readonly<Record<ScoreTierName, string>> = {
  ghost: "Ghost",
  fading: "Fading",
  quiet: "Quiet",
  healthy: "Healthy",
};

/** Why a station sits outside the ranking (R24): closed, or no riders in recent data. */
export type Exclusion = "closed" | "no-data";

export interface PresenceMarkProps {
  /** The station's tier; null with `excluded` for a station outside the ranking. */
  tier: ScoreTierName | null;
  excluded?: Exclusion | null;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

/**
 * A station's presence, the one mark vocabulary shared by the ledger, the dossier, and the map's
 * circle layers (R23, KTD10). Ghostliness is ink, never hue:
 *
 * - healthy: solid ink dot
 * - quiet: hollow ring, full ink
 * - fading: hollow ring at 72% ink
 * - ghost: dashed hollow ring at 44% ink
 * - closed: a ring crossed by a bar, like a no-entry sign, at 52% ink
 * - no data: a dotted ring at 44% ink
 *
 * Decorative: the tier is always also written out in words nearby.
 */
export function PresenceMark({ tier, excluded = null, size = 10, className }: PresenceMarkProps) {
  const stroke = 1.5;
  const r = size / 2 - stroke / 2;
  const c = size / 2;

  if (excluded || tier === null) {
    const closed = excluded === "closed";
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden focusable="false">
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={closed ? undefined : "1 2"}
          opacity={closed ? 0.52 : 0.44}
        />
        {closed && (
          <line x1={c - r * 0.6} y1={c} x2={c + r * 0.6} y2={c} stroke="currentColor" strokeWidth={stroke} opacity={0.52} />
        )}
      </svg>
    );
  }

  const { ink, mark } = tierStyle(tier);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden focusable="false">
      {mark === "solid" ? (
        <circle cx={c} cy={c} r={size / 2} fill="currentColor" opacity={ink} />
      ) : (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={mark === "hollow-dashed" ? "2 1.6" : undefined}
          opacity={ink}
        />
      )}
    </svg>
  );
}
