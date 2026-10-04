"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

/** Switches between the dark and light themes; the icon shows the theme a press switches to. */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const next = theme === "light" ? "dark" : "light";
  const Icon = next === "dark" ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded text-ink-2 transition-colors duration-150",
        "hover:bg-ink/[.06] hover:text-ink active:translate-y-px",
        className,
      )}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
