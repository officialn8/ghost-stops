import { Ghost } from "lucide-react";
import { tierStyle } from "@/lib/utils";
import type { ScoreTierName } from "@/types/station";

/** The words for each tier, sentence case. A healthy station is never called a ghost (R17, R19). */
export const TIER_LABEL: Readonly<Record<ScoreTierName, string>> = {
  ghost: "Ghost",
  fading: "Fading",
  quiet: "Quiet",
  healthy: "Healthy",
};

/** The ghost glyph's box relative to a ring mark's diameter: its body matches the ring's width. */
export const GHOST_SCALE = 1.5;

/** The ghost glyph's ink: the theme's ink-3 token (0.52 dark, 0.62 light; src/app/globals.css). */
export const GHOST_INK = "rgb(var(--ink) / var(--ink-3-alpha))";

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
 * - ghost: a small ghost (lucide's Ghost glyph), its body filled with the surface, drawn a size
 *   larger than the rings so it reads at a glance. Its shape now says "ghost", so it takes the
 *   ink-3 text token (the faintest ink that keeps AA contrast) rather than the 44% ring ink,
 *   which drops below 3:1 on the light surface. Static: it never floats.
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

  if (tier === "ghost") {
    const glyph = Math.round(size * GHOST_SCALE);
    return (
      <Ghost
        width={glyph}
        height={glyph}
        strokeWidth={2}
        fill="rgb(var(--surface))"
        stroke={GHOST_INK}
        className={className}
        aria-hidden
        focusable="false"
        data-mark="ghost"
      />
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
