'use client';

import { useState, useEffect } from 'react';
import { Check, X, ShoppingCart, Package, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { simpleNormalize, matchIngredient, type CanonicalIngredient } from '@/lib/canonicalize';
import type { SavedRecipe, RecipeIngredient } from '@/lib/types';

interface PantryItem {
  id: string;
  name: string;
  genericName: string | null;
  canonicalAncestors: string[] | null;
  canonicalAttributes: Record<string, string | string[]> | null;
  canonicalHardAttributeKeys: string[] | null;
  category: string | null;
  isRunningLow: boolean;
}

interface ShoppingList {
  id: string;
  name: string;
}

interface RecipePantryIntegrationProps {
  recipe: SavedRecipe;
}

// =============================================================================
// MATCHING — directional, using ancestor tree + attributes
// =============================================================================
//
// The pantry item walks UP its concept path (canonical_name + ancestors).
// If the recipe's canonical_name is found in that path, it's a concept match.
// Then we check that all recipe attributes are satisfied by pantry attributes.
//
// Directionality:
//   Recipe: "noodles"  →  Pantry: "udon" (ancestors: [wheat noodles, noodles])
//   → "noodles" is in pantry's path → MATCH (specific satisfies generic)
//
//   Recipe: "udon"  →  Pantry: "noodles" (ancestors: [])
//   → "udon" is NOT in pantry's path → NO MATCH (generic can't satisfy specific)

function buildCanonicalFromPantry(item: PantryItem): CanonicalIngredient {
  return {
    canonical_name: item.genericName || simpleNormalize(item.name).canonical_name,
    ancestors: item.canonicalAncestors || [],
    attributes: item.canonicalAttributes || {},
    hardAttributeKeys: item.canonicalHardAttributeKeys || [],
  };
}

function buildCanonicalFromRecipe(ing: RecipeIngredient): CanonicalIngredient {
  if (ing.canonicalName) {
    return {
      canonical_name: ing.canonicalName,
      ancestors: ing.canonicalAncestors || [],
      attributes: ing.canonicalAttributes || {},
      hardAttributeKeys: ing.canonicalHardAttributeKeys || [],
    };
  }
  return simpleNormalize(ing.name);
}

// =============================================================================
// COMPONENT
// =============================================================================

export function RecipePantryIntegration({ recipe }: RecipePantryIntegrationProps) {
  const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [canonicalizing, setCanonicalizing] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [canonicalizedIngredients, setCanonicalizedIngredients] = useState<RecipeIngredient[]>([]);
  const { authToken, pantryItems, fetchPantry } = useStore();

  useEffect(() => {
    async function loadData() {
      try {
        if (pantryItems.length === 0) {
          await fetchPantry();
        }

        const listsRes = await fetch('/api/shopping-lists', {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        const listsData = await listsRes.json();
        setShoppingLists(listsData.lists || []);
        if (listsData.lists?.length > 0) {
          setSelectedListId(listsData.lists[0].id);
        }
      } catch {
        // Silent fail — pantry integration is optional.
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [authToken, pantryItems.length, fetchPantry]);

  // ---- Lazy canonicalization of recipe ingredients (backward compat) ----
  // If recipe ingredients don't have canonicalName yet, canonicalize them
  // once and save to DB. The matching itself runs on EVERY render using
  // the offline isIngredientMatch() function.
  useEffect(() => {
    if (!recipe.ingredients || recipe.ingredients.length === 0) return;

    const needsCanonicalization = recipe.ingredients.some((ing) => !ing.canonicalName);

    if (!needsCanonicalization) {
      setCanonicalizedIngredients(recipe.ingredients);
      return;
    }

    setCanonicalizing(true);

    let cancelled = false;

    async function canonicalize() {
      try {
        const names = recipe.ingredients.map((ing) => ing.name);
        const res = await fetch('/api/canonicalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names }),
        });

        if (!res.ok) throw new Error('Canonicalization failed');

        const data = await res.json();
        const canonicalMap: Record<string, CanonicalIngredient> = data.canonical || {};

        const updated = recipe.ingredients.map((ing) => {
          const c = canonicalMap[ing.name];
          if (c) {
            return {
              ...ing,
              canonicalName: c.canonical_name,
              canonicalAncestors: c.ancestors.length > 0 ? c.ancestors : null,
              canonicalAttributes: Object.keys(c.attributes).length > 0 ? c.attributes : null,
              canonicalHardAttributeKeys: c.hardAttributeKeys.length > 0 ? c.hardAttributeKeys : null,
            };
          }
          const fallback = simpleNormalize(ing.name);
          return {
            ...ing,
            canonicalName: fallback.canonical_name,
            canonicalAncestors: fallback.ancestors.length > 0 ? fallback.ancestors : null,
            canonicalAttributes: Object.keys(fallback.attributes).length > 0 ? fallback.attributes : null,
            canonicalHardAttributeKeys: fallback.hardAttributeKeys.length > 0 ? fallback.hardAttributeKeys : null,
          };
        });

        if (cancelled) return;
        setCanonicalizedIngredients(updated);

        // Save to DB so we don't canonicalize again.
        if (authToken && !recipe.id.startsWith('temp-')) {
          fetch(`/api/recipes/${recipe.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({ ingredients: updated }),
          }).catch(() => {});
        }
      } catch {
        if (cancelled) return;
        const fallback = recipe.ingredients.map((ing) => {
          const c = simpleNormalize(ing.name);
          return {
            ...ing,
            canonicalName: c.canonical_name,
            canonicalAncestors: c.ancestors.length > 0 ? c.ancestors : null,
            canonicalAttributes: Object.keys(c.attributes).length > 0 ? c.attributes : null,
            canonicalHardAttributeKeys: c.hardAttributeKeys.length > 0 ? c.hardAttributeKeys : null,
          };
        });
        setCanonicalizedIngredients(fallback);
      } finally {
        if (!cancelled) setCanonicalizing(false);
      }
    }

    canonicalize();

    return () => { cancelled = true; };
  }, [recipe, authToken]);

  const PANTRY_STAPLES = ['water'];

  const ingredients = canonicalizedIngredients.length > 0
    ? canonicalizedIngredients
    : recipe.ingredients || [];

  const ingredientStatus = ingredients.map((ing, idx) => {
    // Use the CANONICAL name for staple exclusion, not the display name.
    // This ensures "water" in any language still gets excluded if its
    // canonical_name is "water".
    // But DON'T exclude if the ingredient has attributes that make it different
    // (e.g. "sparkling water" has attribute {carbonation: "sparkling"} — that's
    // a different product from plain water).
    const canonicalForStaple = ing.canonicalName || ing.name.toLowerCase().trim();
    const hasAttributes = ing.canonicalAttributes && Object.keys(ing.canonicalAttributes).length > 0;
    const isStaple = !hasAttributes && PANTRY_STAPLES.some(
      (s) => canonicalForStaple === s || canonicalForStaple.startsWith(s + ' '),
    );

    if (isStaple) {
      return { idx, ingredient: ing, inPantry: true, pantryItem: null, isStaple: true, warnings: [] };
    }

    const recipeCanonical = buildCanonicalFromRecipe(ing);

    // Find the best match — prefer matches with no warnings over matches with warnings.
    let bestMatch: PantryItem | null = null;
    let bestWarnings: string[] = [];

    for (const p of pantryItems) {
      const pantryCanonical = buildCanonicalFromPantry(p as PantryItem);
      const result = matchIngredient(recipeCanonical, pantryCanonical);
      if (result.matched) {
        if (bestMatch === null || result.warnings.length < bestWarnings.length) {
          bestMatch = p as PantryItem;
          bestWarnings = result.warnings;
          if (result.warnings.length === 0) break; // Perfect match, no need to keep looking.
        }
      }
    }

    return {
      idx,
      ingredient: ing,
      inPantry: !!bestMatch,
      pantryItem: bestMatch,
      isStaple: false,
      warnings: bestWarnings,
    };
  });

  const haveCount = ingredientStatus.filter((s) => s.inPantry).length;
  const missingIngredients = ingredientStatus
    .filter((s) => !s.inPantry && !s.isStaple)
    .map((s) => s.ingredient);
  const missingCount = missingIngredients.length;

  async function addMissingToShoppingList() {
    if (!selectedListId || missingIngredients.length === 0) return;
    setAdding(true);

    try {
      const items = missingIngredients.map((ing) => ({
        name: ing.name,
        genericName: ing.canonicalName || simpleNormalize(ing.name).canonical_name,
        quantity: ing.amount ? `${ing.amount}${ing.unit ? ' ' + ing.unit : ''}` : undefined,
        recipeId: recipe.id,
      }));

      const res = await fetch(`/api/shopping-lists/${selectedListId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(items),
      });

      if (!res.ok) throw new Error('Failed to add items.');
      toast.success(
        `${missingIngredients.length} item${missingIngredients.length > 1 ? 's' : ''} added to shopping list.`,
      );
    } catch {
      toast.error('Could not add items to shopping list.');
    } finally {
      setAdding(false);
    }
  }

  if (loading || canonicalizing) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {canonicalizing ? 'Canonicalizing ingredients...' : 'Checking pantry...'}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (pantryItems.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Pantry Check</span>
          </div>
          <div className="flex items-center gap-2">
            {haveCount > 0 && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Check className="h-3 w-3 text-green-500" />
                {haveCount} have
              </Badge>
            )}
            {missingCount > 0 && (
              <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-300">
                <X className="h-3 w-3" />
                {missingCount} missing
              </Badge>
            )}
            {missingCount === 0 && haveCount > 0 && (
              <Badge variant="secondary" className="text-xs gap-1 text-green-600">
                <Check className="h-3 w-3" />
                All ingredients!
              </Badge>
            )}
          </div>
        </div>

        <div className="space-y-1">
          {ingredientStatus.map(({ idx, ingredient, inPantry, pantryItem, warnings }) => (
            <div key={idx} className="flex items-start gap-2 text-sm py-1">
              {inPantry ? (
                <Check className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${warnings.length > 0 ? 'text-amber-500' : 'text-green-500'}`} />
              ) : (
                <X className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={inPantry ? 'text-muted-foreground line-through' : ''}>
                    {ingredient.name}
                  </span>
                  {(ingredient.amount || ingredient.unit) && (
                    <span className="text-xs text-muted-foreground">
                      {ingredient.amount}
                      {ingredient.unit && ` ${ingredient.unit}`}
                    </span>
                  )}
                  {inPantry && pantryItem?.isRunningLow && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                      Low
                    </Badge>
                  )}
                  {inPantry && warnings.length > 0 && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-1">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {warnings.length} diff{warnings.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                {inPantry && warnings.length > 0 && (
                  <p className="text-xs text-amber-600 mt-0.5 pl-0">
                    {warnings.join('; ')}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {missingCount > 0 && shoppingLists.length > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t border-border/40">
            <Select value={selectedListId} onValueChange={setSelectedListId}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Select list..." />
              </SelectTrigger>
              <SelectContent>
                {shoppingLists.map((list) => (
                  <SelectItem key={list.id} value={list.id} className="text-xs">
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={addMissingToShoppingList}
              disabled={adding || !selectedListId}
              className="h-8 gap-1.5 text-xs"
            >
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShoppingCart className="h-3.5 w-3.5" />
              )}
              Add {missingCount} missing
            </Button>
          </div>
        )}

        {missingCount > 0 && shoppingLists.length === 0 && (
          <p className="text-xs text-muted-foreground pt-2 border-t border-border/40">
            Create a shopping list first to add missing ingredients.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
