'use client';

import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface EvidenceTooltipProps {
  evidence?: string | null;
  flag?: string | null;
  notes?: string | null;
}

const EVIDENCE_LABELS: Record<string, string> = {
  caption: 'Extracted from the Instagram post caption',
  transcript: 'Extracted from the audio transcript (Whisper)',
  ocr: 'Extracted from on-screen text (OCR)',
  comments: 'Extracted from pinned/top comments',
};

export function EvidenceTooltip({ evidence, flag, notes }: EvidenceTooltipProps) {
  // Only show tooltip if there's something to explain.
  if (!evidence && !flag && !notes) return null;

  const parts: string[] = [];
  if (evidence && EVIDENCE_LABELS[evidence]) {
    parts.push(EVIDENCE_LABELS[evidence]);
  }
  if (flag === 'missing_amount') {
    parts.push('⚠️ The amount was not specified in the source — this is an estimate');
  } else if (flag === 'vague_instruction') {
    parts.push('⚠️ This step was vague in the source — details may be estimated');
  }
  if (notes) {
    parts.push(notes);
  }

  if (parts.length === 0) return null;

  const isGuess = flag === 'missing_amount' || flag === 'vague_instruction';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={`inline-flex items-center justify-center rounded-full p-0.5 transition-colors ${
              isGuess
                ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-500/10'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            aria-label="Source info"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          <p>{parts.join('. ')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
