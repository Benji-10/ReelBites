'use client';

import { useEffect } from 'react';
import { Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSettings } from '@/lib/settings';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { unitSystem, setUnitSystem, defaultServings, setDefaultServings, loadSettings } = useSettings();

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardContent className="pt-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-lg">Settings</h2>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Unit System */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Default Unit System</label>
            <p className="text-xs text-muted-foreground">
              All recipes will display ingredients in your preferred units.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setUnitSystem('metric')}
                className={`flex flex-col items-start p-3 rounded-lg border transition-colors text-left ${
                  unitSystem === 'metric'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <span className="font-medium text-sm">Metric</span>
                <span className="text-xs text-muted-foreground">grams, ml, °C</span>
              </button>
              <button
                onClick={() => setUnitSystem('imperial')}
                className={`flex flex-col items-start p-3 rounded-lg border transition-colors text-left ${
                  unitSystem === 'imperial'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <span className="font-medium text-sm">Imperial</span>
                <span className="text-xs text-muted-foreground">cups, tbsp, oz, °F</span>
              </button>
            </div>
          </div>

          {/* Default Servings */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Default Servings</label>
            <p className="text-xs text-muted-foreground">
              New recipes will default to this serving size.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setDefaultServings(Math.max(1, defaultServings - 1))}
              >
                −
              </Button>
              <span className="font-semibold tabular-nums w-12 text-center">{defaultServings}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setDefaultServings(Math.min(20, defaultServings + 1))}
              >
                +
              </Button>
            </div>
          </div>

          {/* Done button */}
          <Button onClick={onClose} className="w-full">
            Done
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
