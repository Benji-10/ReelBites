'use client';
import { useRouter } from 'next/navigation';

import { Star, ListOrdered, AlertTriangle, ExternalLink, ChefHat, Clock, Wand2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';
import type { SavedRecipe } from '@/lib/types';

interface RecipeCardProps {
  recipe: SavedRecipe;
}

export function RecipeCard({ recipe }: RecipeCardProps) {
  const router = useRouter();

  const flagCount = recipe.flags?.length || 0;
  const ingredientCount = recipe.ingredients?.length || 0;
  const instructionCount = recipe.instructions?.length || 0;

  // Get metadata for display.
  const cuisine = recipe.metadata?.find((m) => m.key.toLowerCase() === 'cuisine');
  const totalTime = recipe.metadata?.find((m) => m.key.toLowerCase().includes('totaltime') || m.key.toLowerCase().includes('total time'));
  const difficulty = recipe.metadata?.find((m) => m.key.toLowerCase() === 'difficulty');

  return (
    <Card
      className="group cursor-pointer hover:shadow-md transition-all hover:-translate-y-0.5 relative"
      onClick={() => router.push(`/recipes/${recipe.id}`)}
    >
      {/* Favorite star */}
      {recipe.isFavorite && (
        <div className="absolute top-3 right-3 z-10">
          <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
        </div>
      )}

      {/* AI Generated badge */}
      {recipe.id.startsWith('temp-pantry-') && (
        <div className="absolute top-3 left-3 z-10">
          <Badge variant="secondary" className="text-xs gap-1 bg-primary/10 text-primary">
            <Wand2 className="h-3 w-3" />
            AI
          </Badge>
        </div>
      )}

      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <ChefHat className="h-5 w-5" />
          </div>
          {flagCount > 0 && !recipe.isFavorite && (
            <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50">
              <AlertTriangle className="h-3 w-3" />
              {flagCount}
            </Badge>
          )}
        </div>
        <CardTitle className="text-base line-clamp-2 group-hover:text-primary transition-colors pr-6">
          {recipe.title}
        </CardTitle>
        {recipe.description && (
          <CardDescription className="line-clamp-2 text-xs">
            {recipe.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
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
          {difficulty && (
            <Badge variant="secondary" className="text-xs">{difficulty.value}</Badge>
          )}
          {recipe.collection && (
            <Badge variant="outline" className="text-xs">{recipe.collection}</Badge>
          )}
        </div>

        {/* Tags */}
        {recipe.tags && recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {recipe.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {tag}
              </span>
            ))}
            {recipe.tags.length > 3 && (
              <span className="text-xs text-muted-foreground">+{recipe.tags.length - 3}</span>
            )}
          </div>
        )}

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

        <Button
          variant="ghost"
          size="sm"
          className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/recipes/${recipe.id}`);
          }}
        >
          View Recipe
        </Button>
      </CardContent>
    </Card>
  );
}
