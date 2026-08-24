'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Trash2,
  Save,
  X,
  Plus,
  Pencil,
  ExternalLink,
  ChefHat,
  ListOrdered,
  Clock,
  Loader2,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { EvidenceBadge } from './evidence-badge';
import { FlagList } from './flag-list';

export function RecipeDetail() {
  const { view, recipes, updateRecipe, removeRecipe, setView, authToken } = useStore();
  const recipeId = view.name === 'detail' ? view.recipeId : null;

  const [recipe, setRecipe] = useState<SavedRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edit state — which sections are being edited.
  const [editing, setEditing] = useState<Set<string>>(new Set());

  // Editable copies of the data.
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIngredients, setEditIngredients] = useState<RecipeIngredient[]>([]);
  const [editInstructions, setEditInstructions] = useState<RecipeInstruction[]>([]);
  const [editMetadata, setEditMetadata] = useState<RecipeMetadata[]>([]);
  const [editSourceUrl, setEditSourceUrl] = useState('');

  // Load recipe from store or API.
  const loadRecipe = useCallback(async () => {
    if (!recipeId) return;
    setLoading(true);

    // First check the store.
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

    // Otherwise fetch from API.
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

  function toggleEdit(section: string) {
    const next = new Set(editing);
    if (next.has(section)) {
      next.delete(section);
      // Reset the edit state for this section.
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
      const response = await fetch(`/api/recipes/${recipe.id}`, {
        method: 'DELETE',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (!response.ok) throw new Error('Failed to delete.');
      removeRecipe(recipe.id);
      toast.success('Recipe deleted.');
      setView({ name: 'box' });
    } catch (err) {
      toast.error('Could not delete: ' + (err as Error).message);
    }
  }

  // Ingredient editing helpers.
  function updateIngredient(index: number, field: keyof RecipeIngredient, value: string) {
    const next = [...editIngredients];
    next[index] = { ...next[index], [field]: value || null };
    setEditIngredients(next);
  }
  function addIngredient() {
    setEditIngredients([
      ...editIngredients,
      { name: '', amount: null, unit: null, notes: null, evidence: null, flag: null },
    ]);
  }
  function removeIngredient(index: number) {
    setEditIngredients(editIngredients.filter((_, i) => i !== index));
  }

  // Instruction editing helpers.
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

  // Metadata editing helpers.
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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" onClick={() => setView({ name: 'box' })} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this recipe?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The recipe &ldquo;{recipe.title}&rdquo; will be
                permanently removed from your recipe box.
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
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              {editing.has('title') ? (
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-2xl font-bold h-auto py-2"
                />
              ) : (
                <CardTitle className="text-2xl sm:text-3xl">{recipe.title}</CardTitle>
              )}
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {recipe.ingredients?.length || 0} ingredients
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {recipe.instructions?.length || 0} steps
                </Badge>
                {recipe.flags?.length > 0 && (
                  <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">
                    {recipe.flags.length} flags
                  </Badge>
                )}
              </div>
            </div>
            <EditButton
              isEditing={editing.has('title')}
              onSave={() => saveSection('title')}
              onCancel={() => toggleEdit('title')}
              onEdit={() => toggleEdit('title')}
              saving={saving}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Description */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Description</span>
              <EditButton
                isEditing={editing.has('description')}
                onSave={() => saveSection('description')}
                onCancel={() => toggleEdit('description')}
                onEdit={() => toggleEdit('description')}
                saving={saving}
                small
              />
            </div>
            {editing.has('description') ? (
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                placeholder="Add a description..."
              />
            ) : (
              <p className="text-sm text-foreground leading-relaxed">
                {recipe.description || (
                  <span className="text-muted-foreground italic">No description.</span>
                )}
              </p>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Details
              </span>
              <EditButton
                isEditing={editing.has('metadata')}
                onSave={() => saveSection('metadata')}
                onCancel={() => toggleEdit('metadata')}
                onEdit={() => toggleEdit('metadata')}
                saving={saving}
                small
              />
            </div>
            {editing.has('metadata') ? (
              <div className="space-y-2">
                {editMetadata.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input
                      value={m.key}
                      onChange={(e) => updateMetadata(i, 'key', e.target.value)}
                      placeholder="Key (e.g. servings)"
                      className="flex-1 h-8 text-sm"
                    />
                    <Input
                      value={m.value}
                      onChange={(e) => updateMetadata(i, 'value', e.target.value)}
                      placeholder="Value (e.g. 4)"
                      className="flex-1 h-8 text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeMetadata(i)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addMetadata} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Add detail
                </Button>
              </div>
            ) : recipe.metadata?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {recipe.metadata.map((m, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-sm bg-muted/50 rounded-md px-2.5 py-1">
                    <span className="font-medium capitalize">{m.key}:</span>
                    <span className="text-muted-foreground">{m.value}</span>
                    <EvidenceBadge evidence={m.evidence} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No additional details.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Ingredients */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
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
                <div key={i} className="flex flex-wrap gap-2 items-start p-2 rounded-md border border-border/60">
                  <Input
                    value={ing.name}
                    onChange={(e) => updateIngredient(i, 'name', e.target.value)}
                    placeholder="Ingredient name"
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
                  <Input
                    value={ing.notes || ''}
                    onChange={(e) => updateIngredient(i, 'notes', e.target.value)}
                    placeholder="Notes (optional)"
                    className="flex-1 min-w-[120px] h-8 text-sm"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removeIngredient(i)}
                  >
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
            <ul className="space-y-2">
              {recipe.ingredients?.map((ing, i) => (
                <li key={i} className="flex items-start gap-3 group">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium">{ing.name}</span>
                      {(ing.amount || ing.unit) && (
                        <span className="text-sm text-muted-foreground">
                          {ing.amount || '?'}
                          {ing.unit && ` ${ing.unit}`}
                        </span>
                      )}
                      <EvidenceBadge evidence={ing.evidence} />
                    </div>
                    {ing.notes && (
                      <p className="text-xs text-muted-foreground">{ing.notes}</p>
                    )}
                  </div>
                </li>
              )) || (
                <li className="text-sm text-muted-foreground italic">No ingredients listed.</li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
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
                    placeholder="Describe this step..."
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removeInstruction(i)}
                  >
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
                  <div className="flex-1 space-y-1">
                    <p className="text-sm leading-relaxed">{inst.step}</p>
                    <EvidenceBadge evidence={inst.evidence} />
                  </div>
                </li>
              )) || (
                <li className="text-sm text-muted-foreground italic">No instructions provided.</li>
              )}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Source */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ExternalLink className="h-5 w-5 text-primary" />
              Source
            </CardTitle>
            <EditButton
              isEditing={editing.has('source')}
              onSave={() => saveSection('source')}
              onCancel={() => toggleEdit('source')}
              onEdit={() => toggleEdit('source')}
              saving={saving}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {editing.has('source') ? (
            <Input
              value={editSourceUrl}
              onChange={(e) => setEditSourceUrl(e.target.value)}
              placeholder="https://www.instagram.com/reel/..."
            />
          ) : recipe.sourceUrl ? (
            <a
              href={recipe.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline break-all"
            >
              {recipe.sourceUrl}
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : (
            <p className="text-sm text-muted-foreground italic">No source URL.</p>
          )}

          {/* Show raw source data in a collapsible section */}
          {(recipe.sourceCaption || recipe.transcript || recipe.ocrText) && (
            <details className="mt-4 group">
              <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" />
                View raw source data (caption, transcript, OCR)
              </summary>
              <div className="mt-3 space-y-3 text-xs">
                {recipe.sourceCaption && (
                  <div>
                    <p className="font-semibold mb-1">Caption:</p>
                    <p className="text-muted-foreground whitespace-pre-wrap bg-muted/30 p-2 rounded-md">
                      {recipe.sourceCaption}
                    </p>
                  </div>
                )}
                {recipe.transcript && (
                  <div>
                    <p className="font-semibold mb-1">Audio Transcript:</p>
                    <p className="text-muted-foreground whitespace-pre-wrap bg-muted/30 p-2 rounded-md">
                      {recipe.transcript}
                    </p>
                  </div>
                )}
                {recipe.ocrText && (
                  <div>
                    <p className="font-semibold mb-1">OCR Text:</p>
                    <p className="text-muted-foreground whitespace-pre-wrap bg-muted/30 p-2 rounded-md max-h-48 overflow-y-auto custom-scrollbar">
                      {recipe.ocrText}
                    </p>
                  </div>
                )}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Flags */}
      {recipe.flags && recipe.flags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Evidence &amp; Flags</CardTitle>
          </CardHeader>
          <CardContent>
            <FlagList flags={recipe.flags} />
          </CardContent>
        </Card>
      )}

      <Separator />
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
        <Button
          size={small ? 'sm' : 'default'}
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
          className="h-8"
        >
          <X className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Cancel</span>
        </Button>
        <Button
          size={small ? 'sm' : 'default'}
          onClick={onSave}
          disabled={saving}
          className="h-8 gap-1.5"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">Save</span>
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
      <span className="hidden sm:inline">Edit</span>
    </Button>
  );
}
