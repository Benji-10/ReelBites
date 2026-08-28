'use client';

import { useState, useEffect } from 'react';
import { Check, X, ShoppingCart, Package, Loader2, Plus } from 'lucide-react';
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
import type { SavedRecipe, RecipeIngredient } from '@/lib/types';

interface PantryItem {
  id: string;
  name: string;
  genericName: string | null;
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

export function RecipePantryIntegration({ recipe }: RecipePantryIntegrationProps) {
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);
  const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const { authToken } = useStore();

  useEffect(() => {
    async function loadData() {
      try {
        const [pantryRes, listsRes] = await Promise.all([
          fetch('/api/pantry', { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }),
          fetch('/api/shopping-lists', { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }),
        ]);

        const pantryData = await pantryRes.json();
        const listsData = await listsRes.json();

        setPantryItems(pantryData.items || []);
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
  }, [authToken]);

  // Common ingredients that everyone has — don't show as "missing".
  const PANTRY_STAPLES = [
    'water', 'salt', 'pepper', 'black pepper', 'white pepper',
    'oil', 'olive oil', 'vegetable oil', 'sunflower oil',
    'sugar', 'flour',
  ];

  // Normalize a name for matching: lowercase, remove plurals, remove extra words.
  function normalizeName(name: string): string {
    let n = name.toLowerCase().trim();
    // Remove common qualifiers.
    n = n.replace(/\b(fresh|dried|ground|whole|chopped|sliced|diced|minced|grated|peeled|raw|cooked|lean|extra|fine|coarse)\b/g, '');
    // Remove percentages like "95%".
    n = n.replace(/\d+%/g, '');
    // Remove parenthetical notes.
    n = n.replace(/\([^)]*\)/g, '');
    // Normalize whitespace.
    n = n.replace(/\s+/g, ' ').trim();
    // Simple plural → singular (handles most food words).
    if (n.endsWith('ies')) n = n.slice(0, -3) + 'y';
    else if (n.endsWith('ses')) n = n.slice(0, -2);
    else if (n.endsWith('s') && !n.endsWith('ss')) n = n.slice(0, -1);
    return n.trim();
  }

  // Check if two ingredient names are a real match (not a false positive).
  function isIngredientMatch(recipeName: string, pantryName: string, pantryGeneric: string): boolean {
    const rNorm = normalizeName(recipeName);
    const pNorm = normalizeName(pantryName);
    const gNorm = normalizeName(pantryGeneric || '');

    // Exact match (after normalization).
    if (rNorm === pNorm || rNorm === gNorm) return true;

    // Word-level matching: split into words and check if the core word matches.
    // "crushed red pepper" → core word "pepper"
    // "black pepper" → core word "pepper" → match
    // "pepper" → "pepper" → match
    // But "red pepper" vs "black pepper" should still match since both are "pepper"
    // However "pepper" vs "bell pepper" should NOT match (different ingredient).
    // We use the LAST word as the "type" word for matching.
    const rWords = rNorm.split(' ').filter((w) => w.length > 2);
    const pWords = pNorm.split(' ').filter((w) => w.length > 2);
    const gWords = gNorm.split(' ').filter((w) => w.length > 2);

    // If one is a single word and the other is multi-word, check if the
    // single word equals the last word of the multi-word name.
    if (rWords.length === 1 && pWords.length > 1) {
      return rWords[0] === pWords[pWords.length - 1];
    }
    if (pWords.length === 1 && rWords.length > 1) {
      return pWords[0] === rWords[rWords.length - 1];
    }
    if (rWords.length === 1 && gWords.length > 1) {
      return rWords[0] === gWords[gWords.length - 1];
    }
    if (gWords.length === 1 && rWords.length > 1) {
      return gWords[0] === rWords[rWords.length - 1];
    }

    // For multi-word names, check if one fully contains the other's core words.
    if (rWords.length > 1 && pWords.length > 1) {
      const rCore = rWords[rWords.length - 1];
      const pCore = pWords[pWords.length - 1];
      // Only match if the "type" word matches AND at least one other word matches.
      if (rCore === pCore) {
        const rSet = new Set(rWords);
        const pSet = new Set(pWords);
        const overlap = [...rSet].filter((w) => pSet.has(w));
        return overlap.length >= 1;
      }
    }

    return false;
  }

  // Match recipe ingredients against pantry items using improved matching.
  const ingredientStatus = (recipe.ingredients || []).map((ing, idx) => {
    const ingNameLower = ing.name.toLowerCase().trim();
    const isStaple = PANTRY_STAPLES.some((s) => ingNameLower === s || ingNameLower.startsWith(s + ' '));

    // If it's a staple, always show as "have".
    if (isStaple) {
      return { idx, ingredient: ing, inPantry: true, pantryItem: null, isStaple: true };
    }

    // Check if any pantry item matches.
    const match = pantryItems.find((p) => {
      return isIngredientMatch(ing.name, p.name, p.genericName || '');
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
        genericName: ing.name.toLowerCase(),
        quantity: ing.amount ? `${ing.amount}${ing.unit ? ' ' + ing.unit : ''}` : undefined,
        recipeId: recipe.id,
      }));

      const res = await fetch(`/api/shopping-lists/${selectedListId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify(items),
      });

      if (!res.ok) throw new Error('Failed to add items.');
      toast.success(`${missingIngredients.length} item${missingIngredients.length > 1 ? 's' : ''} added to shopping list.`);
    } catch {
      toast.error('Could not add items to shopping list.');
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking pantry...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (pantryItems.length === 0) {
    return null; // Don't show integration if pantry is empty.
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        {/* Summary */}
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

        {/* Ingredient list with status */}
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
                  {ingredient.amount}{ingredient.unit && ` ${ingredient.unit}`}
                </span>
              )}
              {inPantry && pantryItem?.isRunningLow && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Low</Badge>
              )}
            </div>
          ))}
        </div>

        {/* Add missing to shopping list */}
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
