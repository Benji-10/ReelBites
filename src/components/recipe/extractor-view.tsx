'use client';

import { useState } from 'react';
import { Instagram, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useStore } from '@/lib/store';
import { LoadingStatus } from './loading-status';
import { toast } from 'sonner';

export function ExtractorView() {
  const { extraction, startExtraction, updateExtraction, resetExtraction, addRecipe, setView } =
    useStore();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isProcessing = extraction.status === 'processing';

  async function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      toast.error('Please enter an Instagram reel URL.');
      return;
    }

    setError(null);
    startExtraction(url.trim());

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Request failed.' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body received from the server.');
      }

      // Read the SSE stream.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (separated by \n\n).
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          const dataLine = event
            .split('\n')
            .find((line) => line.startsWith('data: '));
          if (!dataLine) continue;

          const jsonStr = dataLine.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            updateExtraction({
              step: data.step,
              message: data.message,
              progress: data.progress,
              status: data.status,
              error: data.error,
              recipe: data.recipe,
            });

            if (data.status === 'completed' && data.recipe) {
              addRecipe(data.recipe);
              toast.success('Recipe extracted successfully!');
              // Navigate to the recipe detail.
              setView({ name: 'detail', recipeId: data.recipe.id });
              resetExtraction();
              setUrl('');
            } else if (data.status === 'failed') {
              throw new Error(data.error || data.message || 'Extraction failed.');
            }
          } catch (parseErr) {
            console.warn('Failed to parse SSE event:', jsonStr, parseErr);
          }
        }
      }
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
          <form onSubmit={handleExtract} className="space-y-4">
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

      {/* Loading Status */}
      {isProcessing && <LoadingStatus onCancel={handleCancel} />}

      {/* How it works */}
      {!isProcessing && (
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
