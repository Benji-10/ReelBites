/**
 * Shared TypeScript types for the Recipe Extractor app.
 */

export interface InstagramPost {
  videoUrl: string | null;
  caption: string | null;
  comments: InstagramComment[];
  thumbnailUrl: string | null;
  author: string | null;
  postId: string | null;
  shortCode: string | null;
}

export interface InstagramComment {
  text: string;
  author: string;
  likes: number;
  isPinned: boolean;
  isAuthor?: boolean;
}

export interface VideoFrame {
  path: string;
  timestamp: number;
  text: string;
}

export interface ExtractionProgress {
  step: string;
  message: string;
  progress: number; // 0-100
  status: 'processing' | 'completed' | 'failed';
  error?: string;
  data?: unknown;
}

export interface RecipeIngredient {
  name: string;
  amount: string | null;
  unit: string | null;
  notes?: string | null;
  evidence?: string | null;
  flag?: string | null;
}

export interface RecipeInstruction {
  step: string;
  evidence?: string | null;
  flag?: string | null;
  ingredientRefs?: number[]; // indices of ingredients used in this step
}

export interface RecipeMetadata {
  key: string;
  value: string;
  evidence?: string | null;
  flag?: string | null;
}

export interface RecipeFlag {
  type: string;
  message: string;
  field?: string;
  severity: 'info' | 'warning' | 'error';
}

export interface GeneratedRecipe {
  title: string;
  description: string;
  foodHint?: boolean;
  needsOcr?: boolean;
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
  metadata: RecipeMetadata[];
  flags: RecipeFlag[];
  sourceUrl: string;
  sourceCaption: string;
  sourceComments: InstagramComment[];
  transcript: string;
  ocrText: string;
  imageUrl?: string | null;
  sourceVideoUrl?: string | null;
}

export interface SavedRecipe {
  id: string;
  title: string;
  description: string | null;
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
  metadata: RecipeMetadata[];
  flags: RecipeFlag[];
  sourceUrl: string | null;
  sourceCaption: string | null;
  sourceComments: InstagramComment[] | null;
  transcript: string | null;
  ocrText: string | null;
  imageUrl: string | null;
  sourceVideoUrl: string | null;
  isFavorite: boolean;
  tags: string[] | null;
  collection: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AppView =
  | { name: 'extract' }
  | { name: 'box' }
  | { name: 'detail'; recipeId: string };
