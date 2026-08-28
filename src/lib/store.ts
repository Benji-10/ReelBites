/**
 * Zustand store for app-wide state.
 *
 * Manages:
 *   - Current view (extract, box, detail)
 *   - Saved recipes list (cached for route switching)
 *   - Pantry items (cached for route switching)
 *   - Shopping lists + items (cached for route switching)
 *   - Current extraction state (URL, progress, result, error)
 *   - Auth token (for API calls)
 */

import { create } from 'zustand';
import type { AppView, SavedRecipe } from './types';

export interface ExtractionState {
  url: string;
  status: 'idle' | 'processing' | 'completed' | 'failed';
  progress: number;
  step: string;
  message: string;
  recipe: SavedRecipe | null;
  error: string | null;
  logs: Array<{ step: string; message: string; progress: number; timestamp: number }>;
}

export interface CachedPantryItem {
  id: string;
  name: string;
  genericName: string | null;
  category: string | null;
  quantity: string | null;
  expiryDate: string | null;
  barcode: string | null;
  isRunningLow: boolean;
  fillPercent?: number;
}

export interface CachedShoppingItem {
  id: string;
  name: string;
  genericName: string | null;
  quantity: string | null;
  section: string | null;
  sectionOrder: number;
  isChecked: boolean;
  recipeId: string | null;
}

export interface CachedShoppingList {
  id: string;
  name: string;
  storeName: string | null;
  items: CachedShoppingItem[];
}

interface AppState {
  // Navigation
  view: AppView;
  setView: (view: AppView) => void;

  // Auth
  authToken: string | null;
  setAuthToken: (token: string | null) => void;

  // Recipes (cached)
  recipes: SavedRecipe[];
  setRecipes: (recipes: SavedRecipe[]) => void;
  addRecipe: (recipe: SavedRecipe) => void;
  updateRecipe: (recipe: SavedRecipe) => void;
  removeRecipe: (id: string) => void;
  fetchRecipes: () => Promise<void>;

  // Pantry (cached for route switching)
  pantryItems: CachedPantryItem[];
  setPantryItems: (items: CachedPantryItem[]) => void;
  addPantryItem: (item: CachedPantryItem) => void;
  updatePantryItem: (item: CachedPantryItem) => void;
  removePantryItem: (id: string) => void;
  fetchPantry: () => Promise<void>;

  // Shopping lists (cached for route switching)
  shoppingLists: CachedShoppingList[];
  setShoppingLists: (lists: CachedShoppingList[]) => void;
  fetchShoppingLists: () => Promise<void>;

  // Extraction
  extraction: ExtractionState;
  startExtraction: (url: string) => void;
  updateExtraction: (update: Partial<ExtractionState>) => void;
  resetExtraction: () => void;
}

const initialExtraction: ExtractionState = {
  url: '',
  status: 'idle',
  progress: 0,
  step: '',
  message: '',
  recipe: null,
  error: null,
  logs: [],
};

export const useStore = create<AppState>((set, get) => ({
  view: { name: 'extract' },
  setView: (view) => set({ view }),

  authToken: null,
  setAuthToken: (token) => set({ authToken: token }),

  // ---- Recipes ----
  recipes: [],
  setRecipes: (recipes) => set({ recipes }),
  addRecipe: (recipe) =>
    set((state) => ({ recipes: [recipe, ...state.recipes] })),
  updateRecipe: (recipe) =>
    set((state) => ({
      recipes: state.recipes.map((r) => (r.id === recipe.id ? recipe : r)),
    })),
  removeRecipe: (id) =>
    set((state) => ({ recipes: state.recipes.filter((r) => r.id !== id) })),
  fetchRecipes: async () => {
    const { authToken } = get();
    try {
      const response = await fetch('/api/recipes', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const data = await response.json();
      if (data.recipes) {
        set({ recipes: data.recipes as SavedRecipe[] });
      }
    } catch (err) {
      console.error('Failed to fetch recipes:', err);
    }
  },

  // ---- Pantry (cached) ----
  pantryItems: [],
  setPantryItems: (items) => set({ pantryItems: items }),
  addPantryItem: (item) =>
    set((state) => ({ pantryItems: [...state.pantryItems, item] })),
  updatePantryItem: (item) =>
    set((state) => ({
      pantryItems: state.pantryItems.map((p) => (p.id === item.id ? item : p)),
    })),
  removePantryItem: (id) =>
    set((state) => ({ pantryItems: state.pantryItems.filter((p) => p.id !== id) })),
  fetchPantry: async () => {
    const { authToken } = get();
    try {
      const response = await fetch('/api/pantry', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const data = await response.json();
      if (data.items) {
        set({ pantryItems: data.items as CachedPantryItem[] });
      }
    } catch (err) {
      console.error('Failed to fetch pantry:', err);
    }
  },

  // ---- Shopping lists (cached) ----
  shoppingLists: [],
  setShoppingLists: (lists) => set({ shoppingLists: lists }),
  fetchShoppingLists: async () => {
    const { authToken } = get();
    try {
      const response = await fetch('/api/shopping-lists', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const data = await response.json();
      if (data.lists) {
        set({ shoppingLists: data.lists as CachedShoppingList[] });
      }
    } catch (err) {
      console.error('Failed to fetch shopping lists:', err);
    }
  },

  // ---- Extraction ----
  extraction: initialExtraction,
  startExtraction: (url) =>
    set({
      extraction: {
        ...initialExtraction,
        url,
        status: 'processing',
        step: 'start',
        message: 'Starting...',
        progress: 0,
        logs: [
          {
            step: 'start',
            message: 'Starting extraction pipeline...',
            progress: 0,
            timestamp: Date.now(),
          },
        ],
      },
    }),
  updateExtraction: (update) =>
    set((state) => {
      const newExtraction = { ...state.extraction, ...update };
      // Add log entry if message changed.
      if (update.message && update.message !== state.extraction.message) {
        newExtraction.logs = [
          ...state.extraction.logs,
          {
            step: update.step || state.extraction.step,
            message: update.message,
            progress: update.progress ?? state.extraction.progress,
            timestamp: Date.now(),
          },
        ];
      }
      return { extraction: newExtraction };
    }),
  resetExtraction: () => set({ extraction: initialExtraction }),
}));
