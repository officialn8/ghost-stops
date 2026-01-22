import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // Existing CSS var colors (for shadcn compatibility)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // === DESIGN TOKENS v2 ===

        // Neutrals - default borders are NEUTRAL (not purple-tinted)
        neutral: {
          bg: "#F6F7FB",
          surface: "rgba(255, 255, 255, 0.72)",
          "surface-solid": "#FFFFFF",
          "surface-muted": "#EEE5E9", // Lavender Blush
          border: "rgba(11, 18, 32, 0.08)", // Neutral ink (NOT purple)
          "border-active": "#4F1271", // Indigo for focus/active only
          plum: "#513B3C", // Chocolate Plum
          grey: "#7C7C7C",
        },

        // Brand Colors - named (no confusing numeric scale)
        brandIndigo: "#4F1271",   // Primary: text, borders, selected
        brandWisteria: "#7F96FF", // Glow: halos, gradients (NOT text)

        // Emerald scale (replaces aurora)
        emerald: {
          DEFAULT: "#06D6A0",
          50: "#E6FFF7",
          100: "#CCFFF0",
          200: "#99FFE0",
          300: "#66F5CF",
          400: "#33E8BD",
          500: "#06D6A0",
          600: "#05B085",
          700: "#048A6A",
          800: "#03654F",
          900: "#024035",
        },

        // Palette accent colors (avoiding conflict with shadcn 'accent')
        palette: {
          ocean: "#0090C1",      // Links/buttons on white
          coral: "#F25757",
          grapefruit: "#FF6B6B",
          tangerine: "#F58549",
          lemon: "#F7E733",
          lightGreen: "#7AE582",
        },

        // Ghost Theme Accents - updated with new palette
        ghost: {
          glow: "rgba(79, 18, 113, 0.15)",  // Indigo-based
          mist: "rgba(6, 214, 160, 0.12)",  // Emerald-based
          ink: "rgba(11, 18, 32, 0.08)",
          // Ghost score colors DISTINCT from line colors
          score: {
            100: "#DC2626", // Deep red (NOT coral)
            80: "#EA580C",  // Orange (NOT tangerine)
            60: "#F59E0B",  // Amber
            40: "#84CC16",  // Lime (NOT light green)
            20: "#22C55E",  // Green (NOT emerald)
          }
        },

        // CTA Line Brand Colors (NOT official CTA colors)
        cta: {
          red: "#F25757",     // Vibrant Coral
          blue: "#0090C1",    // Ocean Blue
          brown: "#513B3C",   // Chocolate Plum
          green: "#06D6A0",   // Emerald
          orange: "#F58549",  // Atomic Tangerine
          purple: "#4F1271",  // Indigo
          pink: "#FF6B6B",    // Grapefruit Pink
          yellow: "#F7E733",  // Bright Lemon
        },

        // Text Colors
        text: {
          primary: "#0B1220",
          secondary: "rgba(11, 18, 32, 0.72)",
          tertiary: "rgba(11, 18, 32, 0.52)",
        }
      },

      // Typography Scale
      fontSize: {
        // Display
        "display-1": ["3.5rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-2": ["2.75rem", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" }],
        "display-3": ["2.25rem", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],

        // UI
        "ui-xl": ["1.5rem", { lineHeight: "1.4", fontWeight: "600" }],
        "ui-lg": ["1.25rem", { lineHeight: "1.5", fontWeight: "600" }],
        "ui-md": ["1rem", { lineHeight: "1.5", fontWeight: "500" }],
        "ui-sm": ["0.875rem", { lineHeight: "1.5", fontWeight: "500" }],
        "ui-xs": ["0.75rem", { lineHeight: "1.5", fontWeight: "500", letterSpacing: "0.05em" }],
      },

      // Shadows (light-mode tuned)
      boxShadow: {
        "sm": "0 1px 2px rgba(15, 23, 42, 0.06)",
        "md": "0 8px 24px rgba(15, 23, 42, 0.10)",
        "lg": "0 20px 60px rgba(15, 23, 42, 0.14)",
        "glass": "0 8px 24px rgba(15, 23, 42, 0.10), inset 0 0 0 1px rgba(255, 255, 255, 0.2)",
        "hover": "0 12px 32px rgba(15, 23, 42, 0.12)",
      },

      // Border Radius Scale
      borderRadius: {
        // UI elements
        "ui": "14px",
        "ui-sm": "12px",
        "ui-lg": "16px",

        // Panels
        "panel": "20px",
        "panel-sm": "18px",
        "panel-lg": "22px",

        // Existing (keep for compatibility)
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      // Backdrop filters
      backdropBlur: {
        xs: "4px",
        glass: "16px",
        heavy: "24px",
      },

      // Animations
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "ghost-fade": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "ghost-shimmer": {
          "0%": { backgroundPosition: "-200%" },
          "100%": { backgroundPosition: "200%" },
        },
        "ghost-pulse": {
          "0%, 100%": { opacity: "0.8", transform: "scale(1)" },
          "50%": { opacity: "0.6", transform: "scale(1.02)" },
        },
        "ghost-float": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "mist-drift": {
          "0%": { transform: "translateX(-100%)", opacity: "0" },
          "20%": { opacity: "0.4" },
          "80%": { opacity: "0.4" },
          "100%": { transform: "translateX(100%)", opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "ghost-fade": "ghost-fade 0.6s ease-out",
        "ghost-shimmer": "ghost-shimmer 2s linear infinite",
        "ghost-pulse": "ghost-pulse 2s ease-in-out infinite",
        "ghost-float": "ghost-float 3s ease-in-out infinite",
        "mist-drift": "mist-drift 8s ease-in-out infinite",
      },

      // Spacing for glass effects
      spacing: {
        "glass-blur": "16px",
        "glass-padding": "24px",
      },
    },
  },
  plugins: [],
} satisfies Config;
