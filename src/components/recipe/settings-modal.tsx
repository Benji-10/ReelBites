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
  const {
    smallLiquid, largeLiquid, weight, dry, temperature,
    defaultServings, setSetting, setAllMetric, setAllImperial, loadFromStorage,
  } = useSettings();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  if (!open) return null;

  const categories = [
    { key: 'smallLiquid' as const, label: 'Small Liquids', examples: 'tsp, tbsp → ml', value: smallLiquid },
    { key: 'largeLiquid' as const, label: 'Large Liquids', examples: 'cups, pints → liters', value: largeLiquid },
    { key: 'weight' as const, label: 'Weights', examples: 'oz, lbs → g, kg', value: weight },
    { key: 'dry' as const, label: 'Dry Ingredients', examples: 'cups → g (flour, sugar)', value: dry },
    { key: 'temperature' as const, label: 'Temperature', examples: '°F → °C', value: temperature },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-lg">Settings</h2>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={setAllMetric} className="flex-1 text-xs">
              All Metric
            </Button>
            <Button variant="outline" size="sm" onClick={setAllImperial} className="flex-1 text-xs">
              All Imperial
            </Button>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Unit Preferences</label>
            <p className="text-xs text-muted-foreground">
              Choose metric or imperial for each measurement type. Syncs across your devices.
            </p>

            {categories.map((cat) => (
              <div key={cat.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{cat.label}</p>
                    <p className="text-xs text-muted-foreground">{cat.examples}</p>
                  </div>
                  <div className="flex items-center rounded-md border border-border p-0.5 text-xs">
                    <button
                      onClick={() => setSetting(cat.key, 'metric')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        cat.value === 'metric' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      Metric
                    </button>
                    <button
                      onClick={() => setSetting(cat.key, 'imperial')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        cat.value === 'imperial' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      Imperial
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Default Servings</label>
            <p className="text-xs text-muted-foreground">New recipes will default to this serving size.</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSetting('defaultServings', Math.max(1, defaultServings - 1))}>
                −
              </Button>
              <span className="font-semibold tabular-nums w-12 text-center">{defaultServings}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSetting('defaultServings', Math.min(20, defaultServings + 1))}>
                +
              </Button>
            </div>
          </div>

          <Button onClick={onClose} className="w-full">Done</Button>
        </CardContent>
      </Card>
    </div>
  );
}
