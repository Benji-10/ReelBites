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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialize from localStorage synchronously to avoid flash.
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = localStorage.getItem('theme') as Theme | null;
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(() => {
    if (typeof window === 'undefined') return 'default';
    return (localStorage.getItem('color-theme') as ColorTheme | null) || 'default';
  });

  // Apply theme to document.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'theme-mocha', 'theme-forest', 'theme-berry');

    if (theme === 'dark') {
      root.classList.add('dark');
    }
    if (colorTheme !== 'default') {
      root.classList.add(`theme-${colorTheme}`);
    }

    localStorage.setItem('theme', theme);
    localStorage.setItem('color-theme', colorTheme);
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
