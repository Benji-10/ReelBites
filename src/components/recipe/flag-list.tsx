'use client';

import { AlertTriangle, Info, XCircle, Lightbulb } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { RecipeFlag } from '@/lib/types';

interface FlagListProps {
  flags: RecipeFlag[];
}

const SEVERITY_CONFIG = {
  info: {
    icon: Info,
    className: 'border-blue-200 bg-blue-50 text-blue-900',
    iconClass: 'text-blue-600',
    title: 'Info',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-amber-200 bg-amber-50 text-amber-900',
    iconClass: 'text-amber-600',
    title: 'Warning',
  },
  error: {
    icon: XCircle,
    className: 'border-red-200 bg-red-50 text-red-900',
    iconClass: 'text-red-600',
    title: 'Issue',
  },
};

export function FlagList({ flags }: FlagListProps) {
  if (!flags || flags.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Lightbulb className="h-4 w-4" />
        Evidence &amp; Flags ({flags.length})
      </div>
      <div className="space-y-2">
        {flags.map((flag, i) => {
          const config = SEVERITY_CONFIG[flag.severity] || SEVERITY_CONFIG.warning;
          const Icon = config.icon;
          return (
            <Alert key={i} className={config.className}>
              <Icon className={`h-4 w-4 ${config.iconClass}`} />
              <AlertTitle className="text-sm font-semibold flex items-center gap-2">
                {flag.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                {flag.field && (
                  <code className="text-xs px-1.5 py-0.5 rounded bg-black/10 font-mono">
                    {flag.field}
                  </code>
                )}
              </AlertTitle>
              <AlertDescription className="text-sm">{flag.message}</AlertDescription>
            </Alert>
          );
        })}
      </div>
    </div>
  );
}
