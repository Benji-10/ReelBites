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

  // Match recipe ingredients against pantry items using genericName.
  const ingredientStatus = (recipe.ingredients || []).map((ing, idx) => {
    const ingNameLower = ing.name.toLowerCase().trim();
    // Check if any pantry item matches by name or genericName.
    const match = pantryItems.find((p) => {
      const pName = p.name.toLowerCase().trim();
      const pGeneric = (p.genericName || '').toLowerCase().trim();
      return pName === ingNameLower ||
        pGeneric === ingNameLower ||
        pName.includes(ingNameLower) ||
        ingNameLower.includes(pName) ||
        pGeneric.includes(ingNameLower) ||
        ingNameLower.includes(pGeneric);
    });
    return {
      idx,
      ingredient: ing,
      inPantry: !!match,
      pantryItem: match,
    };
  });

  const haveCount = ingredientStatus.filter((s) => s.inPantry).length;
  const missingCount = ingredientStatus.length - haveCount;
  const missingIngredients = ingredientStatus.filter((s) => !s.inPantry).map((s) => s.ingredient);

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
