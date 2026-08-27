'use client';

import { createContext, useContext, useEffect } from 'react';
import { useSettings } from '@/lib/settings';

type Theme = 'light' | 'dark';
type ColorTheme = 'default' | 'mocha' | 'forest' | 'berry';

interface ThemeContextValue {
  theme: Theme;
  colorTheme: ColorTheme;
  toggleTheme: () => void;
  setColorTheme: (theme: ColorTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Inline script that runs before hydration to set the theme class on <html>.
export const themeInitScript = `
(function() {
  try {
    var raw = localStorage.getItem('realbites-settings');
    var settings = raw ? JSON.parse(raw) : {};
    var theme = settings.theme || 'light';
    var colorTheme = settings.colorTheme || 'default';
    var root = document.documentElement;
    root.classList.remove('dark', 'theme-mocha', 'theme-forest', 'theme-berry');
    if (theme === 'dark') root.classList.add('dark');
    if (colorTheme !== 'default') root.classList.add('theme-' + colorTheme);
  } catch(e) {}
})();
`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, colorTheme, setSetting } = useSettings();

  // Apply theme to DOM whenever it changes.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'theme-mocha', 'theme-forest', 'theme-berry');
    if (theme === 'dark') root.classList.add('dark');
    if (colorTheme !== 'default') root.classList.add(`theme-${colorTheme}`);
  }, [theme, colorTheme]);

  const toggleTheme = () => setSetting('theme', theme === 'light' ? 'dark' : 'light');
  const setColorTheme = (t: ColorTheme) => setSetting('colorTheme', t);

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
