import { cn } from "@/lib/utils";
import { ctaLineColors } from "@/lib/ctaLineColors";

interface CTALineBadgeProps {
  line: string;
  size?: "sm" | "md" | "lg";
  gradient?: boolean;
  className?: string;
}

export default function CTALineBadge({
  line,
  size = "md",
  gradient = false,
  className,
}: CTALineBadgeProps) {
  const sizeClasses = {
    sm: "px-2 py-0.5 text-[10px]",
    md: "px-2.5 py-0.5 text-[11px]",
    lg: "px-3 py-1 text-xs",
  };

  const bgColor = ctaLineColors[line as keyof typeof ctaLineColors] || "#666666";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center font-medium text-white rounded-full relative overflow-hidden",
        sizeClasses[size],
        gradient && "bg-gradient-to-r",
        className
      )}
      style={{
        background: gradient
          ? `linear-gradient(135deg, ${bgColor} 0%, ${bgColor}dd 100%)`
          : bgColor,
        boxShadow: gradient
          ? `0 3px 8px ${bgColor}30, inset 0 1px 0 rgba(255, 255, 255, 0.2)`
          : `0 2px 4px ${bgColor}20`,
      }}
    >
      {line}
      {gradient && (
        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </span>
  );
}