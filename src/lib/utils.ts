import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Glass effect utilities
export function glass(opacity: number = 0.72, blur: number = 16) {
  return {
    backgroundColor: `rgba(255, 255, 255, ${opacity})`,
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    border: '1px solid rgba(15, 23, 42, 0.08)',
  }
}

// Ghost score color mapping
export function getGhostScoreColor(score: number): string {
  if (score >= 80) return "#DC2626" // red-600
  if (score >= 60) return "#EA580C" // orange-600
  if (score >= 40) return "#F59E0B" // amber-500
  if (score >= 20) return "#84CC16" // lime-500
  return "#22C55E" // green-500
}

// CTA line color mapping
export const ctaLineColors = {
  "Red": "#C60C30",
  "Blue": "#00A1DE",
  "Brown": "#62361B",
  "Green": "#009B3A",
  "Orange": "#F9461C",
  "Purple": "#522398",
  "Purple Express": "#522398",
  "Pink": "#E27EA6",
  "Yellow": "#F9E300"
} as const

export function getLineColor(line: string): string {
  return ctaLineColors[line as keyof typeof ctaLineColors] || "#666666"
}