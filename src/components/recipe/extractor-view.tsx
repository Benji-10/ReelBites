'use client';

import { useState, useEffect, useRef } from 'react';
import { Instagram, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useStore } from '@/lib/store';
import { LoadingStatus } from './loading-status';
import { toast } from 'sonner';
import { runClientPipeline } from '@/lib/client-pipeline';
import type { SavedRecipe } from '@/lib/types';

export function ExtractorView() {
  const { extraction, startExtraction, updateExtraction, resetExtraction, addRecipe, setView } =
    useStore();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const isProcessing = extraction.status === 'processing';
  const showStatus =
    isProcessing ||
    (extraction.status === 'failed' && extraction.logs.length > 0) ||
    (extraction.status === 'completed' && extraction.logs.length > 0);

  // Listen for retry events.
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

    setError(null);
    startExtraction(url.trim());

    try {
      const { recipe } = await runClientPipeline(url.trim(), ({ step, message, progress }) => {
        updateExtraction({ step, message, progress, status: 'processing' });
      });

      // Save the recipe to the database via the API.
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } else {
        // If save fails, still show the recipe with a temporary ID.
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        toast.warning('Recipe extracted but could not save to database.');
      }

      addRecipe(savedRecipe);
      toast.success('Recipe extracted successfully!');
      setView({ name: 'detail', recipeId: savedRecipe.id });
      resetExtraction();
      setUrl('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      setError(message);
      updateExtraction({ status: 'failed', error: message });
      toast.error('Extraction failed: ' + message);
    }
  }

  function handleCancel() {
    resetExtraction();
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center space-y-3 py-4 sm:py-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent text-accent-foreground text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5" />
          AI-Powered Recipe Extraction
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Turn Instagram Reels into Recipes
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base">
          Paste a link to any Instagram food reel. We&apos;ll grab the video, transcribe the audio,
          OCR the on-screen text, and use AI to generate a structured recipe — with evidence-backed
          flags for any missing info.
        </p>
        <p className="text-xs text-muted-foreground/70 max-w-xl mx-auto">
          Processing happens in your browser (ffmpeg.wasm + Tesseract.js) to keep the app fast and free.
          The first run downloads ~30MB of WebAssembly modules (cached afterward).
        </p>
      </div>

      {/* URL Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Instagram className="h-5 w-5 text-primary" />
            Instagram Reel URL
          </CardTitle>
          <CardDescription>
            Paste the full URL of the Instagram reel you want to extract a recipe from.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={formRef} onSubmit={handleExtract} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                type="url"
                placeholder="https://www.instagram.com/reel/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isProcessing}
                className="flex-1 h-11"
                aria-label="Instagram reel URL"
              />
              <Button
                type="submit"
                disabled={isProcessing || !url.trim()}
                className="h-11 px-6 gap-2"
                size="lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Extract Recipe
                  </>
                )}
              </Button>
            </div>

            {error && !isProcessing && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Loading Status — stays visible on processing AND failed states */}
      {showStatus && <LoadingStatus onCancel={handleCancel} />}

      {/* How it works — only show when idle */}
      {!showStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">How it works</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { step: '1', title: 'Scrape', desc: 'Apify grabs the video, caption & comments' },
                { step: '2', title: 'Transcribe', desc: 'Whisper turns the audio into text' },
                { step: '3', title: 'OCR', desc: 'Tesseract reads on-screen text from frames' },
                { step: '4', title: 'Generate', desc: 'Gemini builds a recipe with evidence' },
              ].map((item) => (
                <div key={item.step} className="space-y-1.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                    {item.step}
                  </div>
                  <h3 className="font-semibold text-sm">{item.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
