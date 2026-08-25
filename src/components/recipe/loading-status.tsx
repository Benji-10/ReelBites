'use client';

import { Check, Loader2, X, AlertCircle, RotateCcw, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';

interface LoadingStatusProps {
  onCancel: () => void;
}

const STEPS = [
  { key: 'start', label: 'Initialize', icon: '🚀', threshold: 0 },
  { key: 'scrape', label: 'Scrape Instagram', icon: '📸', threshold: 5 },
  { key: 'download', label: 'Download Video', icon: '⬇️', threshold: 22 },
  { key: 'audio', label: 'Extract Audio', icon: '🎵', threshold: 35 },
  { key: 'whisper', label: 'Transcribe Speech', icon: '🎙️', threshold: 42 },
  { key: 'frames', label: 'Extract Frames', icon: '🎬', threshold: 58 },
  { key: 'ocr', label: 'OCR Text', icon: '🔍', threshold: 65 },
  { key: 'gemini', label: 'Generate Recipe', icon: '🤖', threshold: 82 },
  { key: 'done', label: 'Complete', icon: '✅', threshold: 100 },
];

export function LoadingStatus({ onCancel }: LoadingStatusProps) {
  const { extraction, resetExtraction } = useStore();
  const { progress, step, message, logs, status, error } = extraction;

  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';

  return (
    <Card className={isFailed ? 'border-destructive/40' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            {isFailed ? (
              <>
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Extraction Failed
              </>
            ) : isCompleted ? (
              <>
                <Check className="h-5 w-5 text-primary" />
                Extraction Complete
              </>
            ) : (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Extracting Recipe...
              </>
            )}
          </CardTitle>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
            aria-label={isFailed ? 'Dismiss' : 'Cancel extraction'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className={`font-medium ${isFailed ? 'text-destructive' : ''}`}>
              {message}
            </span>
            <span className="text-muted-foreground tabular-nums">{progress}%</span>
          </div>
          <Progress
            value={progress}
            className={`h-2.5 ${isFailed ? '[&>div]:bg-destructive' : ''}`}
          />
        </div>

        {/* Steps */}
        <div className="space-y-1.5">
          {STEPS.map((s) => {
            const isComplete = progress > s.threshold && s.key !== step;
            const isCurrent = step === s.key && progress < 100;
            const isFailedStep = isFailed && step === s.key;

            return (
              <div
                key={s.key}
                className={`flex items-center gap-3 py-1.5 px-2 rounded-md transition-colors ${
                  isCurrent ? 'bg-accent/50' : ''
                } ${isFailedStep ? 'bg-destructive/10' : ''}`}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full shrink-0 text-sm">
                  {isFailedStep ? (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-white">
                      <X className="h-4 w-4" />
                    </div>
                  ) : isComplete ? (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-4 w-4" />
                    </div>
                  ) : isCurrent ? (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs">
                      {s.icon}
                    </div>
                  )}
                </div>
                <span
                  className={`text-sm flex-1 ${
                    isFailedStep
                      ? 'text-destructive font-semibold'
                      : isComplete
                        ? 'text-muted-foreground line-through decoration-muted'
                        : isCurrent
                          ? 'font-semibold text-foreground'
                          : 'text-muted-foreground'
                  }`}
                >
                  {s.label}
                </span>
                {isCurrent && !isFailed && (
                  <Badge variant="outline" className="text-xs">
                    In progress
                  </Badge>
                )}
                {isFailedStep && (
                  <Badge variant="destructive" className="text-xs">
                    Failed here
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        {/* Live log — always visible when there are logs */}
        {logs.length > 0 && (
          <div className="rounded-md bg-muted/50 border border-border p-3 max-h-60 overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Live Log ({logs.length} {logs.length === 1 ? 'entry' : 'entries'})
              </span>
            </div>
            <div className="text-xs font-mono text-muted-foreground space-y-0.5">
              {logs.slice(-20).map((log, i) => (
                <div key={i} className="flex gap-2 leading-relaxed">
                  <span className="text-primary/60 shrink-0">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>
                  <span className="break-all">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold mb-1">Error details:</p>
                <p className="whitespace-pre-wrap break-words text-destructive/90">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons on failure */}
        {isFailed && (
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                // Reset and let the user try again with the same URL.
                const lastUrl = extraction.url;
                resetExtraction();
                // The URL is in the input field, so the user just clicks Extract again.
                if (lastUrl) {
                  // Trigger a re-extraction by dispatching a custom event.
                  window.dispatchEvent(
                    new CustomEvent('retry-extraction', { detail: lastUrl }),
                  );
                }
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Try Again
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => resetExtraction()}
            >
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
