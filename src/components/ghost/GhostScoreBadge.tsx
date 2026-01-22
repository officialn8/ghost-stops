import { cn } from "@/lib/utils";
import { getGhostScoreColor } from "@/lib/utils";

interface GhostScoreBadgeProps {
  score: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  dataStatus?: 'available' | 'missing' | 'zero';
  className?: string;
}

export default function GhostScoreBadge({
  score,
  size = "md",
  showLabel = false,
  dataStatus = 'available',
  className,
}: GhostScoreBadgeProps) {
  const sizeClasses = {
    sm: "text-ui-sm font-semibold",
    md: "text-ui-lg font-bold",
    lg: "text-display-3 font-bold",
  };

  // Handle missing data
  if (dataStatus === 'missing') {
    return (
      <div className={cn("flex flex-col items-center", className)}>
        <div
          className={cn("transition-all text-text-tertiary", sizeClasses[size])}
        >
          —
        </div>
        {showLabel && (
          <div className="text-ui-xs text-text-tertiary mt-1">no data</div>
        )}
      </div>
    );
  }

  const color = getGhostScoreColor(score);

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div
        className={cn("ghost-score-glow transition-all", sizeClasses[size])}
        style={{ color }}
      >
        {score}
      </div>
      {showLabel && (
        <div className="text-ui-xs text-text-tertiary mt-1">ghost score</div>
      )}
    </div>
  );
}