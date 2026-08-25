'use client';

/* eslint-disable react-hooks/set-state-in-effect -- Theme provider needs to read DOM after mount */

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
type ColorTheme = 'default' | 'mocha' | 'forest' | 'berry';

interface ThemeContextValue {
  theme: Theme;
  colorTheme: ColorTheme;
  toggleTheme: () => void;
  setColorTheme: (theme: ColorTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// This script runs before hydration to set the theme class on <html>,
// preventing the flash of incorrect theme and the hydration mismatch.
export const themeInitScript = `
(function() {
  try {
    var theme = localStorage.getItem('theme') || 'light';
    var colorTheme = localStorage.getItem('color-theme') || 'default';
    var root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    if (colorTheme !== 'default') root.classList.add('theme-' + colorTheme);
  } catch(e) {}
})();
`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start with default values. The inline script already applied the correct
  // classes to <html> before React hydrates. We sync our state after mount.
  const [theme, setTheme] = useState<Theme>('light');
  const [colorTheme, setColorThemeState] = useState<ColorTheme>('default');
  const [mounted, setMounted] = useState(false);

  // After mount, read the actual theme from the DOM.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Read theme from DOM when mounted.
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const isDark = root.classList.contains('dark');
    let color: ColorTheme = 'default';
    for (const c of ['mocha', 'forest', 'berry'] as const) {
      if (root.classList.contains('theme-' + c)) {
        color = c;
        break;
      }
    }
    // Use functional update to avoid lint error — only updates if value changed.
    setTheme((prev) => (prev !== (isDark ? 'dark' : 'light') ? (isDark ? 'dark' : 'light') : prev));
    setColorThemeState((prev) => (prev !== color ? color : prev));
  }, [mounted]);

  // Apply changes when theme/colorTheme is updated by user action.
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    root.classList.remove('dark', 'theme-mocha', 'theme-forest', 'theme-berry');
    if (theme === 'dark') root.classList.add('dark');
    if (colorTheme !== 'default') root.classList.add(`theme-${colorTheme}`);
    localStorage.setItem('theme', theme);
    localStorage.setItem('color-theme', colorTheme);
  }, [theme, colorTheme, mounted]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  const setColorTheme = (t: ColorTheme) => setColorThemeState(t);

  return (
    <ThemeContext.Provider
      value={{ theme, colorTheme, toggleTheme, setColorTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
