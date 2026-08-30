'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, X, RefreshCw, Wand2, Plus, ChefHat, Clock, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import type { SavedRecipe } from '@/lib/types';

interface PantryRecipeGeneratorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = 'inspiration' | 'strict';

interface TempRecipe extends SavedRecipe {
  _isTempPantryRecipe?: boolean;
}

export function PantryRecipeGenerator({ open, onOpenChange }: PantryRecipeGeneratorProps) {
  const [mode, setMode] = useState<Mode>('inspiration');
  const [loading, setLoading] = useState(false);
  const [recipes, setRecipes] = useState<TempRecipe[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);
  const { authToken, addRecipe } = useStore();
  const router = useRouter();

  async function generate() {
    setLoading(true);
    setRecipes([]);

    try {
      const response = await fetch('/api/pantry-recipes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ mode }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to generate recipes.' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setRecipes(data.recipes || []);
      setHasGenerated(true);
      toast.success(`Generated ${data.recipes?.length || 0} recipes from your pantry!`);
    } catch (err) {
      toast.error('Could not generate recipes: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function viewRecipe(recipe: TempRecipe) {
    // Add to store so the recipe detail view can find it.
    addRecipe(recipe as SavedRecipe);
    onOpenChange(false);
    router.push(`/recipes/${recipe.id}`);
  }

  async function saveRecipe(recipe: TempRecipe) {
    try {
      // Save to DB via the recipes API.
      const response = await fetch('/api/recipes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          title: recipe.title,
          description: recipe.description,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          metadata: recipe.metadata,
          flags: recipe.flags,
          tags: recipe.tags,
          sourceUrl: recipe.sourceUrl,
        }),
      });

      if (!response.ok) throw new Error('Failed to save recipe.');

      const data = await response.json();
      const savedRecipe = { ...recipe, id: data.recipe.id, _isTempPantryRecipe: false };

      // Update the store: remove the temp recipe, add the real one.
      addRecipe(savedRecipe as SavedRecipe);

      // Update local state to show it's saved.
      setRecipes((prev) =>
        prev.map((r) => (r.id === recipe.id ? { ...r, _isTempPantryRecipe: false, id: data.recipe.id } : r)),
      );

      toast.success(`"${recipe.title}" added to your recipe box!`);
    } catch (err) {
      toast.error('Could not save recipe: ' + (err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Wand2 className="h-5 w-5 text-primary" />
            AI Recipe Creator
          </DialogTitle>
          <DialogDescription>
            Generate high-quality recipes from your pantry ingredients.
          </DialogDescription>
        </DialogHeader>

        {/* Mode selector + generate button */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode('inspiration')}
              className={`text-left p-4 rounded-lg border-2 transition-all ${
                mode === 'inspiration'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Inspiration</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Use pantry as a base. AI can suggest 1-2 extra ingredients to elevate the dish.
              </p>
            </button>
            <button
              onClick={() => setMode('strict')}
              className={`text-left p-4 rounded-lg border-2 transition-all ${
                mode === 'strict'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <ChefHat className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Strict</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Use ONLY what&apos;s in your pantry. No additional ingredients (except basic staples).
              </p>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={generate} disabled={loading} className="gap-2 flex-1">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating recipes...
                </>
              ) : hasGenerated ? (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Regenerate ({mode === 'strict' ? 'strict' : 'inspiration'} mode)
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate 5 Recipes
                </>
              )}
            </Button>
          </div>

          {loading && (
            <div className="space-y-3">
              <div className="text-center text-sm text-muted-foreground py-8">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                {mode === 'strict'
                  ? 'Finding creative ways to use only your pantry ingredients...'
                  : 'Crafting restaurant-quality recipes from your pantry...'}
                <p className="text-xs mt-2">This takes ~30 seconds.</p>
              </div>
            </div>
          )}

          {/* Recipe results */}
          {!loading && recipes.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {recipes.length} recipes generated. Tap <strong>View</strong> to see the full recipe and cook, or <strong>Add to Box</strong> to save it permanently.
              </p>
              {recipes.map((recipe, idx) => {
                const servings = recipe.metadata?.find((m) => m.key.toLowerCase() === 'servings');
                const totalTime = recipe.metadata?.find((m) => m.key.toLowerCase().includes('totaltime') || m.key.toLowerCase().includes('total time'));
                const difficulty = recipe.metadata?.find((m) => m.key.toLowerCase() === 'difficulty');
                const cuisine = recipe.metadata?.find((m) => m.key.toLowerCase() === 'cuisine');
                const isSaved = !recipe._isTempPantryRecipe;
                const hasSuggestedAdditions = recipe.flags?.some((f) => f.type === 'suggested_addition');

                return (
                  <Card key={idx} className="overflow-hidden">
                    <CardHeader className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                              <ChefHat className="h-4 w-4" />
                            </div>
                            <CardTitle className="text-base leading-tight">{recipe.title}</CardTitle>
                          </div>
                          {recipe.description && (
                            <CardDescription className="text-xs leading-relaxed mt-1">
                              {recipe.description}
                            </CardDescription>
                          )}
                        </div>
                      </div>

                      {/* Metadata badges */}
                      <div className="flex flex-wrap gap-1.5">
                        {cuisine && (
                          <Badge variant="secondary" className="text-xs">{cuisine.value}</Badge>
                        )}
                        {totalTime && (
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Clock className="h-3 w-3" />
                            {totalTime.value}
                          </Badge>
                        )}
                        {servings && (
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Users className="h-3 w-3" />
                            {servings.value}
                          </Badge>
                        )}
                        {difficulty && (
                          <Badge variant="secondary" className="text-xs">{difficulty.value}</Badge>
                        )}
                        {hasSuggestedAdditions && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            + additions
                          </Badge>
                        )}
                      </div>

                      {/* Tags */}
                      {recipe.tags && recipe.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {recipe.tags.slice(0, 4).map((tag) => (
                            <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Ingredient count */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <ChefHat className="h-3.5 w-3.5" />
                          {recipe.ingredients?.length || 0} ingredients
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {recipe.instructions?.length || 0} steps
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-0">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => viewRecipe(recipe)}
                          className="gap-1.5 flex-1"
                        >
                          <ChefHat className="h-3.5 w-3.5" />
                          View & Cook
                        </Button>
                        {isSaved ? (
                          <Badge variant="secondary" className="text-xs gap-1 text-green-600">
                            <Plus className="h-3 w-3" />
                            Saved
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => saveRecipe(recipe)}
                            className="gap-1.5 flex-1"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add to Box
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {!loading && hasGenerated && recipes.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>No recipes were generated. Try again or switch modes.</p>
            </div>
          )}

          {!loading && !hasGenerated && (
            <div className="text-center py-8 text-muted-foreground">
              <Wand2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">
                Click <strong>Generate</strong> to create 5 recipes from your pantry.
              </p>
              <p className="text-xs mt-2">
                {mode === 'strict'
                  ? 'The AI will use only what you have — no shopping required.'
                  : 'The AI will use your pantry as inspiration and may suggest 1-2 additions.'}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
