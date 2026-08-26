/**
 * User settings stored in localStorage.
 *
 * Per-category unit preferences:
 *   - smallLiquid: tsp/tbsp vs ml (for small liquid measurements)
 *   - largeLiquid: cups/pints/gallons vs liters (for large liquid measurements)
 *   - weight: oz/lbs vs g/kg (for weight measurements)
 *   - dry: cups vs g (for dry ingredients like flour, sugar)
 *   - temperature: °F vs °C
 */

import { create } from 'zustand';

export type UnitPreference = 'metric' | 'imperial';

export interface UserSettings {
  // Per-category unit preferences
  smallLiquid: UnitPreference; // tsp/tbsp vs ml
  largeLiquid: UnitPreference; // cups/pints/gallons vs liters
  weight: UnitPreference; // oz/lbs vs g/kg
  dry: UnitPreference; // cups vs g (for flour, sugar, etc.)
  temperature: UnitPreference; // °F vs °C
  // Other settings
  defaultServings: number;
}

interface SettingsStore extends UserSettings {
  setSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  setAllMetric: () => void;
  setAllImperial: () => void;
  loadSettings: () => void;
}

const DEFAULT_SETTINGS: UserSettings = {
  smallLiquid: 'metric',
  largeLiquid: 'metric',
  weight: 'metric',
  dry: 'metric',
  temperature: 'metric',
  defaultServings: 4,
};

function loadFromStorage(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const saved = localStorage.getItem('realbites-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

function saveToStorage(settings: UserSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('realbites-settings', JSON.stringify(settings));
  } catch {}
}

export const useSettings = create<SettingsStore>((set) => ({
  ...DEFAULT_SETTINGS,

  setSetting: (key, value) => {
    set((state) => {
      const newSettings = { ...state, [key]: value };
      saveToStorage(newSettings);
      return { [key]: value } as Partial<SettingsStore>;
    });
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
      saveToStorage(newSettings);
      return newSettings;
    });
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
      saveToStorage(newSettings);
      return newSettings;
    });
  },

  loadSettings: () => {
    const loaded = loadFromStorage();
    set(loaded);
  },
}));
