'use client';

import { Check, Loader2, X, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
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
  const { extraction } = useStore();
  const { progress, step, message, logs } = extraction;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Extracting Recipe...
          </CardTitle>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
            aria-label="Cancel extraction"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{message}</span>
            <span className="text-muted-foreground tabular-nums">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2.5" />
        </div>

        {/* Steps */}
        <div className="space-y-1.5">
          {STEPS.map((s) => {
            const isComplete = progress > s.threshold && s.key !== step;
            const isCurrent = step === s.key && progress < 100;
            const isPending = progress < s.threshold;

            return (
              <div
                key={s.key}
                className={`flex items-center gap-3 py-1.5 px-2 rounded-md transition-colors ${
                  isCurrent ? 'bg-accent/50' : ''
                }`}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full shrink-0 text-sm">
                  {isComplete ? (
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
                    isComplete
                      ? 'text-muted-foreground line-through decoration-muted'
                      : isCurrent
                        ? 'font-semibold text-foreground'
                        : 'text-muted-foreground'
                  }`}
                >
                  {s.label}
                </span>
                {isCurrent && (
                  <Badge variant="outline" className="text-xs">
                    In progress
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        {/* Live log */}
        {logs.length > 1 && (
          <div className="rounded-md bg-muted/50 border border-border p-3 max-h-40 overflow-y-auto custom-scrollbar">
            <p className="text-xs font-mono text-muted-foreground space-y-0.5">
              {logs.slice(-8).map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-primary/60 shrink-0">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>
                  <span>{log.message}</span>
                </div>
              ))}
            </p>
          </div>
        )}

        {/* Error */}
        {extraction.error && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{extraction.error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
