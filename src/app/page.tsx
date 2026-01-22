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
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-brandIndigo/20 to-emerald-500/20 animate-ghost-pulse" />
        <p className="text-text-secondary">Loading map...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="h-screen w-screen overflow-hidden bg-neutral-bg">
      {/* Top Navigation */}
      <TopBar onSearch={setSearchQuery} />

      {/* Main Content Area */}
      <div className="pt-16 h-full relative">
        {/* Map Background */}
        <div className="absolute inset-0">
          <GhostStopsMap searchQuery={searchQuery} />
        </div>
      </div>
    </div>
  );
}
