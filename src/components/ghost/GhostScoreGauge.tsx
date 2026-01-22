"use client";

import { useSpring, animated } from "@react-spring/web";
import { springConfigs } from "@/lib/motion/tokens";
import { cn, getGhostScoreColor } from "@/lib/utils";
import { Ghost } from "lucide-react";

interface GhostScoreGaugeProps {
  score: number;
  label?: string;
  dataStatus?: "available" | "missing" | "zero";
  className?: string;
}

export default function GhostScoreGauge({
  score,
  label = "Ghost Score",
  dataStatus = "available",
  className,
}: GhostScoreGaugeProps) {
  const color = dataStatus === "missing" ? "#9CA3AF" : getGhostScoreColor(score);

  // Animated count-up with react-spring
  const { number } = useSpring({
    from: { number: 0 },
    to: { number: dataStatus === "missing" ? 0 : score },
    delay: 300,
    config: springConfigs.countUp,
  });

  // Animated gauge fill
  const { progress } = useSpring({
    from: { progress: 0 },
    to: { progress: dataStatus === "missing" ? 0 : score / 100 },
    delay: 200,
    config: { tension: 280, friction: 60 },
  });

  // Calculate stroke dash array for circular progress
  const radius = 58;
  const circumference = 2 * Math.PI * radius;

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
          className="w-40 h-40 rounded-full animate-ghost-pulse opacity-30 blur-2xl"
          style={{
            background: `radial-gradient(circle, ${color}30, ${color}10, transparent)`,
          }}
        />
      </div>

      {/* Secondary glow ring */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="w-32 h-32 rounded-full"
          style={{
            background: `radial-gradient(circle, transparent 40%, ${color}15 70%, transparent 100%)`,
          }}
        />
      </div>

      {/* Circular Gauge */}
      <div className="relative w-32 h-32 ghost-score-gauge">
        <svg
          className="absolute inset-0 w-full h-full transform -rotate-90"
          viewBox="0 0 128 128"
        >
          {/* Background circle */}
          <circle
            cx="64"
            cy="64"
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            className="text-gray-200 dark:text-gray-800"
          />

          {/* Animated progress circle */}
          <animated.circle
            cx="64"
            cy="64"
            r={radius}
            stroke={color}
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={progress.to(p => 100 - (p * 100))}
            className="drop-shadow-lg"
            style={{
              filter: `drop-shadow(0 0 8px ${color}40)`,
              transformOrigin: 'center',
            }}
          />

          {/* Gradient definition for enhanced visual */}
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity={1} />
              <stop offset="100%" stopColor={color} stopOpacity={0.7} />
            </linearGradient>
          </defs>
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {dataStatus === "missing" ? (
            <>
              <span className="text-3xl font-display font-bold text-gray-400">—</span>
              <Ghost className="w-4 h-4 text-gray-400 mt-1" />
            </>
          ) : (
            <>
              <animated.span
                className="text-4xl font-display font-bold ghost-score-gauge-text"
                style={{
                  background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {number.to((n) => n.toFixed(0))}
              </animated.span>

              {/* Add particle effects for high scores */}
              {score > 95 && (
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-2 left-1/2 -translate-x-1/2">
                    <Ghost className="w-3 h-3 text-red-500 animate-float-up opacity-60" />
                  </div>
                  <div className="absolute top-4 left-1/3">
                    <Ghost className="w-2 h-2 text-red-400 animate-float-up-delay opacity-40" />
                  </div>
                  <div className="absolute top-3 right-1/3">
                    <Ghost className="w-2.5 h-2.5 text-red-500 animate-float-up-delay-2 opacity-50" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Label */}
      <span className="stat-label-text mt-4">
        {dataStatus === "missing" ? "No Data" : label}
      </span>

      {/* Pulsing ring for high ghost scores */}
      {score > 80 && dataStatus !== "missing" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-36 h-36 rounded-full ghost-score-high"
            style={{
              border: `2px solid ${color}40`,
              animation: 'ghostPulse 2s ease-in-out infinite',
            }}
          />
        </div>
      )}
    </div>
  );
}