"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/** The localStorage key the inline script in src/app/layout.tsx reads before first paint. */
export const THEME_STORAGE_KEY = "ghost-stops-theme";

/**
 * Sets data-theme on <html> before the first paint (KTD15, R30), so a stored light theme never
 * flashes dark and the default is dark when nothing is stored. Kept dependency-free and small:
 * it runs as an inline script ahead of every stylesheet.
 */
export const THEME_SCRIPT = `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark")})();`;

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** Follows data-theme on <html>, the one place the theme lives. */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The server renders the default; the client reads what the inline script already applied.
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as const);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing or blocked storage: the theme still applies for this page view.
    }
  }, []);

  const toggleTheme = useCallback(() => setTheme(readTheme() === "light" ? "dark" : "light"), [setTheme]);

  const value = useMemo(() => ({ theme, toggleTheme, setTheme }), [theme, toggleTheme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
