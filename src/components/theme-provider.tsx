'use client';

/* eslint-disable react-hooks/set-state-in-effect */

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

// This script runs before hydration to set the theme class on <html>.
// It MUST be in the <body> (not <head>) so it runs before React hydrates.
export const themeInitScript = `
(function() {
  try {
    var theme = localStorage.getItem('theme') || 'light';
    var colorTheme = localStorage.getItem('color-theme') || 'default';
    var root = document.documentElement;
    root.classList.remove('dark', 'theme-mocha', 'theme-forest', 'theme-berry');
    if (theme === 'dark') root.classList.add('dark');
    if (colorTheme !== 'default') root.classList.add('theme-' + colorTheme);
  } catch(e) {}
})();
`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [colorTheme, setColorThemeState] = useState<ColorTheme>('default');

  // After mount, read the actual theme from localStorage (not DOM).
  useEffect(() => {
    try {
      const savedTheme = (localStorage.getItem('theme') as Theme) || 'light';
      const savedColor = (localStorage.getItem('color-theme') as ColorTheme) || 'default';
      setTheme(savedTheme);
      setColorThemeState(savedColor);
    } catch {}
  }, []);

  // Apply theme to DOM whenever it changes.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'theme-mocha', 'theme-forest', 'theme-berry');
    if (theme === 'dark') root.classList.add('dark');
    if (colorTheme !== 'default') root.classList.add(`theme-${colorTheme}`);
    try {
      localStorage.setItem('theme', theme);
      localStorage.setItem('color-theme', colorTheme);
    } catch {}
  }, [theme, colorTheme]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  const setColorTheme = (t: ColorTheme) => setColorThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, colorTheme, toggleTheme, setColorTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
