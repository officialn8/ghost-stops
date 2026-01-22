"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import TopBar from "@/components/layout/TopBar";

// Dynamic import for map to avoid SSR issues
const GhostStopsMap = dynamic(() => import("@/components/map/map"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-neutral-bg flex items-center justify-center">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-4 rounded-full skeleton-shimmer" />
        <div className="h-4 w-32 mx-auto rounded skeleton-shimmer" />
      </div>
    </div>
  ),
});

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="h-screen w-screen overflow-hidden bg-neutral-bg">
      {/* Top Navigation - hidden on mobile */}
      <div className="hidden md:block">
        <TopBar onSearch={setSearchQuery} />
      </div>

      {/* Main Content Area */}
      <div className="md:pt-16 h-full relative">
        {/* Map Background */}
        <div className="absolute inset-0">
          <GhostStopsMap searchQuery={searchQuery} />
        </div>
      </div>
    </div>
  );
}
