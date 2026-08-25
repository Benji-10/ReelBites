'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Trash2, Save, X, Plus, Pencil, ExternalLink,
  ChefHat, ListOrdered, Clock, Users, Minus, Maximize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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

export function RecipeDetail() {
  const { view, recipes, updateRecipe, removeRecipe, setView, authToken } = useStore();
  const recipeId = view.name === 'detail' ? view.recipeId : null;

  const [recipe, setRecipe] = useState<SavedRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const loadRecipe = useCallback(async () => {
    if (!recipeId) return;
    setLoading(true);

    const fromStore = recipes.find((r) => r.id === recipeId);
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

    try {
      const response = await fetch(`/api/recipes/${recipeId}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (!response.ok) throw new Error('Failed to load recipe.');
      const data = await response.json();
      if (data.recipe) {
        setRecipe(data.recipe);
        setEditTitle(data.recipe.title);
        setEditDescription(data.recipe.description || '');
        setEditIngredients([...(data.recipe.ingredients || [])]);
        setEditInstructions([...(data.recipe.instructions || [])]);
        setEditMetadata([...(data.recipe.metadata || [])]);
        setEditSourceUrl(data.recipe.sourceUrl || '');
      }
    } catch (err) {
      toast.error('Could not load recipe: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [recipeId, recipes, authToken]);

  useEffect(() => {
    loadRecipe();
  }, [loadRecipe]);

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
    // Format nicely — avoid floating point issues.
    return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(2).replace(/\.?0+$/, '');
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

  async function handleDelete() {
    if (!recipe) return;
    try {
      await fetch(`/api/recipes/${recipe.id}`, {
        method: 'DELETE',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      removeRecipe(recipe.id);
      toast.success('Recipe deleted.');
      setView({ name: 'box' });
    } catch (err) {
      toast.error('Could not delete: ' + (err as Error).message);
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
        <Button onClick={() => setView({ name: 'box' })}>Back to Recipe Box</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setView({ name: 'box' })} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
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

        {/* Metadata badges */}
        {recipe.metadata && recipe.metadata.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {recipe.metadata.map((m, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs bg-muted rounded-full px-3 py-1">
                {m.key.toLowerCase().includes('time') || m.key.toLowerCase().includes('prep') || m.key.toLowerCase().includes('cook') ? (
                  <Clock className="h-3 w-3" />
                ) : m.key.toLowerCase().includes('serving') ? (
                  <Users className="h-3 w-3" />
                ) : null}
                <span className="font-medium capitalize">{m.key}:</span>
                <span className="text-muted-foreground">{m.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Source link */}
        {recipe.sourceUrl && (
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View original reel
          </a>
        )}
      </div>

      {/* Recipe Scaling */}
      {originalServings > 1 && (
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
      )}

      {/* Ingredients — Checklist */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ChefHat className="h-5 w-5 text-primary" />
              Ingredients
            </CardTitle>
            <EditButton
              isEditing={editing.has('ingredients')}
              onSave={() => saveSection('ingredients')}
              onCancel={() => toggleEdit('ingredients')}
              onEdit={() => toggleEdit('ingredients')}
              saving={saving}
            />
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
                      {(ing.amount || ing.unit) && (
                        <span className="text-muted-foreground ml-2">
                          {scaleAmount(ing.amount)}
                          {ing.unit && ` ${ing.unit}`}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListOrdered className="h-5 w-5 text-primary" />
              Instructions
            </CardTitle>
            <EditButton
              isEditing={editing.has('instructions')}
              onSave={() => saveSection('instructions')}
              onCancel={() => toggleEdit('instructions')}
              onEdit={() => toggleEdit('instructions')}
              saving={saving}
            />
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
            <ol className="space-y-3">
              {recipe.instructions?.map((inst, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold shrink-0">
                    {i + 1}
                  </div>
                  <p className="text-sm leading-relaxed pt-0.5">{inst.step}</p>
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
