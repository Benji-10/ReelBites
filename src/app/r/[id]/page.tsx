'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Trash2, Save, X, Plus, Pencil, ExternalLink,
  ChefHat, ListOrdered, Clock, Users, Minus, ChevronRight, Maximize2, Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { EvidenceTooltip } from '@/components/recipe/evidence-tooltip';
import { CookingMode } from '@/components/recipe/cooking-mode';
import { IngredientLink } from '@/components/recipe/ingredient-link';
import { useSettings } from '@/lib/settings';
import { toast } from 'sonner';
import type { SavedRecipe, RecipeIngredient } from '@/lib/types';

interface PublicRecipe {
  id: string;
  title: string;
  description: string | null;
  ingredients: RecipeIngredient[];
  instructions: { step: string; evidence?: string | null; flag?: string | null; ingredientRefs?: number[] }[];
  metadata: { key: string; value: string; evidence?: string | null; flag?: string | null }[];
  flags: { type: string; message: string; field?: string; severity: string }[];
  sourceUrl: string | null;
  imageUrl: string | null;
  tags: string[] | null;
  createdAt: string;
}

export default function PublicRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const [recipe, setRecipe] = useState<PublicRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [scaleFactor, setScaleFactor] = useState(1);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());
  const [cookingMode, setCookingMode] = useState(false);
  const router = useRouter();

  const { smallLiquid, largeLiquid, weight, dry, temperature } = useSettings();

  useEffect(() => {
    params.then(async (p) => {
      try {
        const res = await fetch(`/api/recipes/${p.id}/public`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        setRecipe(data.recipe);
      } catch {
        toast.error('Recipe not found.');
      } finally {
        setLoading(false);
      }
    });
  }, [params]);

  function scaleAmount(amount: string | null | undefined): string {
    if (!amount) return '';
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    const scaled = num * scaleFactor;
    return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(2).replace(/\.?0+$/, '');
  }

  function getDisplayAmount(ing: RecipeIngredient): { amount: string; unit: string } {
    const scaled = scaleAmount(ing.amount);
    const converted = convertUnit(scaled, ing.unit);
    return converted;
  }

  function convertUnit(amount: string, unit: string | null | undefined): { amount: string; unit: string } {
    if (!amount || !unit) return { amount, unit: unit || '' };
    // Simplified conversion for public view.
    return { amount, unit };
  }

  const servingsMeta = recipe?.metadata?.find((m) => m.key.toLowerCase() === 'servings');
  const originalServings = servingsMeta ? parseInt(servingsMeta.value, 10) || 4 : 4;
  const currentServings = Math.round(originalServings * scaleFactor);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!recipe) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-muted-foreground">Recipe not found.</p>
        <Button onClick={() => router.push('/')}>Go Home</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Back button */}
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{recipe.title}</h1>
          {recipe.description && <p className="text-muted-foreground leading-relaxed">{recipe.description}</p>}
          {recipe.tags && recipe.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {recipe.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
            </div>
          )}
          {recipe.sourceUrl && (
            <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              <ExternalLink className="h-3.5 w-3.5" />
              {recipe.sourceUrl.includes('instagram.com') ? 'View original reel' : 'View website'}
            </a>
          )}
        </div>

        {/* Metadata */}
        {recipe.metadata && recipe.metadata.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {recipe.metadata.filter(m => !['servings'].includes(m.key.toLowerCase())).map((m, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30">
                <Clock className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground capitalize">{m.key.replace(/([A-Z])/g, ' $1').trim()}</p>
                  <p className="text-sm font-medium truncate">{m.value}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Servings */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Servings</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setScaleFactor((f) => Math.max(0.5, f - 0.5))} disabled={scaleFactor <= 0.5}>
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="font-semibold tabular-nums w-12 text-center">{currentServings}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setScaleFactor((f) => f + 0.5)}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                {scaleFactor !== 1 && <Button variant="ghost" size="sm" className="text-xs" onClick={() => setScaleFactor(1)}>Reset</Button>}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Ingredients */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ChefHat className="h-5 w-5 text-primary" />
              Ingredients
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {recipe.ingredients?.map((ing, i) => {
                const isChecked = checkedIngredients.has(i);
                const display = getDisplayAmount(ing);
                return (
                  <label key={i} className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/50 cursor-pointer">
                    <Checkbox checked={isChecked} onCheckedChange={() => {
                      const next = new Set(checkedIngredients);
                      if (next.has(i)) next.delete(i); else next.add(i);
                      setCheckedIngredients(next);
                    }} />
                    <span className={`flex-1 text-sm ${isChecked ? 'line-through text-muted-foreground' : ''}`}>
                      <span className="font-medium">{ing.name}</span>
                      {(display.amount || display.unit) && <span className="text-muted-foreground ml-2">{display.amount}{display.unit && ` ${display.unit}`}</span>}
                    </span>
                    <EvidenceTooltip evidence={ing.evidence} flag={ing.flag} ingredientEstimated={ing.flag === 'estimated_ingredient'} />
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ListOrdered className="h-5 w-5 text-primary" />
                Instructions
              </CardTitle>
              {recipe.instructions && recipe.instructions.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCookingMode(true)} className="gap-1.5">
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Cooking Mode</span>
                  <span className="sm:hidden">Cook</span>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ol className="space-y-5">
              {recipe.instructions?.map((inst, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm leading-relaxed">{inst.step}</p>
                    <IngredientLink ingredientRefs={inst.ingredientRefs} ingredients={recipe.ingredients || []} scaleAmount={scaleAmount} />
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* Cooking mode */}
        {cookingMode && recipe.instructions && (
          <CookingMode
            instructions={recipe.instructions}
            ingredients={recipe.ingredients || []}
            title={recipe.title}
            onClose={() => setCookingMode(false)}
            scaleAmount={scaleAmount}
          />
        )}

        {/* Share */}
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground mb-2">This recipe is public. Anyone with the link can view it.</p>
            <Input readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}/r/${recipe.id}`} className="text-xs font-mono" onClick={(e) => (e.target as HTMLInputElement).select()} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
