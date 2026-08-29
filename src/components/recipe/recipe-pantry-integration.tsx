'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, X, ShoppingCart, Package, Loader2 } from 'lucide-react';
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
import { simpleNormalize, isIngredientMatch, type CanonicalIngredient } from '@/lib/canonicalize';
import type { SavedRecipe, RecipeIngredient } from '@/lib/types';

interface PantryItem {
  id: string;
  name: string;
  genericName: string | null;
  canonicalAncestors: string[] | null;
  canonicalAttributes: Record<string, string> | null;
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
  };
}

function buildCanonicalFromRecipe(ing: RecipeIngredient): CanonicalIngredient {
  if (ing.canonicalName) {
    return {
      canonical_name: ing.canonicalName,
      ancestors: ing.canonicalAncestors || [],
      attributes: ing.canonicalAttributes || {},
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
  const hasCanonicalized = useRef(false);

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

  // ---- Lazy canonicalization of recipe ingredients ----
  useEffect(() => {
    if (hasCanonicalized.current) return;
    if (!recipe.ingredients || recipe.ingredients.length === 0) return;

    const needsCanonicalization = recipe.ingredients.some((ing) => !ing.canonicalName);

    if (!needsCanonicalization) {
      setCanonicalizedIngredients(recipe.ingredients);
      hasCanonicalized.current = true;
      return;
    }

    hasCanonicalized.current = true;
    setCanonicalizing(true);

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
            };
          }
          const fallback = simpleNormalize(ing.name);
          return {
            ...ing,
            canonicalName: fallback.canonical_name,
            canonicalAncestors: fallback.ancestors.length > 0 ? fallback.ancestors : null,
            canonicalAttributes: Object.keys(fallback.attributes).length > 0 ? fallback.attributes : null,
          };
        });

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
        const fallback = recipe.ingredients.map((ing) => {
          const c = simpleNormalize(ing.name);
          return {
            ...ing,
            canonicalName: c.canonical_name,
            canonicalAncestors: c.ancestors.length > 0 ? c.ancestors : null,
            canonicalAttributes: Object.keys(c.attributes).length > 0 ? c.attributes : null,
          };
        });
        setCanonicalizedIngredients(fallback);
      } finally {
        setCanonicalizing(false);
      }
    }

    canonicalize();
  }, [recipe, authToken]);

  const PANTRY_STAPLES = ['water'];

  const ingredients = canonicalizedIngredients.length > 0
    ? canonicalizedIngredients
    : recipe.ingredients || [];

  const ingredientStatus = ingredients.map((ing, idx) => {
    const ingNameLower = ing.name.toLowerCase().trim();
    const isStaple = PANTRY_STAPLES.some(
      (s) => ingNameLower === s || ingNameLower.startsWith(s + ' '),
    );

    if (isStaple) {
      return { idx, ingredient: ing, inPantry: true, pantryItem: null, isStaple: true };
    }

    const recipeCanonical = buildCanonicalFromRecipe(ing);

    const match = pantryItems.find((p) => {
      const pantryCanonical = buildCanonicalFromPantry(p as PantryItem);
      return isIngredientMatch(recipeCanonical, pantryCanonical);
    });

    return {
      idx,
      ingredient: ing,
      inPantry: !!match,
      pantryItem: match,
      isStaple: false,
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
          {ingredientStatus.map(({ idx, ingredient, inPantry, pantryItem }) => (
            <div key={idx} className="flex items-center gap-2 text-sm py-1">
              {inPantry ? (
                <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
              ) : (
                <X className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              )}
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
