/**
 * Zustand store for app-wide state.
 *
 * Manages:
 *   - Current view (extract, box, detail)
 *   - Saved recipes list
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

interface AppState {
  // Navigation
  view: AppView;
  setView: (view: AppView) => void;

  // Auth
  authToken: string | null;
  setAuthToken: (token: string | null) => void;

  // Recipes
  recipes: SavedRecipe[];
  setRecipes: (recipes: SavedRecipe[]) => void;
  addRecipe: (recipe: SavedRecipe) => void;
  updateRecipe: (recipe: SavedRecipe) => void;
  removeRecipe: (id: string) => void;
  fetchRecipes: () => Promise<void>;

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
