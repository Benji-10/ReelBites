/**
 * User settings — synced across devices via the database.
 *
 * Settings include:
 *   - Theme (light/dark + color theme)
 *   - Per-category unit preferences
 *   - Default servings
 *
 * On first load, settings are read from localStorage (for instant UI).
 * If the user is logged in, settings are then synced from the server.
 * When settings change, they're saved to both localStorage AND the server.
 */

import { create } from 'zustand';

export type UnitPreference = 'metric' | 'imperial';
export type InventoryDeduction = 'auto' | 'confirm' | 'none';
type Theme = 'light' | 'dark';
type ColorTheme = 'default' | 'mocha' | 'forest' | 'berry';

export interface UserSettings {
  // Theme
  theme: Theme;
  colorTheme: ColorTheme;
  // Per-category unit preferences
  smallLiquid: UnitPreference;
  largeLiquid: UnitPreference;
  weight: UnitPreference;
  dry: UnitPreference;
  temperature: UnitPreference;
  // Other settings
  defaultServings: number;
  // Inventory deduction after cooking
  inventoryDeduction: InventoryDeduction;
  // Language preferences
  languages: string[]; // Languages the user speaks (e.g. ["en", "ja"])
  defaultLanguage: string; // Language to generate recipes in (e.g. "en")
}

interface SettingsStore extends UserSettings {
  setSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  setAllMetric: () => void;
  setAllImperial: () => void;
  loadFromStorage: () => void;
  syncFromServer: (authToken: string | null) => Promise<void>;
  syncToServer: (authToken: string | null) => Promise<void>;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  colorTheme: 'default',
  smallLiquid: 'metric',
  largeLiquid: 'metric',
  weight: 'metric',
  dry: 'metric',
  temperature: 'metric',
  defaultServings: 4,
  inventoryDeduction: 'confirm',
  languages: ['en'],
  defaultLanguage: 'en',
};

const STORAGE_KEY = 'realbites-settings';

function loadFromLocalStorage(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

// Initialize from localStorage synchronously — prevents theme flash on load.
// On the server (SSR), this returns DEFAULT_SETTINGS (light).
// On the client, this reads localStorage before first paint.
const INITIAL_SETTINGS = loadFromLocalStorage();

function saveToLocalStorage(settings: UserSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

let syncTimeout: ReturnType<typeof setTimeout> | null = null;

export const useSettings = create<SettingsStore>((set, get) => ({
  ...INITIAL_SETTINGS,

  setSetting: (key, value) => {
    set((state) => {
      const newSettings = { ...state, [key]: value };
      saveToLocalStorage(newSettings);
      return { [key]: value } as Partial<SettingsStore>;
    });
    // Debounce server sync — don't save on every keystroke.
    const state = get();
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      // syncToServer is called by the component that has the authToken.
      // We trigger a custom event that the AppShell listens for.
      window.dispatchEvent(new CustomEvent('settings-changed'));
    }, 1000);
  },

  setAllMetric: () => {
    set((state) => {
      const newSettings: UserSettings = {
        ...state,
        smallLiquid: 'metric',
        largeLiquid: 'metric',
        weight: 'metric',
        dry: 'metric',
        temperature: 'metric',
      };
      saveToLocalStorage(newSettings);
      return newSettings;
    });
    window.dispatchEvent(new CustomEvent('settings-changed'));
  },

  setAllImperial: () => {
    set((state) => {
      const newSettings: UserSettings = {
        ...state,
        smallLiquid: 'imperial',
        largeLiquid: 'imperial',
        weight: 'imperial',
        dry: 'imperial',
        temperature: 'imperial',
      };
      saveToLocalStorage(newSettings);
      return newSettings;
    });
    window.dispatchEvent(new CustomEvent('settings-changed'));
  },

  loadFromStorage: () => {
    const loaded = loadFromLocalStorage();
    set(loaded);
  },

  syncFromServer: async (authToken) => {
    if (!authToken) return; // Not logged in — use localStorage only.
    try {
      const response = await fetch('/api/settings', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.settings) {
        const serverSettings = { ...DEFAULT_SETTINGS, ...data.settings };
        // Merge: server settings take priority, but we keep localStorage as fallback.
        set(serverSettings);
        saveToLocalStorage(serverSettings);
      }
    } catch (err) {
      console.warn('Could not sync settings from server:', err);
    }
  },

  syncToServer: async (authToken) => {
    if (!authToken) return; // Not logged in — localStorage only.
    try {
      const currentSettings: UserSettings = {
        theme: get().theme,
        colorTheme: get().colorTheme,
        smallLiquid: get().smallLiquid,
        largeLiquid: get().largeLiquid,
        weight: get().weight,
        dry: get().dry,
        temperature: get().temperature,
        defaultServings: get().defaultServings,
        inventoryDeduction: get().inventoryDeduction,
        languages: get().languages,
        defaultLanguage: get().defaultLanguage,
      };
      await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(currentSettings),
      });
    } catch (err) {
      console.warn('Could not sync settings to server:', err);
    }
  },
}));
