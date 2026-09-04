'use client';

import { useState, useMemo } from 'react';
import { X, Loader2, Check, Minus, Package, ShoppingCart, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { matchIngredient, type CanonicalIngredient } from '@/lib/canonicalize';
import type { SavedRecipe, RecipeIngredient } from '@/lib/types';

interface InventoryDeductionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: SavedRecipe;
  scaleFactor: number;
}

interface DeductionRow {
  recipeIngredient: RecipeIngredient;
  pantryItemId: string | null;
  pantryItemName: string;
  pantryItemQuantity: string | null;
  deductAmount: number;
  deductUnit: string;
  markAsUsedUp: boolean;
  matched: boolean;
}

export function InventoryDeductionModal({
  open,
  onOpenChange,
  recipe,
  scaleFactor,
}: InventoryDeductionModalProps) {
  const { authToken, pantryItems, fetchPantry, updatePantryItem, removePantryItem } = useStore();
  const [deducting, setDeducting] = useState(false);

  // Build the deduction rows by matching recipe ingredients to pantry items.
  const deductionRows = useMemo<DeductionRow[]>(() => {
    if (!recipe.ingredients || recipe.ingredients.length === 0) return [];

    return recipe.ingredients.map((ing) => {
      const recipeAmount = parseFloat(ing.amount || '0') * scaleFactor;
      const recipeUnit = ing.unit || '';

      // Build the recipe's canonical ingredient structure.
      const recipeCanonical: CanonicalIngredient = {
        canonical_name: ing.canonicalName || ing.name.toLowerCase().trim(),
        ancestors: ing.canonicalAncestors || [],
        attributes: ing.canonicalAttributes || {},
        hardAttributeKeys: ing.canonicalHardAttributeKeys || [],
      };

      // Find matching pantry item using the full matchIngredient logic.
      const match = pantryItems.find((p) => {
        const pantryCanonical: CanonicalIngredient = {
          canonical_name: p.genericName || p.name.toLowerCase().trim(),
          ancestors: (p as { canonicalAncestors?: string[] }).canonicalAncestors || [],
          attributes: (p as { canonicalAttributes?: Record<string, string | string[]> }).canonicalAttributes || {},
          hardAttributeKeys: (p as { canonicalHardAttributeKeys?: string[] }).canonicalHardAttributeKeys || [],
        };
        return matchIngredient(recipeCanonical, pantryCanonical).matched;
      });

      return {
        recipeIngredient: ing,
        pantryItemId: match?.id || null,
        pantryItemName: match?.name || '',
        pantryItemQuantity: match?.quantity || null,
        deductAmount: isNaN(recipeAmount) ? 0 : recipeAmount,
        deductUnit: recipeUnit,
        markAsUsedUp: false,
        matched: !!match,
      };
    });
  }, [recipe.ingredients, pantryItems, scaleFactor]);

  // Local state for editable amounts.
  const [editedAmounts, setEditedAmounts] = useState<Record<number, { amount: number; unit: string; markAsUsedUp: boolean }>>({});

  function getRowState(idx: number) {
    const row = deductionRows[idx];
    const edited = editedAmounts[idx];
    return {
      amount: edited?.amount ?? row.deductAmount,
      unit: edited?.unit ?? row.deductUnit,
      markAsUsedUp: edited?.markAsUsedUp ?? false,
    };
  }

  function updateRow(idx: number, updates: Partial<{ amount: number; unit: string; markAsUsedUp: boolean }>) {
    const current = getRowState(idx);
    setEditedAmounts((prev) => ({
      ...prev,
      [idx]: { ...current, ...updates },
    }));
  }

  async function handleDeduct() {
    setDeducting(true);

    const deductions = deductionRows
      .map((row, idx) => {
        if (!row.matched || !row.pantryItemId) return null;
        const state = getRowState(idx);
        return {
          pantryItemId: row.pantryItemId,
          deductAmount: state.amount,
          deductUnit: state.unit,
          markAsUsedUp: state.markAsUsedUp,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    if (deductions.length === 0) {
      toast.info('No matching pantry items to deduct.');
      setDeducting(false);
      onOpenChange(false);
      return;
    }

    try {
      const response = await fetch('/api/pantry/deduct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ deductions }),
      });

      if (!response.ok) throw new Error('Failed to deduct ingredients.');

      const data = await response.json();

      // Optimistically update the store — remove finished items.
      for (const deduction of deductions) {
        if (deduction.markAsUsedUp) {
          removePantryItem(deduction.pantryItemId);
        }
      }

      // Re-fetch the pantry to get accurate quantities and fill levels.
      await fetchPantry();

      toast.success(
        `Deducted ${deductions.length} ingredient${deductions.length > 1 ? 's' : ''} from your pantry. ` +
        `${data.deleted || 0} item${data.deleted === 1 ? '' : 's'} finished.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not deduct ingredients: ' + (err as Error).message);
    } finally {
      setDeducting(false);
    }
  }

  const matchedCount = deductionRows.filter((r) => r.matched).length;
  const unmatchedCount = deductionRows.length - matchedCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Deduct from Pantry
          </DialogTitle>
          <DialogDescription>
            Review the ingredients used in <strong>{recipe.title}</strong>.
            Edit amounts if you used more or less, or mark items as finished.
          </DialogDescription>
        </DialogHeader>

        {/* Summary */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="gap-1">
            <Check className="h-3 w-3 text-green-500" />
            {matchedCount} matched
          </Badge>
          {unmatchedCount > 0 && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {unmatchedCount} not in pantry
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            Scale: {scaleFactor}x
          </Badge>
        </div>

        {/* Ingredient list */}
        <div className="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar">
          {deductionRows.map((row, idx) => {
            const state = getRowState(idx);
            return (
              <Card
                key={idx}
                className={!row.matched ? 'opacity-50' : ''}
              >
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    {/* Checkbox / status */}
                    {row.matched ? (
                      <Checkbox
                        checked={!state.markAsUsedUp}
                        onCheckedChange={(checked) => updateRow(idx, { markAsUsedUp: !checked })}
                      />
                    ) : (
                      <div className="h-4 w-4 rounded-full border border-border" />
                    )}

                    {/* Ingredient info — just the pantry item name, not the recipe name */}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {row.matched ? row.pantryItemName : row.recipeIngredient.name}
                      </span>
                      {row.matched && row.pantryItemQuantity && !state.markAsUsedUp && (
                        <p className="text-xs text-muted-foreground">
                          In pantry: {row.pantryItemQuantity}
                        </p>
                      )}
                      {!row.matched && (
                        <p className="text-xs text-muted-foreground">
                          Not in your pantry
                        </p>
                      )}
                    </div>

                    {/* Amount stepper — +/- controls, no typing needed */}
                    {row.matched && !state.markAsUsedUp && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => updateRow(idx, { amount: Math.max(0, state.amount - 0.25) })}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="font-semibold tabular-nums text-sm w-12 text-center">
                          {state.amount}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => updateRow(idx, { amount: state.amount + 0.25 })}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <span className="text-xs text-muted-foreground w-12 text-center">
                          {state.unit}
                        </span>
                      </div>
                    )}

                    {/* "Used up" button */}
                    {row.matched && (
                      <Button
                        size="sm"
                        variant={state.markAsUsedUp ? 'default' : 'outline'}
                        className="h-8 text-xs gap-1 shrink-0"
                        onClick={() => updateRow(idx, { markAsUsedUp: !state.markAsUsedUp })}
                      >
                        <Minus className="h-3 w-3" />
                        {state.markAsUsedUp ? 'Finished' : 'Finish'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleDeduct} disabled={deducting || matchedCount === 0} className="gap-2">
            {deducting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deducting...
              </>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4" />
                Deduct {matchedCount} ingredient{matchedCount === 1 ? '' : 's'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
