"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "relative p-2 rounded-ui transition-all duration-200",
        "hover:bg-white/20 active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-ocean/50",
        className
      )}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <div className="relative w-5 h-5">
        {/* Sun icon - visible in light mode */}
        <Sun
          className={cn(
            "absolute inset-0 w-5 h-5 transition-all duration-300",
            theme === "light"
              ? "opacity-100 rotate-0 scale-100"
              : "opacity-0 rotate-90 scale-0"
          )}
        />
        {/* Moon icon - visible in dark mode */}
        <Moon
          className={cn(
            "absolute inset-0 w-5 h-5 transition-all duration-300",
            theme === "dark"
              ? "opacity-100 rotate-0 scale-100"
              : "opacity-0 -rotate-90 scale-0"
          )}
        />
      </div>
    </button>
  );
}
