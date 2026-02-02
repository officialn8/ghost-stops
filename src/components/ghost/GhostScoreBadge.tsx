import { clampGhostScore, cn, getGhostScoreColor, normalizeDataStatus } from "@/lib/utils";

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

  const resolvedStatus = normalizeDataStatus(dataStatus);
  const safeScore = clampGhostScore(score);

  // Handle missing data
  if (resolvedStatus === 'missing') {
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

  const color = getGhostScoreColor(safeScore);

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div
        className={cn("ghost-score-glow transition-all", sizeClasses[size])}
        style={{ color }}
      >
        {safeScore.toFixed(0)}
      </div>
      {showLabel && (
        <div className="text-ui-xs text-text-tertiary mt-1">ghost score</div>
      )}
    </div>
  );
}