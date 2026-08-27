'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { RecipeIngredient } from '@/lib/types';

interface IngredientLinkProps {
  /** The ingredient indices referenced by this instruction step. */
  ingredientRefs?: number[];
  /** All ingredients in the recipe. */
  ingredients: RecipeIngredient[];
  /** Scale factor for amounts (from recipe detail). */
  scaleAmount: (amount: string | null | undefined) => string;
}

/**
 * Displays referenced ingredients as clickable chips.
 * In cooking mode, clicking shows the full amount + unit.
 * In normal mode, clicking scrolls to the ingredient in the list.
 */
export function IngredientLink({ ingredientRefs, ingredients, scaleAmount }: IngredientLinkProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (!ingredientRefs || ingredientRefs.length === 0) return null;

  const referenced = ingredientRefs
    .filter((idx) => idx >= 0 && idx < ingredients.length)
    .map((idx) => ({ idx, ingredient: ingredients[idx] }));

  if (referenced.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      <span className="text-xs text-muted-foreground">Ingredients:</span>
      {referenced.map(({ idx, ingredient }) => (
        <Popover key={idx} open={openIdx === idx} onOpenChange={(o) => setOpenIdx(o ? idx : null)}>
          <PopoverTrigger asChild>
            <button
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {ingredient.name}
              {(ingredient.amount || ingredient.unit) && (
                <span className="text-primary/60">
                  {scaleAmount(ingredient.amount)}
                  {ingredient.unit && ` ${ingredient.unit}`}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 text-xs" side="top">
            <div className="space-y-1">
              <p className="font-medium text-sm">{ingredient.name}</p>
              {(ingredient.amount || ingredient.unit) && (
                <p className="text-muted-foreground">
                  Amount: <span className="font-medium text-foreground">
                    {scaleAmount(ingredient.amount)}
                    {ingredient.unit && ` ${ingredient.unit}`}
                  </span>
                </p>
              )}
              {ingredient.notes && (
                <p className="text-muted-foreground">{ingredient.notes}</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  );
}
