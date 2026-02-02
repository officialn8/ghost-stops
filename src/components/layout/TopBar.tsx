"use client";

import { Search } from "lucide-react";
import { ThemeToggle } from "@/components/theme";
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
            <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-brandIndigo/20 to-emerald-500/20 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full animate-ghost-pulse bg-ghost-glow blur-sm" />
              <div className="absolute -inset-1 rounded-full border border-brandWisteria/30 opacity-60 animate-[ghost-pulse_3.2s_ease-in-out_infinite]" />
              <svg
                className="w-6 h-6 text-brandIndigo relative z-10 animate-[ghost-float_4s_ease-in-out_infinite]"
                fill="none"
                viewBox="-130 -130 260 260"
              >
                <path
                  d="M0,-120 C-66.3,-120 -120,-66.3 -120,0 L-120,80 C-120,96 -108,108 -96,108 C-84,108 -72,96 -72,80 C-72,96 -60,108 -48,108 C-36,108 -24,96 -24,80 C-24,96 -12,108 0,108 C12,108 24,96 24,80 C24,96 36,108 48,108 C60,108 72,96 72,80 C72,96 84,108 96,108 C108,108 120,96 120,80 L120,0 C120,-66.3 66.3,-120 0,-120 Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="10"
                  strokeLinejoin="round"
                />
                <circle cx="-32" cy="-22" r="14" fill="rgba(255, 255, 255, 0.95)" />
                <circle cx="32" cy="-22" r="14" fill="rgba(255, 255, 255, 0.95)" />
                <circle cx="-32" cy="-22" r="6" fill="currentColor" />
                <circle cx="32" cy="-22" r="6" fill="currentColor" />
                <path
                  d="M-18 12 Q0 26 18 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeLinecap="round"
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
          <div className="relative glass-card rounded-ui overflow-hidden transition-all focus-within:ring-2 focus-within:ring-palette-ocean/40">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              placeholder="Search stations..."
              onChange={(e) => onSearch?.(e.target.value)}
              className="pl-10 pr-4 py-2 w-64 bg-transparent text-ui-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
          </div>

          {/* Quick Stats */}
          <div className="hidden lg:flex items-center gap-4 text-ui-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-ghost-score-100" />
              <span className="text-text-secondary">143 Stations</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald" />
              <span className="text-text-secondary">Live Data</span>
            </div>
          </div>

          {/* Theme Toggle */}
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}