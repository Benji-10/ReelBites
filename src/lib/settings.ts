/**
 * User settings stored in localStorage.
 *
 * Settings include:
 *   - unitSystem: 'metric' | 'imperial' — default unit display for all recipes
 *   - defaultServings: number — default serving size for new recipes
 */

import { create } from 'zustand';

export type UnitSystem = 'metric' | 'imperial';

export interface UserSettings {
  unitSystem: UnitSystem;
  defaultServings: number;
}

interface SettingsStore extends UserSettings {
  setUnitSystem: (system: UnitSystem) => void;
  setDefaultServings: (servings: number) => void;
  loadSettings: () => void;
}

const DEFAULT_SETTINGS: UserSettings = {
  unitSystem: 'metric',
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

export const useSettings = create<SettingsStore>((set) => ({
  ...DEFAULT_SETTINGS,

  setUnitSystem: (unitSystem) => {
    set({ unitSystem });
    if (typeof window !== 'undefined') {
      const current = loadFromStorage();
      localStorage.setItem('realbites-settings', JSON.stringify({ ...current, unitSystem }));
    }
  },

  setDefaultServings: (defaultServings) => {
    set({ defaultServings });
    if (typeof window !== 'undefined') {
      const current = loadFromStorage();
      localStorage.setItem('realbites-settings', JSON.stringify({ ...current, defaultServings }));
    }
  },

  loadSettings: () => {
    const loaded = loadFromStorage();
    set(loaded);
  },
}));
