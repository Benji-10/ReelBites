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

// =============================================================================
// INGREDIENT MATCHING ENGINE
// =============================================================================
//
// The matching uses three layers:
//   1. Canonicalization — normalize names (lowercase, strip qualifiers, singularize, apply synonym map)
//   2. Synonym map — map regional/variant names to a canonical form
//      (e.g. "capsicum" → "bell pepper", "chilli flakes" → "red pepper flakes")
//   3. Prefix matching — if one canonical name is a prefix of the other, they match
//      (e.g. "chicken breast" matches "chicken breast tenders", but "olive oil" does NOT match "vegetable oil")
//
// This is deliberately conservative: it's better to miss a match (user adds to
// shopping list unnecessarily) than to false-positive (user thinks they have
// an ingredient they don't).

// Regional / variant names → canonical form.
// All keys and values are lowercase, singular.
const SYNONYMS: Record<string, string> = {
  // --- Peppers ---
  'capsicum': 'bell pepper',
  'sweet pepper': 'bell pepper',
  'sweet capsicum': 'bell pepper',
  'red capsicum': 'red bell pepper',
  'green capsicum': 'green bell pepper',
  'yellow capsicum': 'yellow bell pepper',
  'crushed red pepper': 'red pepper flakes',
  'crushed red pepper flakes': 'red pepper flakes',
  'chilli flake': 'red pepper flakes',
  'chilli flakes': 'red pepper flakes',
  'chili flake': 'red pepper flakes',
  'chili flakes': 'red pepper flakes',
  'red chili flake': 'red pepper flakes',
  'red chili flakes': 'red pepper flakes',
  'red pepper flake': 'red pepper flakes',
  'crushed chili flake': 'red pepper flakes',
  'crushed chili flakes': 'red pepper flakes',
  'chilli powder': 'chili powder',
  'chile powder': 'chili powder',
  'chili powder': 'chili powder',

  // --- Herbs ---
  'coriander leaf': 'cilantro',
  'coriander leaves': 'cilantro',
  'fresh coriander': 'cilantro',
  'cilantro leaf': 'cilantro',
  'italian herb': 'italian seasoning',
  'italian herbs': 'italian seasoning',
  'mixed herbs': 'italian seasoning',
  'herbes de provence': 'italian seasoning',

  // --- Vegetables ---
  'aubergine': 'eggplant',
  'courgette': 'zucchini',
  'spring onion': 'scallion',
  'green onion': 'scallion',
  'spring onions': 'scallion',
  'green onions': 'scallion',
  'rocket': 'arugula',
  'ruccola': 'arugula',
  'beetroot': 'beet',
  'swede': 'rutabaga',
  'sweet potato': 'sweet potato',
  'yam': 'sweet potato',

  // --- Meat ---
  'minced beef': 'ground beef',
  'mince': 'ground beef',
  'beef mince': 'ground beef',
  'minced pork': 'ground pork',
  'pork mince': 'ground pork',
  'minced chicken': 'ground chicken',
  'chicken mince': 'ground chicken',
  'minced lamb': 'ground lamb',
  'lamb mince': 'ground lamb',

  // --- Seafood ---
  'prawn': 'shrimp',
  'prawns': 'shrimp',

  // --- Dairy ---
  'heavy cream': 'double cream',
  'whipping cream': 'double cream',
  'light cream': 'single cream',
  'half and half': 'single cream',

  // --- Spices ---
  'coriander seed': 'coriander',
  'coriander seeds': 'coriander',
  'cumin seed': 'cumin',
  'cumin seeds': 'cumin',
  'fennel seed': 'fennel',
  'fennel seeds': 'fennel',
  'mustard seed': 'mustard',
  'mustard seeds': 'mustard',

  // --- Other ---
  'powdered sugar': 'icing sugar',
  'confectioners sugar': 'icing sugar',
  'caster sugar': 'castor sugar',
  'superfine sugar': 'castor sugar',
  'brown sugar': 'brown sugar',
  'raw sugar': 'turbinado sugar',
  'demerara sugar': 'turbinado sugar',

  // --- Oils (DON'T match different oils together) ---
  // No synonyms here — olive oil ≠ vegetable oil ≠ sunflower oil.

  // --- Flours ---
  'plain flour': 'all purpose flour',
  'plain wheat flour': 'all purpose flour',
  'self raising flour': 'self raising flour',
  'self-rising flour': 'self raising flour',
};

// Qualifiers that describe state/quality, NOT the ingredient identity.
// These get stripped during canonicalization.
// IMPORTANT: do NOT include cut/form words (breast, thigh, powder, etc.) —
// those are part of the ingredient identity.
const QUALIFIERS = /\b(fresh|frozen|organic|natural|raw|cooked|fine|coarse|premium|grade\s+[a-z])\b/g;

/**
 * Canonicalize an ingredient name for matching.
 * - Lowercase
 * - Strip parenthetical notes and percentages
 * - Strip quality qualifiers (fresh, organic, etc.)
 * - Singularize
 * - Apply synonym map
 */
function canonicalize(name: string): string {
  if (!name) return '';
  let n = name.toLowerCase().trim();

  // Remove parenthetical notes: "garlic (minced)" → "garlic"
  n = n.replace(/\([^)]*\)/g, ' ');
  // Remove percentages: "95%" → ""
  n = n.replace(/\d+%/g, ' ');
  // Remove quality qualifiers
  n = n.replace(QUALIFIERS, ' ');
  // Remove dash-separated cruft: "Chicken Breast Tenders - Fresh Natural" → "chicken breast tenders natural"
  // (dashes become spaces, then qualifiers get stripped above)
  n = n.replace(/[-_]/g, ' ');
  // Normalize whitespace
  n = n.replace(/\s+/g, ' ').trim();

  // Singularize (simple rules — handles most food words)
  if (n.endsWith('ies')) n = n.slice(0, -3) + 'y';
  else if (n.endsWith('ses')) n = n.slice(0, -2);
  else if (n.endsWith('s') && !n.endsWith('ss') && !n.endsWith('us') && !n.endsWith('is')) {
    n = n.slice(0, -1);
  }
  n = n.trim();

  // Apply synonym map — check multi-word phrases first (longest match).
  // Sort keys by length descending so "crushed red pepper" matches before "red pepper".
  const sortedKeys = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const regex = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(n)) {
      n = n.replace(regex, SYNONYMS[key]);
      n = n.replace(/\s+/g, ' ').trim();
      break; // Only apply the first (longest) match
    }
  }

  return n.trim();
}

/**
 * Expand "X or Y" into variants. Handles the common pattern where the second
 * part inherits the first word: "garlic granules or powder" → ["garlic granules", "garlic powder"].
 */
function expandVariants(name: string): string[] {
  if (!name.includes(' or ')) return [name];
  const parts = name.split(/\s+or\s+/);
  const variants: string[] = [parts[0].trim()];
  const firstWords = parts[0].split(' ').filter((w) => w.length > 0);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    const partWords = part.split(' ');
    // If the part doesn't start with the first word of part[0], prepend it.
    // "garlic granules or powder" → "powder" becomes "garlic powder"
    if (firstWords.length > 0 && partWords[0] !== firstWords[0]) {
      variants.push(firstWords[0] + ' ' + part);
    } else {
      variants.push(part);
    }
  }
  return variants;
}

/**
 * Check if a recipe ingredient matches a pantry item.
 * Conservative: prefers false negatives (missing) over false positives (wrong match).
 */
function isIngredientMatch(
  recipeName: string,
  pantryName: string,
  pantryGeneric: string,
): boolean {
  const canonicalRecipe = canonicalize(recipeName);
  const canonicalPantry = canonicalize(pantryName);
  const canonicalGeneric = canonicalize(pantryGeneric || '');

  if (!canonicalRecipe) return false;

  // Try each variant of the recipe name (handles "X or Y")
  const variants = expandVariants(canonicalRecipe);

  for (const variant of variants) {
    if (!variant) continue;

    // 1. Exact match
    if (variant === canonicalPantry) return true;
    if (canonicalGeneric && variant === canonicalGeneric) return true;

    // 2. Prefix match — one is a prefix of the other.
    //    "chicken breast" matches "chicken breast tenders" ✓
    //    "olive oil" does NOT match "vegetable oil" ✗
    //    "garlic" matches "garlic powder" ✓ (recipe is generic, pantry is specific form)
    if (canonicalPantry.startsWith(variant + ' ') || variant.startsWith(canonicalPantry + ' ')) {
      return true;
    }
    if (canonicalGeneric && (canonicalGeneric.startsWith(variant + ' ') || variant.startsWith(canonicalGeneric + ' '))) {
      return true;
    }

    // 3. Word-level containment (for "or" patterns like "garlic granules or powder").
    //    If ALL words of the pantry name appear in the recipe name in order, match.
    //    Only applies when pantry has 2+ words (avoids "oil" matching "olive oil").
    const pWords = canonicalPantry.split(' ').filter((w) => w.length > 0);
    if (pWords.length >= 2) {
      const vWords = variant.split(' ').filter((w) => w.length > 0);
      let pi = 0;
      for (let vi = 0; vi < vWords.length && pi < pWords.length; vi++) {
        if (vWords[vi] === pWords[pi]) pi++;
      }
      if (pi === pWords.length) return true;
    }
  }

  return false;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function RecipePantryIntegration({ recipe }: RecipePantryIntegrationProps) {
  const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const { authToken, pantryItems, fetchPantry } = useStore();

  useEffect(() => {
    async function loadData() {
      try {
        // Pantry items come from the store (cached for route switching).
        // If the store is empty, fetch them.
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

  // Ingredients that are truly free — you don't have to buy them.
  // Water is the only item that fits this: it comes out of the tap.
  // Salt, pepper, oil, sugar, flour etc. are all things you have to buy,
  // so they should NOT be assumed to be in the pantry.
  const PANTRY_STAPLES = ['water'];

  // Match recipe ingredients against pantry items using the matching engine.
  const ingredientStatus = (recipe.ingredients || []).map((ing, idx) => {
    const ingNameLower = ing.name.toLowerCase().trim();
    const isStaple = PANTRY_STAPLES.some(
      (s) => ingNameLower === s || ingNameLower.startsWith(s + ' '),
    );

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
        genericName: canonicalize(ing.name),
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
