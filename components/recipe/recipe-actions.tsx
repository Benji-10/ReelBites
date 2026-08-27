'use client';

import { Star, Tag, FolderPlus, X, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { SavedRecipe } from '@/lib/types';

interface RecipeActionsProps {
  recipe: SavedRecipe;
  onUpdate: (updates: Partial<SavedRecipe>) => void;
}

const SUGGESTED_TAGS = [
  'quick', 'vegetarian', 'vegan', 'high-protein', 'baking', 'dessert',
  'breakfast', 'dinner', 'lunch', 'snack', 'healthy', 'comfort food',
  'gluten-free', 'dairy-free', 'low-carb', 'keto', 'spicy', 'sweet',
];

export function RecipeActions({ recipe, onUpdate }: RecipeActionsProps) {
  const [newTag, setNewTag] = useState('');
  const [newCollection, setNewCollection] = useState('');
  const [showCollectionInput, setShowCollectionInput] = useState(false);

  function toggleFavorite() {
    onUpdate({ isFavorite: !recipe.isFavorite });
  }

  function addTag(tag: string) {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed) return;
    const currentTags = recipe.tags || [];
    if (currentTags.includes(trimmed)) return;
    onUpdate({ tags: [...currentTags, trimmed] });
    setNewTag('');
  }

  function removeTag(tag: string) {
    const currentTags = recipe.tags || [];
    onUpdate({ tags: currentTags.filter((t) => t !== tag) });
  }

  function setCollection(name: string) {
    onUpdate({ collection: name.trim() || null });
    setNewCollection('');
    setShowCollectionInput(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Favorite */}
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleFavorite}
        className="gap-1.5 px-2"
      >
        <Star
          className={`h-4 w-4 ${recipe.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`}
        />
        <span className="text-xs">{recipe.isFavorite ? 'Favorited' : 'Favorite'}</span>
      </Button>

      {/* Tags */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 px-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs">Tags</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <div className="space-y-3">
            <p className="text-sm font-medium">Tags</p>
            {/* Current tags */}
            {recipe.tags && recipe.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {recipe.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                    {tag}
                    <button onClick={() => removeTag(tag)} className="ml-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {/* Add tag input */}
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag(newTag)}
                placeholder="Add tag..."
                className="h-8 text-sm"
              />
              <Button size="sm" onClick={() => addTag(newTag)} className="h-8 px-2">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            {/* Suggested tags */}
            <div className="flex flex-wrap gap-1">
              {SUGGESTED_TAGS.filter((t) => !(recipe.tags || []).includes(t)).slice(0, 10).map((tag) => (
                <button
                  key={tag}
                  onClick={() => addTag(tag)}
                  className="text-xs px-2 py-0.5 rounded-full border border-border hover:bg-muted transition-colors"
                >
                  + {tag}
                </button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Collection */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 px-2">
            <FolderPlus className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs">
              {recipe.collection || 'Collection'}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="start">
          <div className="space-y-3">
            <p className="text-sm font-medium">Collection</p>
            {recipe.collection && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCollection('')}
                className="w-full text-xs"
              >
                Remove from collection
              </Button>
            )}
            <Input
              value={newCollection}
              onChange={(e) => setNewCollection(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setCollection(newCollection)}
              placeholder="e.g. Friday cooking"
              className="h-8 text-sm"
            />
            <Button
              size="sm"
              onClick={() => setCollection(newCollection)}
              className="w-full text-xs"
              disabled={!newCollection.trim()}
            >
              Save to collection
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
