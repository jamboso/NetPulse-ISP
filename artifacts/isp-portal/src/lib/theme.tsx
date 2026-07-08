import { createContext, useContext, useEffect, useState } from "react";

export type ThemeId = "current" | "daylight" | "night-ops" | "terracotta";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  preview: { sidebar: string; accent: string; bg: string };
}

export const THEMES: ThemeMeta[] = [
  {
    id: "current",
    label: "Current",
    description: "Navy sidebar with blue accents",
    preview: { sidebar: "#0a192f", accent: "#2563eb", bg: "#f8fafc" },
  },
  {
    id: "daylight",
    label: "Daylight",
    description: "Light, airy, minimal with slate accents",
    preview: { sidebar: "#f1f5f9", accent: "#2563eb", bg: "#ffffff" },
  },
  {
    id: "night-ops",
    label: "Night Ops",
    description: "Dark NOC console with cyan accents",
    preview: { sidebar: "#000000", accent: "#22d3ee", bg: "#020617" },
  },
  {
    id: "terracotta",
    label: "Terracotta",
    description: "Warm cream tones with terracotta accents",
    preview: { sidebar: "#fdf4ef", accent: "#c2410c", bg: "#fdf8f4" },
  },
];

const STORAGE_KEY = "netpulse-theme";
const DEFAULT_THEME: ThemeId = "night-ops";

interface ThemeCtx {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: DEFAULT_THEME, setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    return saved && THEMES.find(t => t.id === saved) ? saved : DEFAULT_THEME;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, []);

  const setTheme = (t: ThemeId) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
