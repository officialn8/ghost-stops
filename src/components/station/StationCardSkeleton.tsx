"use client";

import { Skeleton } from "@/components/ui/Skeleton";

interface StationCardSkeletonProps {
  count?: number;
}

function SingleStationCardSkeleton() {
  return (
    <div className="px-5 py-4 flex items-center gap-4">
      {/* Rank */}
      <Skeleton className="w-6 h-6 rounded-full flex-shrink-0" />

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* Station name */}
        <Skeleton className="h-5 w-3/4 rounded" />
        {/* Line badges */}
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-5 w-10 rounded-full" />
        </div>
      </div>

      {/* Ghost score */}
      <Skeleton className="w-10 h-8 rounded-ui flex-shrink-0" />
    </div>
  );
}

export default function StationCardSkeleton({ count = 5 }: StationCardSkeletonProps) {
  return (
    <div className="divide-y divide-neutral-border">
      {Array.from({ length: count }).map((_, i) => (
        <SingleStationCardSkeleton key={i} />
      ))}
    </div>
  );
}

// Export single card for individual use
export { SingleStationCardSkeleton };
