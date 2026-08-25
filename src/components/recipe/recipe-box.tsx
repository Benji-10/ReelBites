'use client';

import { useEffect } from 'react';
import { BookOpen, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useStore } from '@/lib/store';
import { RecipeCard } from './recipe-card';

export function RecipeBox() {
  const { recipes, fetchRecipes, setView, authToken } = useStore();

  // Only fetch if we don't have recipes yet (avoids re-adding deleted recipes).
  useEffect(() => {
    if (recipes.length === 0) {
      fetchRecipes();
    }
  }, [authToken, recipes.length, fetchRecipes]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6 sm:h-7 sm:w-7 text-primary" />
            Recipe Box
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {recipes.length === 0
              ? 'No recipes yet. Extract your first one!'
              : `${recipes.length} recipe${recipes.length === 1 ? '' : 's'} saved.`}
          </p>
        </div>
        <Button onClick={() => setView({ name: 'extract' })} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Recipe</span>
        </Button>
      </div>

      {recipes.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent">
              <BookOpen className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-semibold text-lg">Your recipe box is empty</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Paste an Instagram reel URL to extract your first recipe. It will be saved here
                automatically.
              </p>
            </div>
            <Button onClick={() => setView({ name: 'extract' })} className="gap-2 mt-4">
              <Plus className="h-4 w-4" />
              Extract a Recipe
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  );
}
