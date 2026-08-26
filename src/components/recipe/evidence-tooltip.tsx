'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface EvidenceTooltipProps {
  evidence?: string | null;
  flag?: string | null;
  notes?: string | null;
}

const EVIDENCE_LABELS: Record<string, string> = {
  caption: 'From the Instagram post caption',
  transcript: 'From the audio transcript (Whisper)',
  ocr: 'From on-screen text (OCR)',
  comments: 'From pinned/top comments',
  estimated: 'Estimated by AI (not from source)',
};

export function EvidenceTooltip({ evidence, flag, notes }: EvidenceTooltipProps) {
  const [open, setOpen] = useState(false);

  if (!evidence && !flag && !notes) return null;

  const parts: string[] = [];
  if (evidence && EVIDENCE_LABELS[evidence]) {
    parts.push(EVIDENCE_LABELS[evidence]);
  }
  if (flag === 'estimated_amount' || flag === 'missing_amount') {
    parts.push('⚠️ This quantity was estimated — not specified in the source');
  } else if (flag === 'vague_instruction') {
    parts.push('⚠️ This step was vague in the source — details may be estimated');
  }
  if (notes) {
    parts.push(notes);
  }

  if (parts.length === 0) return null;

  const isEstimate = flag === 'estimated_amount' || flag === 'missing_amount' || flag === 'vague_instruction';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center justify-center rounded-full p-0.5 transition-colors shrink-0 ${
            isEstimate
              ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-500/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
          aria-label="Source info"
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-xs" side="top" align="center">
        <p>{parts.join('. ')}</p>
      </PopoverContent>
    </Popover>
  );
}
