'use client';

import { useState, useEffect, useRef } from 'react';
import { Instagram, Globe, Camera, Loader2, Sparkles, Upload, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStore } from '@/lib/store';
import { LoadingStatus } from './loading-status';
import { toast } from 'sonner';
import { runClientPipeline } from '@/lib/client-pipeline';
import type { SavedRecipe, GeneratedRecipe } from '@/lib/types';

export function ExtractorView() {
  const { extraction, startExtraction, updateExtraction, resetExtraction, addRecipe, setView } =
    useStore();
  const [url, setUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showStatus =
    extraction.status === 'processing' ||
    (extraction.status === 'failed' && extraction.logs.length > 0);

  useEffect(() => {
    if (extraction.url && extraction.status === 'processing' && !url) {
      const pendingUrl = extraction.url;
      requestAnimationFrame(() => {
        setUrl(pendingUrl);
        setTimeout(() => {
          if (formRef.current) {
            formRef.current.requestSubmit();
          }
        }, 300);
      });
    }
  }, [extraction.url, extraction.status]);

  useEffect(() => {
    const handleRetry = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) {
        setUrl(detail);
        resetExtraction();
        setTimeout(() => {
          if (formRef.current) {
            formRef.current.requestSubmit();
          }
        }, 100);
      }
    };
    window.addEventListener('retry-extraction', handleRetry);
    return () => window.removeEventListener('retry-extraction', handleRetry);
  }, [resetExtraction]);

  // Detect if a URL is an Instagram link.
  function isInstagramUrl(u: string): boolean {
    try {
      const parsed = new URL(u);
      return parsed.hostname.includes('instagram.com');
    } catch {
      return false;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      toast.error('Please enter a URL.');
      return;
    }

    const trimmedUrl = url.trim();

    if (isInstagramUrl(trimmedUrl)) {
      // Instagram — run the full client pipeline.
      await handleInstagramExtract(trimmedUrl);
    } else {
      // Web page — use the import-web API.
      await handleWebImport(trimmedUrl);
    }
  }

  async function handleInstagramExtract(instagramUrl: string) {
    startExtraction(instagramUrl);

    try {
      const { recipe, isRecipe } = await runClientPipeline(instagramUrl, ({ step, message, progress }) => {
        updateExtraction({ step, message, progress, status: 'processing' });
      });

      // If Gemini determined this is not a recipe, don't save it.
      if (!isRecipe) {
        toast.info('This video doesn\'t appear to be a recipe — not saved.');
        resetExtraction();
        setUrl('');
        return;
      }

      // Save to database.
      const saveResponse = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: recipe.title,
          description: recipe.description,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          metadata: recipe.metadata,
          flags: recipe.flags,
          sourceUrl: recipe.sourceUrl,
          sourceCaption: recipe.sourceCaption,
          sourceComments: recipe.sourceComments,
          transcript: recipe.transcript,
          ocrText: recipe.ocrText,
          imageUrl: recipe.imageUrl,
          sourceVideoUrl: recipe.sourceVideoUrl,
          isFavorite: false,
          tags: recipe.tags || [],
          collection: null,
        }),
      });

      let savedRecipe: SavedRecipe;
      if (saveResponse.ok) {
        const saveData = await saveResponse.json();
        savedRecipe = {
          id: saveData.recipe.id,
          title: recipe.title,
          description: recipe.description,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          metadata: recipe.metadata,
          flags: recipe.flags,
          sourceUrl: recipe.sourceUrl,
          sourceCaption: recipe.sourceCaption,
          sourceComments: recipe.sourceComments,
          transcript: recipe.transcript,
          ocrText: recipe.ocrText,
          imageUrl: recipe.imageUrl,
          sourceVideoUrl: recipe.sourceVideoUrl,
          isFavorite: false,
          tags: recipe.tags || [],
          collection: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } else {
        const errData = await saveResponse.json().catch(() => ({}));
        toast.error('Could not save recipe: ' + (errData.error || 'Database error'));
        savedRecipe = {
          id: 'temp-' + Date.now(),
          title: recipe.title,
          description: recipe.description,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          metadata: recipe.metadata,
          flags: recipe.flags,
          sourceUrl: recipe.sourceUrl,
          sourceCaption: recipe.sourceCaption,
          sourceComments: recipe.sourceComments,
          transcript: recipe.transcript,
          ocrText: recipe.ocrText,
          imageUrl: recipe.imageUrl,
          sourceVideoUrl: recipe.sourceVideoUrl,
          isFavorite: false,
          tags: recipe.tags || [],
          collection: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      addRecipe(savedRecipe);
      toast.success('Recipe extracted successfully!');
      setView({ name: 'detail', recipeId: savedRecipe.id });
      resetExtraction();
      setUrl('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      updateExtraction({ status: 'failed', error: message });
      toast.error('Extraction failed: ' + message);
    }
  }

  async function handleWebImport(webUrl: string) {
    setIsProcessing(true);
    updateExtraction({
      step: 'web',
      message: 'Importing recipe from web...',
      progress: 10,
      status: 'processing',
    });

    try {
      const response = await fetch('/api/import-web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webUrl }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Import failed.' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const { recipe } = (await response.json()) as { recipe: GeneratedRecipe };

      const saveResponse = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: recipe.title,
          description: recipe.description,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          metadata: recipe.metadata,
          flags: recipe.flags,
          sourceUrl: recipe.sourceUrl,
          sourceCaption: recipe.sourceCaption,
          sourceComments: recipe.sourceComments,
          transcript: recipe.transcript,
          ocrText: recipe.ocrText,
          imageUrl: recipe.imageUrl,
          sourceVideoUrl: recipe.sourceVideoUrl,
          isFavorite: false,
          tags: recipe.tags || [],
          collection: null,
        }),
      });

      let savedRecipe: SavedRecipe;
      if (saveResponse.ok) {
        const saveData = await saveResponse.json();
        savedRecipe = {
          id: saveData.recipe.id,
          ...recipe,
          isFavorite: false,
          tags: recipe.tags || [],
          collection: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as SavedRecipe;
      } else {
        savedRecipe = {
          id: 'temp-' + Date.now(),
          ...recipe,
          isFavorite: false,
          tags: recipe.tags || [],
          collection: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as SavedRecipe;
      }

      addRecipe(savedRecipe);
      toast.success('Recipe imported successfully!');
      setView({ name: 'detail', recipeId: savedRecipe.id });
      resetExtraction();
      setUrl('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      updateExtraction({ status: 'failed', error: message });
      toast.error('Import failed: ' + message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handlePhotoUpload(file: File) {
    setIsProcessing(true);
    updateExtraction({
      step: 'photo',
      message: 'Analyzing photo with Gemini Vision...',
      progress: 20,
      status: 'processing',
    });

    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      updateExtraction({ step: 'photo', message: 'Extracting recipe from image...', progress: 50 });

      const response = await fetch('/api/import-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Import failed.' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const { recipe } = (await response.json()) as { recipe: GeneratedRecipe };

      const saveResponse = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: recipe.title,
          description: recipe.description,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          metadata: recipe.metadata,
          flags: recipe.flags,
          sourceUrl: recipe.sourceUrl,
          sourceCaption: recipe.sourceCaption,
          sourceComments: recipe.sourceComments,
          transcript: recipe.transcript,
          ocrText: recipe.ocrText,
          imageUrl: recipe.imageUrl,
          sourceVideoUrl: recipe.sourceVideoUrl,
          isFavorite: false,
          tags: recipe.tags || [],
          collection: null,
        }),
      });

      let savedRecipe: SavedRecipe;
      if (saveResponse.ok) {
        const saveData = await saveResponse.json();
        savedRecipe = {
          id: saveData.recipe.id,
          ...recipe,
          isFavorite: false,
          tags: recipe.tags || [],
          collection: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as SavedRecipe;
      } else {
        savedRecipe = {
          id: 'temp-' + Date.now(),
          ...recipe,
          isFavorite: false,
          tags: recipe.tags || [],
          collection: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as SavedRecipe;
      }

      addRecipe(savedRecipe);
      toast.success('Recipe imported from photo!');
      setView({ name: 'detail', recipeId: savedRecipe.id });
      resetExtraction();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      updateExtraction({ status: 'failed', error: message });
      toast.error('Import failed: ' + message);
    } finally {
      setIsProcessing(false);
    }
  }

  const busy = extraction.status === 'processing' || isProcessing;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Hero */}
      <div className="text-center space-y-4 py-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          AI-Powered Recipe Extraction
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Import Recipes
        </h1>
        <p className="text-muted-foreground text-base sm:text-lg max-w-lg mx-auto">
          Paste an Instagram reel or recipe blog URL, or upload a photo. We&apos;ll extract the recipe with ingredients, instructions, and smart scaling.
        </p>
      </div>

      {/* Import tabs */}
      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="link">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="link" className="gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                <span>Link</span>
              </TabsTrigger>
              <TabsTrigger value="photo" className="gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                <span>Photo</span>
              </TabsTrigger>
            </TabsList>

            {/* Link tab — handles both Instagram and web URLs */}
            <TabsContent value="link" className="space-y-3 mt-4">
              <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
                <Input
                  type="url"
                  placeholder="Instagram reel or recipe blog URL..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={busy}
                  className="flex-1 h-12 text-base"
                  aria-label="Recipe URL"
                />
                <Button
                  type="submit"
                  disabled={busy || !url.trim()}
                  className="h-12 w-full gap-2 text-base"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      {isInstagramUrl(url) ? 'Extracting...' : 'Importing...'}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5" />
                      Extract Recipe
                    </>
                  )}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground text-center">
                Works with Instagram reels, AllRecipes, BBC Good Food, food blogs, and more.
              </p>
            </TabsContent>

            {/* Photo tab */}
            <TabsContent value="photo" className="space-y-3 mt-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePhotoUpload(file);
                }}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="h-12 w-full gap-2 text-base"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5" />
                    Upload Recipe Photo
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Screenshot a recipe, photograph a recipe card, or upload any image with recipe text.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Loading / Error Status */}
      {showStatus && <LoadingStatus onCancel={() => resetExtraction()} />}

      {/* How it works */}
      {!showStatus && !busy && (
        <div className="grid grid-cols-2 gap-3 pt-4">
          <div className="text-center p-3 rounded-lg bg-muted/30">
            <div className="text-2xl mb-1">🔗</div>
            <div className="font-semibold text-sm">Link Import</div>
            <div className="text-xs text-muted-foreground">Instagram reels & recipe blogs</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/30">
            <div className="text-2xl mb-1">📷</div>
            <div className="font-semibold text-sm">Photo Import</div>
            <div className="text-xs text-muted-foreground">Screenshots & recipe cards</div>
          </div>
        </div>
      )}
    </div>
  );
}
