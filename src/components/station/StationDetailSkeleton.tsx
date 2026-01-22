"use client";

import { Skeleton } from "@/components/ui/Skeleton";

export default function StationDetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Ghost Score Hero Skeleton */}
      <div className="px-6 py-8">
        <div className="flex flex-col items-center">
          <Skeleton className="w-24 h-24 rounded-full mb-2" />
          <Skeleton className="h-4 w-20 rounded" />
        </div>
      </div>

      {/* Key Metrics Skeleton */}
      <div className="px-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="glass-solid rounded-ui p-4 space-y-2">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-7 w-16 rounded" />
          </div>
          <div className="glass-solid rounded-ui p-4 space-y-2">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-7 w-14 rounded" />
          </div>
        </div>
      </div>

      {/* Ghost Analysis Skeleton */}
      <div className="px-6">
        <div className="glass-solid rounded-ui p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="w-8 h-8 rounded-full" />
            <Skeleton className="h-5 w-40 rounded" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-5/6 rounded" />
            <Skeleton className="h-4 w-4/6 rounded" />
          </div>
          <Skeleton className="h-3 w-32 rounded" />
        </div>
      </div>

      {/* Chart Skeleton */}
      <div className="px-6">
        <Skeleton className="h-5 w-36 rounded mb-3" />
        <Skeleton className="h-48 w-full rounded-ui" />
      </div>

      {/* Station Info Skeleton */}
      <div className="px-6 pb-6 space-y-2">
        <Skeleton className="h-3 w-28 rounded" />
        <Skeleton className="h-3 w-40 rounded" />
      </div>
    </div>
  );
}
