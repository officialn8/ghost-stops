// CTA Line Colors - Brand palette
export const ctaLineColors = {
  "Red": "#F25757",
  "Blue": "#0090C1",
  "Brown": "#513B3C",
  "Green": "#06D6A0",
  "Orange": "#F58549",
  "Purple": "#4F1271",
  "Pink": "#FF6B6B",
  "Yellow": "#F7E733"
} as const;

export type CTALine = keyof typeof ctaLineColors;

// Get color for a line
export function getLineColor(line: string): string {
  return ctaLineColors[line as CTALine] || '#666666';
}

// Mock line data removed - use real data from database
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getMockLinesForStation(_stationName: string): string[] {
  // Deprecated - station lines should come from the database
  return ['Red'];
}