"use client";

import { useSpring, animated } from "@react-spring/web";
import { springConfigs } from "@/lib/motion/tokens";
import { cn, getGhostScoreColor } from "@/lib/utils";

interface GhostScoreHeroProps {
  score: number;
  label?: string;
  dataStatus?: "available" | "missing" | "zero";
  className?: string;
}

// Helper function to adjust color brightness for gradient
function adjustColorBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = ((num >> 8) & 0x00ff) + amt;
  const B = (num & 0x0000ff) + amt;
  return `#${(
    0x1000000 +
    (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
    (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
    (B < 255 ? (B < 1 ? 0 : B) : 255)
  )
    .toString(16)
    .slice(1)}`;
}

export default function GhostScoreHero({
  score,
  label = "Ghost Score",
  dataStatus = "available",
  className,
}: GhostScoreHeroProps) {
  const color =
    dataStatus === "missing" ? "#9CA3AF" : getGhostScoreColor(score);

  // Animated count-up with react-spring
  const { number } = useSpring({
    from: { number: 0 },
    to: { number: dataStatus === "missing" ? 0 : score },
    delay: 300,
    config: springConfigs.countUp,
  });

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
        <div className="absolute inset-0 ghost-shimmer" />
      </div>

      {/* Score */}
      <div className="relative z-10 flex flex-col items-center">
        {dataStatus === "missing" ? (
          <span
            className="ghost-score-text"
            style={{
              background: `linear-gradient(135deg, ${color}, ${adjustColorBrightness(color, -30)})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            —
          </span>
        ) : (
          <animated.span
            className="ghost-score-text"
            style={{
              background: `linear-gradient(135deg, ${color}, ${adjustColorBrightness(color, -30)})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {number.to((n) => n.toFixed(0))}
          </animated.span>
        )}

        <span className="stat-label-text mt-2">
          {dataStatus === "missing" ? "No Data" : label}
        </span>
      </div>

      {/* Mist effect */}
      <div className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-t from-ghost-mist to-transparent animate-mist-drift" />
      </div>
    </div>
  );
}
