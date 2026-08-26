'use client';

import { useState, useEffect, useRef } from 'react';
import { Instagram, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useStore } from '@/lib/store';
import { LoadingStatus } from './loading-status';
import { toast } from 'sonner';
import { runClientPipeline } from '@/lib/client-pipeline';
import type { SavedRecipe } from '@/lib/types';

export function ExtractorView() {
  const { extraction, startExtraction, updateExtraction, resetExtraction, addRecipe, setView } =
    useStore();
  const [url, setUrl] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  const isProcessing = extraction.status === 'processing';
  const showStatus =
    isProcessing ||
    (extraction.status === 'failed' && extraction.logs.length > 0);

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

    try {
      const { recipe, isRecipe } = await runClientPipeline(url.trim(), ({ step, message, progress }) => {
        updateExtraction({ step, message, progress, status: 'processing' });
      });

      // If Gemini determined this is not a recipe, don't save it.
      if (!isRecipe) {
        toast.info('This video doesn\'t appear to be a recipe — not saved.');
        resetExtraction();
        setUrl('');
        return;
      }

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
          ...recipe,
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
      toast.error('Extraction failed');
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
          Turn Instagram Reels
          <br />
          into Recipes
        </h1>
        <p className="text-muted-foreground text-base sm:text-lg max-w-lg mx-auto">
          Paste a link to any food reel. We&apos;ll extract the recipe with ingredients, instructions, and smart scaling.
        </p>
      </div>

      {/* URL Input */}
      <Card>
        <CardContent className="pt-6">
          <form ref={formRef} onSubmit={handleExtract} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                type="url"
                placeholder="https://www.instagram.com/reel/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isProcessing}
                className="flex-1 h-12 text-base"
                aria-label="Instagram reel URL"
              />
              <Button
                type="submit"
                disabled={isProcessing || !url.trim()}
                className="h-12 px-6 gap-2 text-base"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-5 w-5" />
                    Extract
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Loading / Error Status */}
      {showStatus && <LoadingStatus onCancel={() => resetExtraction()} />}

      {/* How it works — only when idle */}
      {!showStatus && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
          {[
            { icon: '📸', title: 'Scrape', desc: 'Get video & caption' },
            { icon: '🎙️', title: 'Transcribe', desc: 'Audio to text' },
            { icon: '🔍', title: 'OCR', desc: 'Read on-screen text' },
            { icon: '🤖', title: 'Generate', desc: 'AI recipe creation' },
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
