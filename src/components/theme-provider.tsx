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
  // Read the theme from the DOM (set by the inline script before hydration).
  // On the server, document is undefined so we default to 'light'.
  // suppressHydrationWarning on <html> prevents the mismatch error.
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(() => {
    if (typeof document === 'undefined') return 'default';
    const classes = document.documentElement.classList;
    for (const c of ['mocha', 'forest', 'berry']) {
      if (classes.contains('theme-' + c)) return c as ColorTheme;
    }
    return 'default';
  });

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
