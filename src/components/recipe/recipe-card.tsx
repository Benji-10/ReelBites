'use client';

import { Clock, ListOrdered, AlertTriangle, ExternalLink, ChefHat } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';
import type { SavedRecipe } from '@/lib/types';

interface RecipeCardProps {
  recipe: SavedRecipe;
}

export function RecipeCard({ recipe }: RecipeCardProps) {
  const { setView } = useStore();

  const flagCount = recipe.flags?.length || 0;
  const ingredientCount = recipe.ingredients?.length || 0;
  const instructionCount = recipe.instructions?.length || 0;

  return (
    <Card
      className="group cursor-pointer hover:shadow-md transition-all hover:-translate-y-0.5"
      onClick={() => setView({ name: 'detail', recipeId: recipe.id })}
    >
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <ChefHat className="h-5 w-5" />
          </div>
          {flagCount > 0 && (
            <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50">
              <AlertTriangle className="h-3 w-3" />
              {flagCount}
            </Badge>
          )}
        </div>
        <CardTitle className="text-base line-clamp-2 group-hover:text-primary transition-colors">
          {recipe.title}
        </CardTitle>
        {recipe.description && (
          <CardDescription className="line-clamp-2 text-xs">
            {recipe.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ChefHat className="h-3.5 w-3.5" />
            {ingredientCount} ingredients
          </span>
          <span className="flex items-center gap-1">
            <ListOrdered className="h-3.5 w-3.5" />
            {instructionCount} steps
          </span>
        </div>
        {recipe.sourceUrl && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ExternalLink className="h-3 w-3" />
            <span className="truncate flex-1">
              {(() => {
                try {
                  return new URL(recipe.sourceUrl).pathname;
                } catch {
                  return recipe.sourceUrl;
                }
              })()}
            </span>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setView({ name: 'detail', recipeId: recipe.id });
          }}
        >
          View Recipe
        </Button>
      </CardContent>
    </Card>
  );
}
