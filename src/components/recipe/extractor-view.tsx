'use client';

import { useState, useEffect, useRef } from 'react';
import { Instagram, Globe, Camera, Loader2, Sparkles, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStore } from '@/lib/store';
import { LoadingStatus } from './loading-status';
import { toast } from 'sonner';
import { runClientPipeline } from '@/lib/client-pipeline';
import type { SavedRecipe, GeneratedRecipe } from '@/lib/types';

type ImportMode = 'instagram' | 'web' | 'photo';

export function ExtractorView() {
  const { extraction, startExtraction, updateExtraction, resetExtraction, addRecipe, setView } =
    useStore();
  const [url, setUrl] = useState('');
  const [webUrl, setWebUrl] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('instagram');
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

  async function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      toast.error('Please enter an Instagram reel URL.');
      return;
    }
    startExtraction(url.trim());
  }

  async function handleWebImport() {
    if (!webUrl.trim()) {
      toast.error('Please enter a recipe URL.');
      return;
    }

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
        body: JSON.stringify({ url: webUrl.trim() }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Import failed.' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const { recipe } = (await response.json()) as { recipe: GeneratedRecipe };

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
      setWebUrl('');
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
      // Convert file to base64.
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
          From Instagram reels, food blogs, or photos. We&apos;ll extract the recipe with ingredients, instructions, and smart scaling.
        </p>
      </div>

      {/* Import tabs */}
      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="instagram" onValueChange={(v) => setImportMode(v as ImportMode)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="instagram" className="gap-1.5">
                <Instagram className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Instagram</span>
              </TabsTrigger>
              <TabsTrigger value="web" className="gap-1.5">
                <Globe className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Web</span>
              </TabsTrigger>
              <TabsTrigger value="photo" className="gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Photo</span>
              </TabsTrigger>
            </TabsList>

            {/* Instagram tab */}
            <TabsContent value="instagram" className="space-y-3 mt-4">
              <form ref={formRef} onSubmit={handleExtract} className="space-y-3">
                <Input
                  type="url"
                  placeholder="https://www.instagram.com/reel/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={extraction.status === 'processing'}
                  className="flex-1 h-12 text-base"
                  aria-label="Instagram reel URL"
                />
                <Button
                  type="submit"
                  disabled={extraction.status === 'processing' || !url.trim()}
                  className="h-12 w-full gap-2 text-base"
                >
                  {extraction.status === 'processing' ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5" />
                      Extract Recipe
                    </>
                  )}
                </Button>
              </form>
            </TabsContent>

            {/* Web tab */}
            <TabsContent value="web" className="space-y-3 mt-4">
              <Input
                type="url"
                placeholder="https://www.allrecipes.com/recipe/..."
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
                disabled={isProcessing}
                className="flex-1 h-12 text-base"
                aria-label="Recipe URL"
              />
              <Button
                onClick={handleWebImport}
                disabled={isProcessing || !webUrl.trim()}
                className="h-12 w-full gap-2 text-base"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Globe className="h-5 w-5" />
                    Import from Web
                  </>
                )}
              </Button>
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
                disabled={isProcessing}
                className="h-12 w-full gap-2 text-base"
              >
                {isProcessing ? (
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
      {!showStatus && !isProcessing && (
        <div className="grid grid-cols-3 gap-3 pt-4">
          {[
            { icon: '📸', title: 'Instagram', desc: 'Reel URL' },
            { icon: '🌐', title: 'Web', desc: 'Food blog URL' },
            { icon: '📷', title: 'Photo', desc: 'Screenshot or photo' },
          ].map((item) => (
            <div key={item.title} className="text-center p-3 rounded-lg bg-muted/30">
              <div className="text-2xl mb-1">{item.icon}</div>
              <div className="font-semibold text-sm">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
