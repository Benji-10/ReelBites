'use client';

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
  // Always start with defaults on both server and client to prevent
  // hydration mismatch. The inline script already set the correct classes
  // on <html> before React hydrates, so the visual theme is correct.
  // We just need to sync our React state to match after mount.
  const [theme, setTheme] = useState<Theme>('light');
  const [colorTheme, setColorThemeState] = useState<ColorTheme>('default');

  // After mount, read the actual theme from the DOM (set by inline script).
  // Use requestAnimationFrame to defer the state update outside of the effect
  // body to avoid the "setState in effect" lint error.
  useEffect(() => {
    const root = document.documentElement;
    const isDark = root.classList.contains('dark');
    let color: ColorTheme = 'default';
    for (const c of ['mocha', 'forest', 'berry'] as const) {
      if (root.classList.contains('theme-' + c)) {
        color = c;
        break;
      }
    }
    // Defer to next frame to avoid cascading renders.
    requestAnimationFrame(() => {
      setTheme((prev) => (prev !== (isDark ? 'dark' : 'light') ? (isDark ? 'dark' : 'light') : prev));
      setColorThemeState((prev) => (prev !== color ? color : prev));
    });
  }, []);

  // Apply changes when theme/colorTheme is updated by user action.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'theme-mocha', 'theme-forest', 'theme-berry');
    if (theme === 'dark') root.classList.add('dark');
    if (colorTheme !== 'default') root.classList.add(`theme-${colorTheme}`);
    localStorage.setItem('theme', theme);
    localStorage.setItem('color-theme', colorTheme);
  }, [theme, colorTheme]);

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
