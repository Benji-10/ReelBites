'use client';
import { useRouter } from 'next/navigation';

import { useEffect, useState, useMemo } from 'react';
import { BookOpen, Plus, Star, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useStore } from '@/lib/store';
import { RecipeCard } from './recipe-card';

type FilterType = 'all' | 'favorites' | string; // string = collection name

export function RecipeBox() {
  const router = useRouter();
  const { recipes, fetchRecipes, authToken } = useStore();
  const [filter, setFilter] = useState<FilterType>('all');

  useEffect(() => {
    if (recipes.length === 0) {
      fetchRecipes();
    }
  }, [authToken, recipes.length, fetchRecipes]);

  // Get unique collections.
  const collections = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => {
      if (r.collection) set.add(r.collection);
    });
    return Array.from(set).sort();
  }, [recipes]);

  // Filter recipes.
  const filteredRecipes = useMemo(() => {
    if (filter === 'all') return recipes;
    if (filter === 'favorites') return recipes.filter((r) => r.isFavorite);
    return recipes.filter((r) => r.collection === filter);
  }, [recipes, filter]);

  const favoritesCount = recipes.filter((r) => r.isFavorite).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
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
        <Button onClick={() => router.push('/')} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Recipe</span>
        </Button>
      </div>

      {/* Filter tabs */}
      {recipes.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
          <button
            onClick={() => setFilter('all')}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            All ({recipes.length})
          </button>
          {favoritesCount > 0 && (
            <button
              onClick={() => setFilter('favorites')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
                filter === 'favorites' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <Star className="h-3.5 w-3.5" />
              Favorites ({favoritesCount})
            </button>
          )}
          {collections.map((col) => {
            const count = recipes.filter((r) => r.collection === col).length;
            return (
              <button
                key={col}
                onClick={() => setFilter(col)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  filter === col ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                <Folder className="h-3.5 w-3.5" />
                {col} ({count})
              </button>
            );
          })}
        </div>
      )}

      {filteredRecipes.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent">
              <BookOpen className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-semibold text-lg">
                {filter === 'favorites' ? 'No favorites yet'
                  : filter !== 'all' ? `No recipes in "${filter}"`
                  : 'Your recipe box is empty'}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {filter === 'favorites'
                  ? 'Star recipes to add them to your favorites.'
                  : filter !== 'all'
                    ? `Add recipes to the "${filter}" collection from the recipe detail page.`
                    : 'Paste an Instagram reel URL to extract your first recipe.'}
              </p>
            </div>
            <Button onClick={() => router.push('/')} className="gap-2 mt-4">
              <Plus className="h-4 w-4" />
              Extract a Recipe
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRecipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  );
}
