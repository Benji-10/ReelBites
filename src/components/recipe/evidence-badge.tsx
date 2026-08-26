'use client';

import { Badge } from '@/components/ui/badge';

interface EvidenceBadgeProps {
  evidence?: string | null;
}

const EVIDENCE_STYLES: Record<string, { label: string; className: string }> = {
  caption: { label: 'Caption', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  transcript: { label: 'Audio', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  ocr: { label: 'On-screen', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  comments: { label: 'Comments', className: 'bg-green-50 text-green-700 border-green-200' },
};

export function EvidenceBadge({ evidence }: EvidenceBadgeProps) {
  if (!evidence) return null;

  const style = EVIDENCE_STYLES[evidence] || {
    label: evidence,
    className: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <Badge variant="outline" className={`text-xs font-normal ${style.className}`}>
      {style.label}
    </Badge>
  );
}
