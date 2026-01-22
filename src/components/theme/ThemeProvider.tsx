"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  // Helper to apply theme to DOM
  const applyTheme = (newTheme: Theme) => {
    document.documentElement.setAttribute("data-theme", newTheme);
    // Also toggle 'dark' class for Tailwind compatibility
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  // Initialize theme from localStorage or system preference
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("ghost-stops-theme") as Theme | null;
    if (stored) {
      setThemeState(stored);
      applyTheme(stored);
    } else {
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      const initial = prefersDark ? "dark" : "light";
      setThemeState(initial);
      applyTheme(initial);
    }
  }, []);

  // Update DOM and localStorage when theme changes
  useEffect(() => {
    if (mounted) {
      applyTheme(theme);
      localStorage.setItem("ghost-stops-theme", theme);
    }
  }, [theme, mounted]);

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem("ghost-stops-theme");
      // Only auto-switch if user hasn't manually set a preference
      if (!stored) {
        setThemeState(e.matches ? "dark" : "light");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
  }, []);

  // Prevent flash of wrong theme
  if (!mounted) {
    return (
      <ThemeContext.Provider value={{ theme: "light", toggleTheme, setTheme }}>
        {children}
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
