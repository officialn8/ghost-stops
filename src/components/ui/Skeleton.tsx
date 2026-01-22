"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  variant?: "default" | "circular" | "text";
}

export function Skeleton({ className, variant = "default" }: SkeletonProps) {
  return (
    <div
      className={cn(
        "skeleton-shimmer",
        variant === "circular" && "rounded-full",
        variant === "text" && "h-4 rounded",
        className
      )}
    />
  );
}

// Preset skeleton sizes for common use cases
export function SkeletonText({ className, lines = 1 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-4",
            i === lines - 1 && lines > 1 && "w-3/4" // Last line shorter
          )}
        />
      ))}
    </div>
  );
}

export function SkeletonCircle({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  };

  return <Skeleton className={cn(sizes[size], "rounded-full")} />;
}
