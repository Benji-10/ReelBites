'use client';

import { Check, Loader2, X, AlertCircle, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';

interface LoadingStatusProps {
  onCancel: () => void;
}

const STEPS = [
  { key: 'scrape', label: 'Fetching reel', threshold: 5 },
  { key: 'download', label: 'Downloading video', threshold: 22 },
  { key: 'audio', label: 'Extracting audio', threshold: 35 },
  { key: 'whisper', label: 'Transcribing', threshold: 50 },
  { key: 'frames', label: 'Extracting frames', threshold: 62 },
  { key: 'ocr', label: 'Reading text', threshold: 75 },
  { key: 'gemini', label: 'Generating recipe', threshold: 88 },
  { key: 'done', label: 'Complete', threshold: 100 },
];

export function LoadingStatus({ onCancel }: LoadingStatusProps) {
  const { extraction, resetExtraction } = useStore();
  const { progress, step, message, status, error } = extraction;

  const isFailed = status === 'failed';
  const isProcessing = status === 'processing';

  return (
    <Card className={isFailed ? 'border-destructive/40' : ''}>
      <CardContent className="pt-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {isFailed ? (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle className="h-4 w-4 text-destructive" />
              </div>
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            )}
            <div>
              <p className="font-semibold text-sm">
                {isFailed ? 'Extraction failed' : 'Extracting recipe...'}
              </p>
              <p className="text-xs text-muted-foreground">
                {message}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-muted"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1 mb-4">
          {STEPS.filter((s) => s.key !== 'done').map((s, i, arr) => {
            const isComplete = progress > s.threshold;
            const isCurrent = step === s.key && !isFailed;
            const isFailedStep = isFailed && step === s.key;

            return (
              <div key={s.key} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                      isFailedStep
                        ? 'bg-destructive text-white'
                        : isComplete
                          ? 'bg-primary text-primary-foreground'
                          : isCurrent
                            ? 'bg-primary/20 text-primary ring-2 ring-primary'
                            : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isFailedStep ? (
                      <X className="h-3.5 w-3.5" />
                    ) : isComplete ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : isCurrent ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      i + 1
                    )}
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-1 transition-colors ${
                      isComplete ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 mb-3">
            <p className="text-sm text-destructive whitespace-pre-wrap break-words">{error}</p>
          </div>
        )}

        {/* Actions */}
        {isFailed && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              className="gap-1.5"
              onClick={() => {
                const lastUrl = extraction.url;
                resetExtraction();
                if (lastUrl) {
                  window.dispatchEvent(new CustomEvent('retry-extraction', { detail: lastUrl }));
                }
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Try Again
            </Button>
            <Button size="sm" variant="outline" onClick={() => resetExtraction()}>
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
