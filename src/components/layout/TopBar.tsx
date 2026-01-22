"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface TopBarProps {
  onSearch?: (query: string) => void;
  className?: string;
}

export default function TopBar({ onSearch, className }: TopBarProps) {
  return (
    <div
      className={cn(
        "fixed top-0 left-0 right-0 z-50 h-16 glass border-b",
        className
      )}
    >
      <div className="flex items-center justify-between h-full px-6">
        {/* Logo and Title */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            {/* Ghost Logo */}
            <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-spectral-500/20 to-aurora-500/20 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full animate-ghost-pulse bg-ghost-glow blur-sm" />
              <svg
                className="w-6 h-6 text-spectral-600 relative z-10"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 2.25c-2.486 0-4.5 2.014-4.5 4.5v5.25c0 2.761 2.239 5 5 5s5-2.239 5-5V6.75c0-2.486-2.014-4.5-4.5-4.5zm-2.5 15.5v2m5 0v2m-7.5-2h10"
                />
              </svg>
            </div>

            <div className="flex items-baseline gap-2">
              <h1 className="text-ui-xl font-display font-bold text-gradient-ghost">
                Ghost Stops
              </h1>
              <span className="text-ui-sm text-text-secondary">
                Chicago • CTA
              </span>
            </div>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              placeholder="Search stations..."
              onChange={(e) => onSearch?.(e.target.value)}
              className="pl-10 pr-4 py-2 w-64 bg-white/50 backdrop-blur-sm border border-neutral-border rounded-ui text-ui-sm placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-aurora focus:border-transparent transition-all"
            />
          </div>

          {/* Quick Stats */}
          <div className="hidden lg:flex items-center gap-4 text-ui-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-ghost-score-100" />
              <span className="text-text-secondary">143 Stations</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-aurora" />
              <span className="text-text-secondary">Live Data</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}