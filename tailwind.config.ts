import type { Config } from "tailwindcss";

/**
 * Wayfinding design system (docs/audit-2026-10-02/design.md, Direction A). Colors, type, and radii
 * replace Tailwind's defaults rather than extending them, so a component can only reach for a
 * token. The token values live in src/app/globals.css.
 *
 * - Color: ink and its two quieter steps on two surfaces, plus a hairline rule. The CTA line
 *   colors are not here; they come from the one table in src/lib/utils.ts as inline styles.
 * - Type: Archivo for words (the `font-narrow` utility for station names), JetBrains Mono for
 *   every number. Scale 11 / 13 / 15 / 18 / 24 / 36 / 56, as `text-13` and so on; nothing smaller.
 * - Radius: 4px for controls (`rounded`), 0 for panels and bars (`rounded-none`), full for dots.
 * - Breakpoints: md (768) switches from the phone layout; lg (1100) puts the ledger beside an
 *   open drawer.
 */
export default {
  // ThemeProvider and the inline script in src/app/layout.tsx set data-theme on <html> (KTD15).
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    screens: {
      md: "768px",
      lg: "1100px",
      xl: "1440px",
    },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      surface: "rgb(var(--surface) / <alpha-value>)",
      "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
      ink: "rgb(var(--ink) / <alpha-value>)",
      "ink-2": "rgb(var(--ink) / var(--ink-2-alpha))",
      "ink-3": "rgb(var(--ink) / var(--ink-3-alpha))",
      rule: "rgb(var(--ink) / var(--rule-alpha))",
    },
    fontFamily: {
      sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
      mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
    },
    fontSize: {
      "11": ["11px", { lineHeight: "16px" }],
      "13": ["13px", { lineHeight: "20px" }],
      "15": ["15px", { lineHeight: "24px" }],
      "18": ["18px", { lineHeight: "24px" }],
      "24": ["24px", { lineHeight: "28px" }],
      "36": ["36px", { lineHeight: "38px" }],
      "56": ["56px", { lineHeight: "56px" }],
    },
    borderRadius: {
      none: "0",
      DEFAULT: "4px",
      full: "9999px",
    },
    extend: {
      boxShadow: {
        // The one shadow: the drawer's edge over the map, tinted to the theme's ink.
        panel: "-16px 0 40px -24px rgb(var(--shadow) / 0.5)",
      },
      // Layers, bottom to top. Nothing else sets a z-index.
      zIndex: {
        map: "0",
        chrome: "10",
        drawer: "20",
        sheet: "30",
        banner: "40",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
