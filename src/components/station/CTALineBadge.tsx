import { cn } from "@/lib/utils";
import { ctaLineColors } from "@/lib/ctaLineColors";

interface CTALineBadgeProps {
  line: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function CTALineBadge({
  line,
  size = "md",
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
        "inline-flex items-center justify-center font-medium text-white rounded-full",
        sizeClasses[size],
        className
      )}
      style={{
        backgroundColor: bgColor,
        boxShadow: `0 2px 4px ${bgColor}20`, // Subtle shadow for light mode
      }}
    >
      {line}
    </span>
  );
}