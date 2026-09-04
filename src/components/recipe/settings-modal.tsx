'use client';

import { useEffect, useState } from 'react';
import { Settings, X, Bell, BellOff, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSettings } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { toast } from 'sonner';

const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'th', label: 'ไทย', flag: '🇹🇭' },
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    smallLiquid, largeLiquid, weight, dry, temperature,
    defaultServings, inventoryDeduction, languages, defaultLanguage,
    setSetting, setAllMetric, setAllImperial, loadFromStorage,
  } = useSettings();
  const { authToken } = useStore();
  const push = usePushNotifications(authToken);
  const [testing, setTesting] = useState(false);

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

          <div className="space-y-2">
            <label className="text-sm font-medium">Inventory Deduction</label>
            <p className="text-xs text-muted-foreground">
              What happens to your pantry when you cook a recipe?
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { value: 'auto' as const, label: 'Auto', desc: 'Auto-deduct' },
                { value: 'confirm' as const, label: 'Confirm', desc: 'Ask first' },
                { value: 'none' as const, label: 'None', desc: 'Disabled' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSetting('inventoryDeduction', opt.value)}
                  className={`p-2.5 rounded-lg border-2 text-center transition-all ${
                    inventoryDeduction === opt.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {inventoryDeduction === 'auto' && 'Automatically deducts the recipe amounts from your pantry items. Best if you keep quantities accurate.'}
              {inventoryDeduction === 'confirm' && 'Shows a review screen before deducting. You can edit amounts (e.g. if you used more or finished an item).'}
              {inventoryDeduction === 'none' && 'No deduction prompts. For users who don\'t track pantry quantities.'}
            </p>
          </div>

          {/* Language Settings */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Languages</label>
            <p className="text-xs text-muted-foreground">
              Languages you speak. Recipes in these languages will keep their original text. Recipes in other languages will be translated to your default language.
            </p>
            <div className="space-y-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Languages you speak:</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const selected = languages.includes(lang.code);
                    return (
                      <button
                        key={lang.code}
                        onClick={() => {
                          const next = selected
                            ? languages.filter((l) => l !== lang.code)
                            : [...languages, lang.code];
                          if (next.length === 0) return; // Keep at least one
                          setSetting('languages', next);
                          // If removing the default language, switch to the first remaining.
                          if (selected && defaultLanguage === lang.code && next.length > 0) {
                            setSetting('defaultLanguage', next[0]);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                          selected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-muted-foreground border-border hover:bg-muted'
                        }`}
                      >
                        {lang.flag} {lang.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Default language for AI recipes:</p>
                <select
                  value={defaultLanguage}
                  onChange={(e) => setSetting('defaultLanguage', e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {languages.map((code) => {
                    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
                    return (
                      <option key={code} value={code}>
                        {lang?.flag} {lang?.label || code}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          </div>

          {/* Push Notifications */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Expiry Alerts</label>
            <p className="text-xs text-muted-foreground">
              Get push notifications when pantry items are about to expire (7 days, 3 days, 1 day, and day of).
            </p>
            {!push.isSupported ? (
              <p className="text-xs text-muted-foreground py-2">
                Push notifications are not supported in this browser.
              </p>
            ) : (
              <div className="space-y-2">
                {push.isSubscribed ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={push.unsubscribe}
                      disabled={push.loading}
                      className="gap-1.5 flex-1"
                    >
                      {push.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellOff className="h-3.5 w-3.5" />}
                      Disable Alerts
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        setTesting(true);
                        const result = await push.sendTest();
                        setTesting(false);
                        if (result.error) {
                          toast.error(result.error);
                        } else {
                          toast.success(`Test sent! Check your notifications. (${result.sent} sent, ${result.failed} failed)`);
                        }
                      }}
                      disabled={testing}
                      className="gap-1.5"
                    >
                      {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Test
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const success = await push.subscribe();
                      if (success) {
                        toast.success('Push notifications enabled!');
                      } else if (push.permission === 'denied') {
                        toast.error('Notification permission was denied. Please enable it in your browser settings.');
                      } else {
                        toast.error('Could not enable push notifications.');
                      }
                    }}
                    disabled={push.loading}
                    className="gap-1.5 w-full"
                  >
                    {push.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                    Enable Expiry Alerts
                  </Button>
                )}
                {push.permission === 'denied' && (
                  <p className="text-xs text-amber-600">
                    Notification permission is blocked. Please enable it in your browser settings to receive alerts.
                  </p>
                )}
              </div>
            )}
          </div>

          <Button onClick={onClose} className="w-full">Done</Button>
        </CardContent>
      </Card>
    </div>
  );
}
