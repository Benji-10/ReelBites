'use client';
import { useRouter } from 'next/navigation';

import { useEffect, useState, useMemo } from 'react';
import { BookOpen, Plus, Star, Folder, Wand2, Search, X, Clock, ChefHat, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useStore } from '@/lib/store';
import { RecipeCard } from './recipe-card';
import { PantryRecipeGenerator } from './pantry-recipe-generator';
import { SearchableMultiSelect } from './searchable-multi-select';

type FilterType = 'all' | 'favorites' | 'generated' | string;

type TimeFilter = 'all' | 'quick' | 'medium' | 'long';

// Parse a time string like "15 minutes", "1 hour", "30 mins" into minutes.
function parseTimeToMinutes(timeStr: string | undefined | null): number | null {
  if (!timeStr) return null;
  const lower = timeStr.toLowerCase();
  const hourMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:hr|hour|hours)/);
  const minMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)/);
  let total = 0;
  let found = false;
  if (hourMatch) {
    total += parseFloat(hourMatch[1]) * 60;
    found = true;
  }
  if (minMatch) {
    total += parseFloat(minMatch[1]);
    found = true;
  }
  return found ? total : null;
}

export function RecipeBox() {
  const router = useRouter();
  const { recipes, fetchRecipes, authToken, pantryItems } = useStore();
  const [filter, setFilter] = useState<FilterType>('all');
  const [showGenerator, setShowGenerator] = useState(false);

  // Search and filter state.
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedIngredients, setSelectedIngredients] = useState<Set<string>>(new Set());
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [showFilters, setShowFilters] = useState(false);

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

  // Get all unique tags across recipes.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => {
      r.tags?.forEach((t) => set.add(t));
    });
    return Array.from(set).sort();
  }, [recipes]);

  // Get all unique ingredient names (canonical) across recipes.
  const allIngredients = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => {
      r.ingredients?.forEach((ing) => {
        const name = ing.canonicalName || ing.name;
        if (name) set.add(name);
      });
    });
    return Array.from(set).sort();
  }, [recipes]);

  // Get all unique cuisines.
  const allCuisines = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => {
      const cuisine = r.metadata?.find((m) => m.key.toLowerCase() === 'cuisine');
      if (cuisine?.value) set.add(cuisine.value);
    });
    return Array.from(set).sort();
  }, [recipes]);

  // Active filter count (for the badge).
  const activeFilterCount =
    (searchQuery ? 1 : 0) +
    selectedTags.size +
    selectedIngredients.size +
    (timeFilter !== 'all' ? 1 : 0);

  // Filter recipes with all criteria.
  const filteredRecipes = useMemo(() => {
    let result = recipes;

    // Collection/favorites filter.
    if (filter === 'favorites') result = result.filter((r) => r.isFavorite);
    else if (filter !== 'all') result = result.filter((r) => r.collection === filter);

    // Search query — match on title and description.
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q))
      );
    }

    // Tag filter — recipe must have ALL selected tags.
    if (selectedTags.size > 0) {
      result = result.filter((r) => {
        const recipeTags = r.tags || [];
        return Array.from(selectedTags).every((tag) => recipeTags.includes(tag));
      });
    }

    // Ingredient filter — recipe must contain ALL selected ingredients.
    if (selectedIngredients.size > 0) {
      result = result.filter((r) => {
        const recipeIngs = (r.ingredients || []).map((ing) =>
          (ing.canonicalName || ing.name).toLowerCase(),
        );
        return Array.from(selectedIngredients).every((ing) =>
          recipeIngs.some((ri) => ri === ing.toLowerCase() || ri.includes(ing.toLowerCase())),
        );
      });
    }

    // Time filter — based on total time.
    if (timeFilter !== 'all') {
      result = result.filter((r) => {
        const totalTime = r.metadata?.find(
          (m) => m.key.toLowerCase().includes('totaltime') || m.key.toLowerCase().includes('total time'),
        );
        const minutes = parseTimeToMinutes(totalTime?.value);
        if (minutes === null) return false;
        if (timeFilter === 'quick') return minutes <= 20;
        if (timeFilter === 'medium') return minutes > 20 && minutes <= 45;
        if (timeFilter === 'long') return minutes > 45;
        return true;
      });
    }

    return result;
  }, [recipes, filter, searchQuery, selectedTags, selectedIngredients, timeFilter]);

  const favoritesCount = recipes.filter((r) => r.isFavorite).length;

  function clearAllFilters() {
    setSearchQuery('');
    setSelectedTags(new Set());
    setSelectedIngredients(new Set());
    setTimeFilter('all');
  }

  const timeFilters: { value: TimeFilter; label: string; icon: string; color: string }[] = [
    { value: 'quick', label: 'Quick', icon: '⚡', color: 'text-green-600 border-green-300 bg-green-50' },
    { value: 'medium', label: 'Medium', icon: '⏱', color: 'text-amber-600 border-amber-300 bg-amber-50' },
    { value: 'long', label: 'Long', icon: '🔥', color: 'text-red-600 border-red-300 bg-red-50' },
  ];

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
              : `${filteredRecipes.length} of ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}${activeFilterCount > 0 ? ` (${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active)` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowGenerator(true)}
            variant="outline"
            className="gap-2"
            disabled={pantryItems.length === 0}
            title={pantryItems.length === 0 ? 'Add pantry items first' : 'Generate recipes from your pantry'}
          >
            <Wand2 className="h-4 w-4" />
            <span className="hidden sm:inline">AI Recipes</span>
          </Button>
          <Button onClick={() => router.push('/')} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Recipe</span>
          </Button>
        </div>
      </div>

      {/* Search bar */}
      {recipes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search recipes by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-10"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button
              variant={showFilters ? 'default' : 'outline'}
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => setShowFilters(!showFilters)}
              title="Toggle filters"
            >
              <Filter className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          {/* Advanced filters */}
          {showFilters && (
            <Card className="p-4 space-y-4">
              {/* Time filter — flashy pills */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Cooking Time</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setTimeFilter('all')}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                      timeFilter === 'all'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    All
                  </button>
                  {timeFilters.map((tf) => (
                    <button
                      key={tf.value}
                      onClick={() => setTimeFilter(tf.value)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border flex items-center gap-1.5 ${
                        timeFilter === tf.value
                          ? tf.color + ' border-current font-semibold'
                          : 'bg-background text-muted-foreground border-border hover:bg-muted'
                      }`}
                    >
                      <span>{tf.icon}</span>
                      {tf.label}
                      {tf.value === 'quick' && <span className="text-xs opacity-70">≤20m</span>}
                      {tf.value === 'medium' && <span className="text-xs opacity-70">20-45m</span>}
                      {tf.value === 'long' && <span className="text-xs opacity-70">{'>'}45m</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tag multi-select (searchable) */}
              {allTags.length > 0 && (
                <SearchableMultiSelect
                  options={allTags}
                  selected={selectedTags}
                  onChange={setSelectedTags}
                  placeholder="Filter by tags..."
                  searchPlaceholder="Search tags..."
                  label="Tags"
                />
              )}

              {/* Ingredient multi-select (searchable) */}
              {allIngredients.length > 0 && (
                <SearchableMultiSelect
                  options={allIngredients}
                  selected={selectedIngredients}
                  onChange={setSelectedIngredients}
                  placeholder="Filter by ingredients..."
                  searchPlaceholder="Search ingredients..."
                  label="Ingredients"
                  icon={<ChefHat className="h-4 w-4 text-primary" />}
                  capitalize
                />
              )}

              {/* Clear all */}
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearAllFilters} className="w-full text-xs gap-1.5">
                  <X className="h-3.5 w-3.5" />
                  Clear all filters
                </Button>
              )}
            </Card>
          )}

          {/* Collection tabs */}
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
                {activeFilterCount > 0 ? 'No recipes match your filters'
                  : filter === 'favorites' ? 'No favorites yet'
                  : filter !== 'all' ? `No recipes in "${filter}"`
                  : 'Your recipe box is empty'}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {activeFilterCount > 0
                  ? 'Try adjusting your search or filters.'
                  : filter === 'favorites'
                    ? 'Star recipes to add them to your favorites.'
                    : filter !== 'all'
                      ? `Add recipes to the "${filter}" collection from the recipe detail page.`
                      : 'Paste an Instagram reel URL to extract your first recipe.'}
              </p>
            </div>
            {activeFilterCount > 0 ? (
              <Button onClick={clearAllFilters} variant="outline" className="gap-2 mt-4">
                <X className="h-4 w-4" />
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => router.push('/')} className="gap-2 mt-4">
                <Plus className="h-4 w-4" />
                Extract a Recipe
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRecipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}

      {/* AI Recipe Generator */}
      <PantryRecipeGenerator open={showGenerator} onOpenChange={setShowGenerator} />
    </div>
  );
}
