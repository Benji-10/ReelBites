'use client';

import { useState } from 'react';
import { Sparkles, Loader2, RefreshCw, Wand2, Plus, ChefHat, Clock, Users, X, ListOrdered, Maximize2, ArrowLeft } from 'lucide-react';
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
import { useSettings } from '@/lib/settings';
import type { SavedRecipe } from '@/lib/types';
import { RecipePantryIntegration } from './recipe-pantry-integration';

interface PantryRecipeGeneratorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = 'inspiration' | 'strict';

interface TempRecipe extends SavedRecipe {
  _isTempPantryRecipe?: boolean;
  _savedToBox?: boolean;
}

export function PantryRecipeGenerator({ open, onOpenChange }: PantryRecipeGeneratorProps) {
  const [mode, setMode] = useState<Mode>('inspiration');
  const [loading, setLoading] = useState(false);
  const [recipes, setRecipes] = useState<TempRecipe[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [viewingRecipe, setViewingRecipe] = useState<TempRecipe | null>(null);
  const { authToken, addRecipe } = useStore();
  const { defaultServings, defaultLanguage } = useSettings();

  async function generate() {
    setLoading(true);
    setRecipes([]);
    setViewingRecipe(null);

    try {
      const response = await fetch('/api/pantry-recipes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ mode, servings: defaultServings, language: defaultLanguage }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to generate recipes.' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setRecipes(data.recipes || []);
      setHasGenerated(true);
      toast.success(`Generated ${data.recipes?.length || 0} recipes!`);
    } catch (err) {
      toast.error('Could not generate recipes: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function viewRecipe(recipe: TempRecipe) {
    setViewingRecipe(recipe);
  }

  function backToList() {
    setViewingRecipe(null);
  }

  async function saveRecipe(recipe: TempRecipe) {
    try {
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
      addRecipe({ ...recipe, id: data.recipe.id, _isTempPantryRecipe: false } as SavedRecipe);

      // Mark as saved in local state.
      setRecipes((prev) =>
        prev.map((r) => (r.id === recipe.id ? { ...r, _savedToBox: true, id: data.recipe.id } : r)),
      );

      // Update the viewing recipe if it's the same.
      if (viewingRecipe?.id === recipe.id) {
        setViewingRecipe({ ...recipe, _savedToBox: true, id: data.recipe.id });
      }

      toast.success(`"${recipe.title}" added to your recipe box!`);
    } catch (err) {
      toast.error('Could not save recipe: ' + (err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setViewingRecipe(null); } }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Wand2 className="h-5 w-5 text-primary" />
            AI Recipe Creator
          </DialogTitle>
          <DialogDescription>
            Generate high-quality recipes from your pantry ingredients. View them, cook from them, and save the ones you love.
          </DialogDescription>
        </DialogHeader>

        {/* ===== RECIPE DETAIL VIEW ===== */}
        {viewingRecipe ? (
          <div className="space-y-4">
            {/* Top bar */}
            <div className="flex items-center justify-between gap-2 pb-3 border-b">
              <Button variant="ghost" size="sm" onClick={backToList} className="gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                Back to recipes
              </Button>
              <div className="flex items-center gap-2">
                {viewingRecipe._savedToBox ? (
                  <Badge variant="secondary" className="text-xs gap-1 text-green-600">
                    <Plus className="h-3 w-3" />
                    Saved to box
                  </Badge>
                ) : (
                  <Button size="sm" onClick={() => saveRecipe(viewingRecipe)} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" />
                    Add to Box
                  </Button>
                )}
              </div>
            </div>

            <RecipeDetailView
              recipe={viewingRecipe}
            />
          </div>
        ) : (
          /* ===== GENERATOR + RECIPE LIST ===== */
          <div className="space-y-4">
            {/* Mode selector + generate button */}
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
                  Use pantry as a base. AI can suggest 1-2 extra ingredients.
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
                  Use ONLY what&apos;s in your pantry. No additional ingredients.
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
              <div className="text-center text-sm text-muted-foreground py-8">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                {mode === 'strict'
                  ? 'Finding creative ways to use only your pantry ingredients...'
                  : 'Crafting restaurant-quality recipes from your pantry...'}
                <p className="text-xs mt-2">This takes ~30 seconds.</p>
              </div>
            )}

            {/* Recipe results list */}
            {!loading && recipes.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {recipes.length} recipes generated. Click a recipe to view the full details.
                </p>
                {recipes.map((recipe, idx) => {
                  const servings = recipe.metadata?.find((m) => m.key.toLowerCase() === 'servings');
                  const totalTime = recipe.metadata?.find((m) => m.key.toLowerCase().includes('totaltime') || m.key.toLowerCase().includes('total time'));
                  const difficulty = recipe.metadata?.find((m) => m.key.toLowerCase() === 'difficulty');
                  const cuisine = recipe.metadata?.find((m) => m.key.toLowerCase() === 'cuisine');
                  const hasSuggestedAdditions = recipe.flags?.some((f) => f.type === 'suggested_addition');

                  return (
                    <Card
                      key={idx}
                      className="overflow-hidden cursor-pointer hover:shadow-md transition-all hover:-translate-y-0.5"
                      onClick={() => viewRecipe(recipe)}
                    >
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
                          {recipe._savedToBox && (
                            <Badge variant="secondary" className="text-xs gap-1 text-green-600 shrink-0">
                              <Plus className="h-3 w-3" />
                              Saved
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {cuisine && <Badge variant="secondary" className="text-xs">{cuisine.value}</Badge>}
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
                          {difficulty && <Badge variant="secondary" className="text-xs">{difficulty.value}</Badge>}
                          {hasSuggestedAdditions && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                              + additions
                            </Badge>
                          )}
                        </div>

                        {recipe.tags && recipe.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {recipe.tags.slice(0, 4).map((tag) => (
                              <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

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
        )}
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// RecipeDetailView — shown inside the large dialog when a recipe is clicked
// =============================================================================

function RecipeDetailView({ recipe }: { recipe: TempRecipe }) {
  const [scaleFactor, setScaleFactor] = useState(1);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());
  const [cookingMode, setCookingMode] = useState(false);

  const servingsMeta = recipe.metadata?.find((m) => m.key.toLowerCase() === 'servings');
  const originalServings = servingsMeta ? parseInt(servingsMeta.value, 10) || 4 : 4;
  const currentServings = Math.round(originalServings * scaleFactor);

  function scaleAmount(amount: string | null | undefined): string {
    if (!amount) return '';
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    const scaled = num * scaleFactor;
    return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(2).replace(/\.?0+$/, '');
  }

  function toggleIngredient(index: number) {
    const next = new Set(checkedIngredients);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setCheckedIngredients(next);
  }

  return (
    <div className="space-y-4">
      {/* Title + description */}
      <div className="space-y-3">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{recipe.title}</h1>
        {recipe.description && <p className="text-muted-foreground leading-relaxed">{recipe.description}</p>}
        {recipe.tags && recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {recipe.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
          </div>
        )}
      </div>

      {/* Metadata */}
      {recipe.metadata && recipe.metadata.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {recipe.metadata.filter(m => !['servings'].includes(m.key.toLowerCase())).map((m, i) => (
            <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30">
              <Clock className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground capitalize">{m.key.replace(/([A-Z])/g, ' $1').trim()}</p>
                <p className="text-sm font-medium truncate">{m.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Servings scaler */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Servings</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setScaleFactor((f) => Math.max(0.5, f - 0.5))} disabled={scaleFactor <= 0.5}>
                −
              </Button>
              <span className="font-semibold tabular-nums w-12 text-center">{currentServings}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setScaleFactor((f) => f + 0.5)}>
                +
              </Button>
              {scaleFactor !== 1 && (
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setScaleFactor(1)}>Reset</Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ingredients */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ChefHat className="h-5 w-5 text-primary" />
            Ingredients
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {recipe.ingredients?.map((ing, i) => {
              const isChecked = checkedIngredients.has(i);
              return (
                <label key={i} className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleIngredient(i)}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span className={`flex-1 text-sm ${isChecked ? 'line-through text-muted-foreground' : ''}`}>
                    <span className="font-medium">{ing.name}</span>
                    {ing.amount && (
                      <span className="text-muted-foreground ml-2">
                        {scaleAmount(ing.amount)}{ing.unit && ` ${ing.unit}`}
                      </span>
                    )}
                  </span>
                  {ing.flag === 'suggested_addition' && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 shrink-0">
                      Suggested
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Pantry integration — shows what you have and what's missing */}
      <RecipePantryIntegration recipe={recipe as SavedRecipe} />

      {/* Instructions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListOrdered className="h-5 w-5 text-primary" />
              Instructions
            </CardTitle>
            {recipe.instructions && recipe.instructions.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setCookingMode(true)} className="gap-1.5">
                <Maximize2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cooking Mode</span>
                <span className="sm:hidden">Cook</span>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ol className="space-y-5">
            {recipe.instructions?.map((inst, i) => (
              <li key={i} className="flex gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <p className="text-sm leading-relaxed">{inst.step}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Flags / Notes */}
      {recipe.flags && recipe.flags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recipe.flags.map((flag, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-amber-500 mt-0.5">•</span>
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground capitalize">
                      {flag.type.replace(/_/g, ' ')}:
                    </span>{' '}
                    {flag.message}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Cooking mode overlay */}
      {cookingMode && recipe.instructions && (
        <CookingModeInline
          instructions={recipe.instructions}
          title={recipe.title}
          onClose={() => setCookingMode(false)}
        />
      )}
    </div>
  );
}

// =============================================================================
// CookingModeInline — simplified cooking mode
// =============================================================================

interface CookingModeInlineProps {
  instructions: { step: string; ingredientRefs?: number[] }[];
  title: string;
  onClose: () => void;
}

function CookingModeInline({ instructions, title, onClose }: CookingModeInlineProps) {
  const [currentStep, setCurrentStep] = useState(0);

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="font-semibold text-lg">{title}</h2>
          <p className="text-xs text-muted-foreground">Step {currentStep + 1} of {instructions.length}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
          <X className="h-4 w-4" />
          Exit
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-2xl w-full space-y-6">
          <div className="text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold mb-4">
              {currentStep + 1}
            </div>
            <p className="text-lg leading-relaxed">{instructions[currentStep].step}</p>
          </div>

          <div className="flex items-center justify-between gap-4 pt-4">
            <Button
              variant="outline"
              onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
              disabled={currentStep === 0}
              className="gap-1.5"
            >
              ← Previous
            </Button>
            <div className="flex gap-1">
              {instructions.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentStep(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === currentStep ? 'w-8 bg-primary' : 'w-2 bg-muted-foreground/30'
                  }`}
                />
              ))}
            </div>
            <Button
              onClick={() => {
                if (currentStep < instructions.length - 1) {
                  setCurrentStep((s) => s + 1);
                } else {
                  onClose();
                }
              }}
              className="gap-1.5"
            >
              {currentStep === instructions.length - 1 ? 'Done ✓' : 'Next →'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
