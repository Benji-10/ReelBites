'use client';
import { useRouter, usePathname } from 'next/navigation';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Trash2, Save, X, Plus, Pencil, ExternalLink,
  ChefHat, ListOrdered, Clock, Users, Minus, ChevronRight, Maximize2,
  Star, Tag, FolderPlus, ChefHat as ChefIcon, Share2, Copy, Check, Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';
import type { SavedRecipe, RecipeIngredient, RecipeInstruction, RecipeMetadata } from '@/lib/types';

import { EvidenceTooltip } from './evidence-tooltip';
import { CookingMode } from './cooking-mode';
import { IngredientLink } from './ingredient-link';
import { RecipeActions } from './recipe-actions';
import { RecipePantryIntegration } from './recipe-pantry-integration';
import { InventoryDeductionModal } from './inventory-deduction-modal';
import { useSettings } from '@/lib/settings';

// Returns the appropriate icon for a metadata key.
function getMetadataIcon(key: string) {
  const k = key.toLowerCase();
  if (k.includes('prep') || k.includes('cook') || k.includes('time') || k.includes('total'))
    return <Clock className="h-4 w-4 text-primary shrink-0" />;
  if (k.includes('difficult'))
    return <ChefIcon className="h-4 w-4 text-primary shrink-0" />;
  if (k.includes('cuisine'))
    return <ChefHat className="h-4 w-4 text-primary shrink-0" />;
  if (k.includes('temperature'))
    return <ChefIcon className="h-4 w-4 text-primary shrink-0" />;
  if (k.includes('equipment'))
    return <ChefHat className="h-4 w-4 text-primary shrink-0" />;
  return <ChefIcon className="h-4 w-4 text-primary shrink-0" />;
}

export function RecipeDetail() {
  const router = useRouter();
  const pathname = usePathname();
  const { recipes, updateRecipe, removeRecipe, authToken } = useStore();
  // Get recipeId from the URL pathname.
  const recipeId = pathname?.startsWith('/recipes/')
    ? pathname.split('/recipes/')[1] || null
    : null;

  const [recipe, setRecipe] = useState<SavedRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cookingMode, setCookingMode] = useState(false);
  const [showDeduction, setShowDeduction] = useState(false);

  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIngredients, setEditIngredients] = useState<RecipeIngredient[]>([]);
  const [editInstructions, setEditInstructions] = useState<RecipeInstruction[]>([]);
  const [editMetadata, setEditMetadata] = useState<RecipeMetadata[]>([]);
  const [editSourceUrl, setEditSourceUrl] = useState('');

  // Checklist state — which ingredients are checked off.
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());

  // Recipe scaling state.
  const [scaleFactor, setScaleFactor] = useState(1);
  const { smallLiquid, largeLiquid, weight, dry, temperature, inventoryDeduction } = useSettings();

  const loadRecipe = useCallback(async () => {
    if (!recipeId) return;
    // Only show loading spinner on the FIRST load (when we have no recipe yet).
    // When the token loads later and triggers a re-fetch, don't flash the spinner.
    if (!recipe) setLoading(true);

    // Try to find in the store first (instant if available).
    let fromStore = recipes.find((r) => r.id === recipeId);
    if (fromStore) {
      setRecipe(fromStore);
      setEditTitle(fromStore.title);
      setEditDescription(fromStore.description || '');
      setEditIngredients([...(fromStore.ingredients || [])]);
      setEditInstructions([...(fromStore.instructions || [])]);
      setEditMetadata([...(fromStore.metadata || [])]);
      setEditSourceUrl(fromStore.sourceUrl || '');
      setLoading(false);
      return;
    }

    // If not in store and it's a temp ID, we can't fetch from API.
    if (recipeId.startsWith('temp-')) {
      setLoading(false);
      return;
    }

    // Helper to apply recipe data to state.
    const applyRecipe = (r: NonNullable<typeof recipe>) => {
      setRecipe(r);
      setEditTitle(r.title);
      setEditDescription(r.description || '');
      setEditIngredients([...(r.ingredients || [])]);
      setEditInstructions([...(r.instructions || [])]);
      setEditMetadata([...(r.metadata || [])]);
      setEditSourceUrl(r.sourceUrl || '');
    };

    try {
      // Strategy: try the private endpoint first (if we have a token).
      // If it 404s (token not loaded yet on hard refresh, or recipe belongs
      // to another user), fall back to the PUBLIC endpoint which works
      // without auth. This fixes the 404-on-refresh bug.
      let privateRecipe: NonNullable<typeof recipe> | null = null;

      if (authToken) {
        const response = await fetch(`/api/recipes/${recipeId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (response.ok) {
          const data = await response.json();
          if (data.recipe) privateRecipe = data.recipe;
        }
      }

      if (privateRecipe) {
        applyRecipe(privateRecipe);
      } else {
        // Fall back to public endpoint (no auth needed).
        const publicResponse = await fetch(`/api/recipes/${recipeId}/public`);
        if (publicResponse.ok) {
          const publicData = await publicResponse.json();
          if (publicData.recipe) {
            applyRecipe(publicData.recipe);
          } else {
            throw new Error('Recipe not found.');
          }
        } else {
          throw new Error('Recipe not found.');
        }
      }
    } catch (err) {
      // Only show error toast if we still don't have a recipe.
      if (!recipe) {
        toast.error('Could not load recipe: ' + (err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [recipeId, recipes, authToken, recipe]);

  useEffect(() => {
    loadRecipe();
  }, [loadRecipe]);

  // Watch the store for updates to this recipe (e.g. after canonicalization
  // completes in the extraction flow, the store gets the canonicalized recipe).
  // When the store version changes, update the local recipe state.
  const storeRecipe = recipes.find((r) => r.id === recipeId);
  useEffect(() => {
    if (storeRecipe && storeRecipe !== recipe) {
      // Only update if the store version has canonicalized ingredients
      // (or more data than what we currently have).
      const storeHasCanonical = storeRecipe.ingredients?.some((i) => i.canonicalName);
      const currentHasCanonical = recipe?.ingredients?.some((i) => i.canonicalName);
      if (storeHasCanonical && !currentHasCanonical) {
        setRecipe(storeRecipe);
        setEditTitle(storeRecipe.title);
        setEditDescription(storeRecipe.description || '');
        setEditIngredients([...(storeRecipe.ingredients || [])]);
        setEditInstructions([...(storeRecipe.instructions || [])]);
        setEditMetadata([...(storeRecipe.metadata || [])]);
        setEditSourceUrl(storeRecipe.sourceUrl || '');
      }
    }
  }, [storeRecipe, recipe]);

  // Parse servings from metadata.
  const servingsMeta = recipe?.metadata?.find((m) => m.key.toLowerCase() === 'servings');
  const originalServings = servingsMeta ? parseInt(servingsMeta.value, 10) || 1 : 1;
  const currentServings = Math.round(originalServings * scaleFactor);

  function toggleIngredient(index: number) {
    const next = new Set(checkedIngredients);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setCheckedIngredients(next);
  }

  function scaleAmount(amount: string | null | undefined): string {
    if (!amount) return '';
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    const scaled = num * scaleFactor;
    return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(2).replace(/\.?0+$/, '');
  }

  // Categorize a unit into its measurement type.
  type UnitCategory = 'smallLiquid' | 'largeLiquid' | 'weight' | 'dry' | 'temperature' | 'other';

  function categorizeUnit(unit: string): UnitCategory {
    const u = unit.toLowerCase().trim();
    if (['tsp', 'teaspoon', 'teaspoons', 'tbsp', 'tablespoon', 'tablespoons'].includes(u)) return 'smallLiquid';
    if (['cup', 'cups', 'pint', 'pints', 'quart', 'quarts', 'gallon', 'gallons', 'l', 'liter', 'liters'].includes(u)) return 'largeLiquid';
    if (['ml', 'milliliter', 'milliliters'].includes(u)) return 'largeLiquid';
    if (['oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms'].includes(u)) return 'weight';
    if (['°f', 'f', 'fahrenheit', '°c', 'c', 'celsius'].includes(u)) return 'temperature';
    return 'other';
  }

  // Unit conversion tables (no AI — pure math).
  const IMPERIAL_TO_METRIC: Record<string, { factor: number; unit: string }> = {
    'cup': { factor: 240, unit: 'ml' },
    'cups': { factor: 240, unit: 'ml' },
    'tbsp': { factor: 15, unit: 'ml' },
    'tablespoon': { factor: 15, unit: 'ml' },
    'tablespoons': { factor: 15, unit: 'ml' },
    'tsp': { factor: 5, unit: 'ml' },
    'teaspoon': { factor: 5, unit: 'ml' },
    'teaspoons': { factor: 5, unit: 'ml' },
    'oz': { factor: 28.35, unit: 'g' },
    'ounce': { factor: 28.35, unit: 'g' },
    'ounces': { factor: 28.35, unit: 'g' },
    'lb': { factor: 453.6, unit: 'g' },
    'lbs': { factor: 453.6, unit: 'g' },
    'pound': { factor: 453.6, unit: 'g' },
    'pounds': { factor: 453.6, unit: 'g' },
    'pint': { factor: 473, unit: 'ml' },
    'pints': { factor: 473, unit: 'ml' },
    'quart': { factor: 946, unit: 'ml' },
    'quarts': { factor: 946, unit: 'ml' },
    'gallon': { factor: 3785, unit: 'ml' },
    'gallons': { factor: 3785, unit: 'ml' },
  };

  const METRIC_TO_IMPERIAL: Record<string, { factor: number; unit: string }> = {
    'ml': { factor: 0.0042, unit: 'cups' },
    'g': { factor: 0.0353, unit: 'oz' },
    'kg': { factor: 2.205, unit: 'lb' },
    'l': { factor: 4.227, unit: 'cups' },
    'liter': { factor: 4.227, unit: 'cups' },
    'liters': { factor: 4.227, unit: 'cups' },
  };

  function convertUnit(amount: string | null | undefined, unit: string | null | undefined): { amount: string; unit: string } {
    if (!amount || !unit) return { amount: amount || '', unit: unit || '' };
    const num = parseFloat(amount);
    if (isNaN(num)) return { amount, unit };

    const normalizedUnit = unit.toLowerCase().trim();

    // Temperature needs special formula.
    if (['°f', 'f', 'fahrenheit'].includes(normalizedUnit)) {
      if (temperature === 'metric') {
        return { amount: Math.round((num - 32) * 5 / 9).toString(), unit: '°C' };
      }
      return { amount, unit };
    }
    if (['°c', 'c', 'celsius'].includes(normalizedUnit)) {
      if (temperature === 'imperial') {
        return { amount: Math.round(num * 9 / 5 + 32).toString(), unit: '°F' };
      }
      return { amount, unit };
    }

    // Determine the category and the user's preference for that category.
    const category = categorizeUnit(normalizedUnit);
    let preference: 'metric' | 'imperial' | null = null;

    // For cups, use the 'dry' setting (user might want grams for flour/sugar).
    if (normalizedUnit === 'cup' || normalizedUnit === 'cups') {
      preference = dry;
    } else {
      switch (category) {
        case 'smallLiquid': preference = smallLiquid; break;
        case 'largeLiquid': preference = largeLiquid; break;
        case 'weight': preference = weight; break;
        default: return { amount, unit }; // No conversion for 'other'
      }
    }

    if (preference === 'metric') {
      const conv = IMPERIAL_TO_METRIC[normalizedUnit];
      if (conv) {
        const converted = num * conv.factor;
        const formatted = converted >= 100 ? Math.round(converted).toString() : converted.toFixed(1).replace(/\.0$/, '');
        return { amount: formatted, unit: conv.unit };
      }
    } else if (preference === 'imperial') {
      const conv = METRIC_TO_IMPERIAL[normalizedUnit];
      if (conv) {
        const converted = num * conv.factor;
        const formatted = converted < 1 ? converted.toFixed(2).replace(/\.?0+$/, '') : converted.toFixed(1).replace(/\.0$/, '');
        return { amount: formatted, unit: conv.unit };
      }
    }

    return { amount, unit };
  }

  function getDisplayAmount(ing: RecipeIngredient): { amount: string; unit: string } {
    const scaled = scaleAmount(ing.amount);
    const converted = convertUnit(scaled, ing.unit);
    return converted;
  }

  // Generic update for favorites, tags, collection (no edit mode needed).
  async function updateRecipeMeta(updates: Partial<SavedRecipe>) {
    if (!recipe) return;
    const updated = { ...recipe, ...updates } as SavedRecipe;
    setRecipe(updated);
    updateRecipe(updated);

    // Save to DB in the background.
    try {
      await fetch(`/api/recipes/${recipe.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(updates),
      });
    } catch (err) {
      console.warn('Could not save recipe meta:', err);
    }
  }

  function toggleEdit(section: string) {
    const next = new Set(editing);
    if (next.has(section)) {
      next.delete(section);
      if (recipe) {
        if (section === 'title') setEditTitle(recipe.title);
        if (section === 'description') setEditDescription(recipe.description || '');
        if (section === 'ingredients') setEditIngredients([...(recipe.ingredients || [])]);
        if (section === 'instructions') setEditInstructions([...(recipe.instructions || [])]);
        if (section === 'metadata') setEditMetadata([...(recipe.metadata || [])]);
        if (section === 'source') setEditSourceUrl(recipe.sourceUrl || '');
      }
    } else {
      next.add(section);
    }
    setEditing(next);
  }

  async function saveSection(section: string) {
    if (!recipe) return;
    setSaving(true);
    try {
      const updates: Partial<SavedRecipe> = {};
      if (section === 'title') updates.title = editTitle;
      if (section === 'description') updates.description = editDescription;
      if (section === 'ingredients') updates.ingredients = editIngredients;
      if (section === 'instructions') updates.instructions = editInstructions;
      if (section === 'metadata') updates.metadata = editMetadata;
      if (section === 'source') updates.sourceUrl = editSourceUrl;

      const response = await fetch(`/api/recipes/${recipe.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) throw new Error('Failed to save.');
      const data = await response.json();

      const updated = { ...recipe, ...updates } as SavedRecipe;
      setRecipe(updated);
      updateRecipe(updated);
      toggleEdit(section);
      toast.success('Recipe updated.');
    } catch (err) {
      toast.error('Could not save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Auto-deduct ingredients from pantry (for 'auto' inventory deduction mode).
  // Matches recipe ingredients to pantry items and deducts the scaled amounts.
  async function autoDeduct() {
    if (!recipe?.ingredients || recipe.ingredients.length === 0) return;

    const { pantryItems, authToken, fetchPantry } = useStore.getState();

    // Match recipe ingredients to pantry items (same logic as the modal).
    const deductions = recipe.ingredients
      .map((ing) => {
        const ingNameLower = ing.name.toLowerCase().trim();
        const ingCanonical = ing.canonicalName?.toLowerCase().trim();
        const match = pantryItems.find((p) => {
          const pName = p.name.toLowerCase().trim();
          const pGeneric = p.genericName?.toLowerCase().trim();
          if (ingCanonical && pGeneric && ingCanonical === pGeneric) return true;
          if (ingNameLower === pName || ingNameLower === pGeneric) return true;
          if (ingNameLower.length > 3 && (pName.includes(ingNameLower) || ingNameLower.includes(pName))) return true;
          return false;
        });
        if (!match) return null;
        const amount = parseFloat(ing.amount || '0') * scaleFactor;
        if (isNaN(amount) || amount <= 0) return null;
        return {
          pantryItemId: match.id,
          deductAmount: amount,
          deductUnit: ing.unit || '',
          markAsUsedUp: false,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    if (deductions.length === 0) {
      toast.info('No matching pantry items to deduct.');
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
      await fetchPantry();

      toast.success(
        `Auto-deducted ${deductions.length} ingredient${deductions.length > 1 ? 's' : ''} from your pantry. ` +
        `${data.deleted || 0} item${data.deleted === 1 ? '' : 's'} finished.`,
      );
    } catch (err) {
      toast.error('Could not auto-deduct ingredients: ' + (err as Error).message);
    }
  }

  async function handleDelete() {
    if (!recipe) return;
    const recipeId = recipe.id;
    // Optimistically remove from local state FIRST, before the API call.
    // This ensures the recipe disappears immediately even if the API is slow.
    removeRecipe(recipeId);
    toast.success('Recipe deleted.');
    router.push('/recipes');

    // Then delete from the DB in the background (don't block the UI).
    if (!recipeId.startsWith('temp-')) {
      try {
        const response = await fetch(`/api/recipes/${recipeId}`, {
          method: 'DELETE',
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        if (!response.ok) {
          console.warn('Delete from DB failed:', response.status);
        }
      } catch (err) {
        console.warn('Delete from DB failed:', err);
      }
    }
  }

  function updateIngredient(index: number, field: keyof RecipeIngredient, value: string) {
    const next = [...editIngredients];
    next[index] = { ...next[index], [field]: value || null };
    setEditIngredients(next);
  }
  function addIngredient() {
    setEditIngredients([...editIngredients, { name: '', amount: null, unit: null, notes: null, evidence: null, flag: null }]);
  }
  function removeIngredient(index: number) {
    setEditIngredients(editIngredients.filter((_, i) => i !== index));
  }

  function updateInstruction(index: number, value: string) {
    const next = [...editInstructions];
    next[index] = { ...next[index], step: value };
    setEditInstructions(next);
  }
  function addInstruction() {
    setEditInstructions([...editInstructions, { step: '', evidence: null, flag: null }]);
  }
  function removeInstruction(index: number) {
    setEditInstructions(editInstructions.filter((_, i) => i !== index));
  }

  function updateMetadata(index: number, field: keyof RecipeMetadata, value: string) {
    const next = [...editMetadata];
    next[index] = { ...next[index], [field]: value || null };
    setEditMetadata(next);
  }
  function addMetadata() {
    setEditMetadata([...editMetadata, { key: '', value: '', evidence: null, flag: null }]);
  }
  function removeMetadata(index: number) {
    setEditMetadata(editMetadata.filter((_, i) => i !== index));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">Loading recipe...</div>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-muted-foreground">Recipe not found.</p>
        <Button onClick={() => router.push('/recipes')}>Back to Recipe Box</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.push('/recipes')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-1">
          <ShareButton recipeId={recipe.id} recipeTitle={recipe.title} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this recipe?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. The recipe &ldquo;{recipe.title}&rdquo; will be permanently removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Title & Description */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            {editing.has('title') ? (
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-2xl font-bold h-auto py-2"
              />
            ) : (
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{recipe.title}</h1>
            )}
          </div>
          <EditButton
            isEditing={editing.has('title')}
            onSave={() => saveSection('title')}
            onCancel={() => toggleEdit('title')}
            onEdit={() => toggleEdit('title')}
            saving={saving}
          />
        </div>

        {editing.has('description') ? (
          <Textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            rows={2}
            placeholder="Add a description..."
          />
        ) : (
          recipe.description && (
            <p className="text-muted-foreground leading-relaxed">{recipe.description}</p>
          )
        )}

        {/* Tags + Collection badges (metadata is shown in the grid below) */}

        {/* Source link */}
        {recipe.sourceUrl && (
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {recipe.sourceUrl && recipe.sourceUrl.includes('instagram.com') ? 'View original reel' : 'View website'}
          </a>
        )}

        {/* Tags + Collection badges */}
        {recipe.tags && recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {recipe.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
          </div>
        )}
        {recipe.collection && (
          <Badge variant="outline" className="text-xs">
            <FolderPlus className="h-3 w-3 mr-1" />
            {recipe.collection}
          </Badge>
        )}
      </div>

      {/* Action bar: favorite, tags, collection */}
      <RecipeActions recipe={recipe} onUpdate={updateRecipeMeta} />

      {/* Metadata display */}
      {recipe.metadata && recipe.metadata.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {recipe.metadata.filter(m => !['servings'].includes(m.key.toLowerCase())).map((m, i) => {
            const icon = getMetadataIcon(m.key);
            return (
              <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30">
                {icon}
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground capitalize">{m.key.replace(/([A-Z])/g, ' $1').trim()}</p>
                  <p className="text-sm font-medium truncate">{m.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recipe Scaling — always visible */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Servings</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setScaleFactor((f) => Math.max(0.5, f - 0.5))}
                disabled={scaleFactor <= 0.5}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="font-semibold tabular-nums w-12 text-center">{currentServings}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setScaleFactor((f) => f + 0.5)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              {scaleFactor !== 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setScaleFactor(1)}
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
          {scaleFactor !== 1 && (
            <p className="text-xs text-muted-foreground mt-2">
              Recipe scaled to {currentServings} servings (original: {originalServings})
            </p>
          )}
        </CardContent>
      </Card>

      {/* Ingredients — Checklist */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ChefHat className="h-5 w-5 text-primary" />
              Ingredients
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <EditButton
                isEditing={editing.has('ingredients')}
                onSave={() => saveSection('ingredients')}
                onCancel={() => toggleEdit('ingredients')}
                onEdit={() => toggleEdit('ingredients')}
                saving={saving}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {editing.has('ingredients') ? (
            <div className="space-y-2">
              {editIngredients.map((ing, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-center p-2 rounded-md border border-border/60">
                  <Input
                    value={ing.name}
                    onChange={(e) => updateIngredient(i, 'name', e.target.value)}
                    placeholder="Ingredient"
                    className="flex-1 min-w-[120px] h-8 text-sm"
                  />
                  <Input
                    value={ing.amount || ''}
                    onChange={(e) => updateIngredient(i, 'amount', e.target.value)}
                    placeholder="Amount"
                    className="w-20 h-8 text-sm"
                  />
                  <Input
                    value={ing.unit || ''}
                    onChange={(e) => updateIngredient(i, 'unit', e.target.value)}
                    placeholder="Unit"
                    className="w-24 h-8 text-sm"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeIngredient(i)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addIngredient} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add ingredient
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {recipe.ingredients?.map((ing, i) => {
                const isChecked = checkedIngredients.has(i);
                return (
                  <label
                    key={i}
                    className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/50 cursor-pointer group"
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleIngredient(i)}
                    />
                    <span
                      className={`flex-1 text-sm transition-all ${
                        isChecked ? 'line-through text-muted-foreground' : ''
                      }`}
                    >
                      <span className="font-medium">{ing.name}</span>
                      {(ing.amount || ing.unit) && (() => {
                        const display = getDisplayAmount(ing);
                        return (
                          <span className="text-muted-foreground ml-2">
                            {display.amount}{display.unit && ` ${display.unit}`}
                          </span>
                        );
                      })()}
                    </span>
                    <EvidenceTooltip
                      evidence={ing.evidence}
                      flag={ing.flag}
                      notes={ing.notes}
                      ingredientEstimated={ing.flag === 'estimated_ingredient'}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pantry integration — shows what you have and what's missing */}
      <RecipePantryIntegration recipe={recipe} />

      {/* Instructions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListOrdered className="h-5 w-5 text-primary" />
              Instructions
            </CardTitle>
            <div className="flex items-center gap-1.5">
              {recipe.instructions && recipe.instructions.length > 0 && !editing.has('instructions') && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCookingMode(true)}
                    className="gap-1.5"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Cooking Mode</span>
                    <span className="sm:hidden">Cook</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeduction(true)}
                    className="gap-1.5"
                    title="Deduct used ingredients from your pantry"
                  >
                    <Package className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Deduct Pantry</span>
                    <span className="sm:hidden">Deduct</span>
                  </Button>
                </>
              )}
              <EditButton
                isEditing={editing.has('instructions')}
                onSave={() => saveSection('instructions')}
                onCancel={() => toggleEdit('instructions')}
                onEdit={() => toggleEdit('instructions')}
                saving={saving}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {editing.has('instructions') ? (
            <div className="space-y-3">
              {editInstructions.map((inst, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold shrink-0">
                    {i + 1}
                  </div>
                  <Textarea
                    value={inst.step}
                    onChange={(e) => updateInstruction(i, e.target.value)}
                    rows={2}
                    className="flex-1 text-sm"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeInstruction(i)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addInstruction} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add step
              </Button>
            </div>
          ) : (
            <ol className="space-y-5">
              {recipe.instructions?.map((inst, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm leading-relaxed">{inst.step}</p>
                    {/* Ingredient chips for this step */}
                    <IngredientLink
                      ingredientRefs={inst.ingredientRefs}
                      ingredients={recipe.ingredients || []}
                      scaleAmount={scaleAmount}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Flags */}
      {recipe.flags && recipe.flags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recipe.flags.map((flag, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-amber-500 mt-0.5">•</span>
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground capitalize">
                      {flag.type.replace(/_/g, ' ')}:
                    </span>{' '}
                    {flag.message}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Sources — collapsible */}
      {(recipe.sourceCaption || recipe.sourceComments || recipe.transcript || recipe.ocrText) && (
        <Card>
          <CardContent className="py-4">
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
                <ChevronRight className="h-4 w-4 group-open:rotate-90 transition-transform" />
                View sources (caption, comments, transcript, OCR)
              </summary>
              <div className="mt-4 space-y-4 text-xs">
                {recipe.sourceCaption && (
                  <div>
                    <p className="font-semibold mb-1.5 text-foreground">Caption</p>
                    <p className="text-muted-foreground whitespace-pre-wrap bg-muted/40 rounded-md p-3 leading-relaxed">
                      {recipe.sourceCaption}
                    </p>
                  </div>
                )}
                {recipe.sourceComments && Array.isArray(recipe.sourceComments) && recipe.sourceComments.length > 0 && (
                  <div>
                    <p className="font-semibold mb-1.5 text-foreground">Comments ({recipe.sourceComments.length})</p>
                    <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                      {(recipe.sourceComments as Array<{ text: string; author: string; likes: number; isPinned?: boolean; isAuthor?: boolean }>).map((c, i) => (
                        <div key={i} className="bg-muted/40 rounded-md p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-foreground">@{c.author}</span>
                            {c.isPinned && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">Pinned</span>
                            )}
                            {c.isAuthor && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">Author</span>
                            )}
                            <span className="text-muted-foreground ml-auto">{c.likes} likes</span>
                          </div>
                          <p className="text-muted-foreground whitespace-pre-wrap">{c.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {recipe.transcript && (
                  <div>
                    <p className="font-semibold mb-1.5 text-foreground">Audio Transcript</p>
                    <p className="text-muted-foreground whitespace-pre-wrap bg-muted/40 rounded-md p-3 leading-relaxed max-h-60 overflow-y-auto custom-scrollbar">
                      {recipe.transcript}
                    </p>
                  </div>
                )}
                {recipe.ocrText && (
                  <div>
                    <p className="font-semibold mb-1.5 text-foreground">OCR Text (on-screen)</p>
                    <p className="text-muted-foreground whitespace-pre-wrap bg-muted/40 rounded-md p-3 leading-relaxed max-h-60 overflow-y-auto custom-scrollbar">
                      {recipe.ocrText}
                    </p>
                  </div>
                )}
              </div>
            </details>
          </CardContent>
        </Card>
      )}

      {/* Cooking Mode overlay */}
      {cookingMode && recipe.instructions && (
        <CookingMode
          instructions={recipe.instructions}
          ingredients={recipe.ingredients || []}
          title={recipe.title}
          onClose={() => {
            setCookingMode(false);
            // When cooking mode ends, trigger inventory deduction based on settings.
            if (inventoryDeduction === 'auto' && recipe.ingredients) {
              // Auto mode: deduct immediately without showing the modal.
              autoDeduct();
            } else if (inventoryDeduction === 'confirm') {
              // Confirm mode: show the modal for review.
              setShowDeduction(true);
            }
            // 'none' — do nothing.
          }}
          scaleAmount={scaleAmount}
        />
      )}

      {/* Inventory Deduction Modal */}
      {showDeduction && recipe && (
        <InventoryDeductionModal
          open={showDeduction}
          onOpenChange={setShowDeduction}
          recipe={recipe}
          scaleFactor={scaleFactor}
        />
      )}
    </div>
  );
}

interface EditButtonProps {
  isEditing: boolean;
  onSave: () => void;
  onCancel: () => void;
  onEdit: () => void;
  saving: boolean;
  small?: boolean;
}

function EditButton({ isEditing, onSave, onCancel, onEdit, saving, small }: EditButtonProps) {
  if (isEditing) {
    return (
      <div className="flex gap-1.5 shrink-0">
        <Button size={small ? 'sm' : 'default'} variant="ghost" onClick={onCancel} disabled={saving} className="h-8">
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button size={small ? 'sm' : 'default'} onClick={onSave} disabled={saving} className="h-8 gap-1.5">
          {saving ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    );
  }
  return (
    <Button
      size={small ? 'sm' : 'default'}
      variant="ghost"
      onClick={onEdit}
      className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
    >
      <Pencil className="h-3.5 w-3.5" />
      Edit
    </Button>
  );
}

interface ShareButtonProps {
  recipeId: string;
  recipeTitle: string;
}

function ShareButton({ recipeId, recipeTitle }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  // Temp IDs (recipe not yet saved to DB) can't be shared publicly.
  const isTempId = recipeId.startsWith('temp-');

  // Compute the share URL on the client (lazy initial state — runs once
  // on mount, not on every render, so no cascading renders).
  const [shareUrl] = useState<string>(() => {
    if (typeof window === 'undefined' || isTempId) return '';
    return `${window.location.origin}/r/${recipeId}`;
  });

  async function handleCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success('Public link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy link. Long-press the URL to copy manually.');
    }
  }

  async function handleNativeShare() {
    if (!shareUrl) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: recipeTitle,
          text: `Check out this recipe: ${recipeTitle}`,
          url: shareUrl,
        });
      } catch {
        // User cancelled — no toast needed.
      }
    } else {
      handleCopy();
    }
  }

  if (isTempId) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        className="gap-1.5 opacity-50"
        title="Recipe must be saved before sharing"
      >
        <Share2 className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Share2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Share recipe</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Anyone with this link can view the recipe — no login needed.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              readOnly
              value={shareUrl}
              className="text-xs font-mono h-8"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="h-8 shrink-0 gap-1"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {typeof navigator !== 'undefined' && navigator.share && (
            <Button
              size="sm"
              onClick={handleNativeShare}
              className="w-full gap-1.5"
            >
              <Share2 className="h-3.5 w-3.5" />
              Share via…
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
