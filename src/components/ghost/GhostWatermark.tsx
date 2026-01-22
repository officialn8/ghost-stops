import { cn } from "@/lib/utils";

interface GhostWatermarkProps {
  className?: string;
  opacity?: number;
}

export default function GhostWatermark({
  className,
  opacity = 0.03
}: GhostWatermarkProps) {
  return (
    <div
      className={cn(
        "absolute inset-0 pointer-events-none overflow-hidden",
        className
      )}
    >
      <svg
        className="absolute w-full h-full animate-ghost-float"
        style={{ opacity }}
        viewBox="0 0 800 800"
        fill="currentColor"
      >
        <g transform="translate(400, 400)">
          {/* Main ghost body */}
          <path
            d="M0,-120 C-66.3,-120 -120,-66.3 -120,0 L-120,80 C-120,96 -108,108 -96,108 C-84,108 -72,96 -72,80 C-72,96 -60,108 -48,108 C-36,108 -24,96 -24,80 C-24,96 -12,108 0,108 C12,108 24,96 24,80 C24,96 36,108 48,108 C60,108 72,96 72,80 C72,96 84,108 96,108 C108,108 120,96 120,80 L120,0 C120,-66.3 66.3,-120 0,-120 Z"
            className="text-brandIndigo"
          />

          {/* Eyes */}
          <circle cx="-30" cy="-20" r="12" className="text-neutral-bg" />
          <circle cx="30" cy="-20" r="12" className="text-neutral-bg" />
          <circle cx="-30" cy="-20" r="6" className="text-brandIndigo" />
          <circle cx="30" cy="-20" r="6" className="text-brandIndigo" />

          {/* Subtle glow */}
          <circle
            cx="0"
            cy="0"
            r="150"
            fill="url(#ghostGlow)"
            opacity="0.3"
          />
        </g>

        <defs>
          <radialGradient id="ghostGlow">
            <stop offset="0%" stopColor="rgba(124, 58, 237, 0.2)" />
            <stop offset="50%" stopColor="rgba(20, 184, 166, 0.1)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}