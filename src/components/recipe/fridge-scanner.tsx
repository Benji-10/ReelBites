'use client';

import { useState, useRef } from 'react';
import { Camera, X, Loader2, Check, Plus, Upload, RefreshCw, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import type { CachedPantryItem } from '@/lib/store';

interface FridgeScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ScannedItem {
  name: string;
  category: string;
  estimatedExpiryDays: number;
  confidence: string;
  selected: boolean;
  editedName?: string;
}

type Phase = 'capture' | 'analyzing' | 'review' | 'adding';

export function FridgeScanner({ open, onOpenChange }: FridgeScannerProps) {
  const { authToken, addPantryItem, fetchPantry } = useStore();
  const [phase, setPhase] = useState<Phase>('capture');
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPhase('capture');
    setItems([]);
    setImagePreview(null);
  }

  function handleOpenChange(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  async function handleImageSelected(file: File) {
    // Read the file as base64 data URL.
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl);
      setPhase('analyzing');

      try {
        const response = await fetch('/api/pantry/scan-fridge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ image: dataUrl }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Scan failed.' }));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const scannedItems: ScannedItem[] = (data.items || []).map((item: ScannedItem) => ({
          ...item,
          selected: item.confidence !== 'low', // Auto-deselect low-confidence items.
        }));

        if (scannedItems.length === 0) {
          toast.error('No food items detected. Try a clearer photo.');
          setPhase('capture');
          return;
        }

        setItems(scannedItems);
        setPhase('review');
        toast.success(`Found ${scannedItems.length} items! Review and add to your pantry.`);
      } catch (err) {
        toast.error('Could not scan fridge: ' + (err as Error).message);
        setPhase('capture');
      }
    };
    reader.readAsDataURL(file);
  }

  function toggleItem(idx: number) {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, selected: !item.selected } : item));
  }

  function editItemName(idx: number, name: string) {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, editedName: name } : item));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function addSelectedToPantry() {
    const selected = items.filter((i) => i.selected);
    if (selected.length === 0) return;

    setPhase('adding');

    let added = 0;
    let failed = 0;

    for (const item of selected) {
      const name = item.editedName || item.name;
      const expiryDate = item.estimatedExpiryDays > 0
        ? new Date(Date.now() + item.estimatedExpiryDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : undefined;

      try {
        const response = await fetch('/api/pantry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            name,
            category: item.category,
            expiryDate,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.item) {
            addPantryItem(data.item as CachedPantryItem);
          }
          added++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Refresh the pantry to get canonicalized data.
    await fetchPantry();

    toast.success(
      `Added ${added} item${added === 1 ? '' : 's'} to your pantry!` +
      (failed > 0 ? ` (${failed} failed)` : ''),
    );

    reset();
    onOpenChange(false);
  }

  const selectedCount = items.filter((i) => i.selected).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            Scan Fridge
          </DialogTitle>
          <DialogDescription>
            Take a photo of your fridge or pantry and we'll identify all the food items for you.
          </DialogDescription>
        </DialogHeader>

        {/* ===== CAPTURE PHASE ===== */}
        {phase === 'capture' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => cameraInputRef.current?.click()}
                className="gap-2 h-20 flex-col"
                variant="outline"
              >
                <Camera className="h-6 w-6" />
                <span className="text-sm">Take Photo</span>
              </Button>
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 h-20 flex-col"
                variant="outline"
              >
                <Upload className="h-6 w-6" />
                <span className="text-sm">Upload Image</span>
              </Button>
            </div>
            <div className="text-center text-xs text-muted-foreground space-y-1">
              <p>📷 Tips for best results:</p>
              <p>Open the fridge door, stand back, and take a photo that shows the shelves clearly.</p>
              <p>Make sure there's enough light. Take multiple photos if needed.</p>
            </div>

            {/* Hidden inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageSelected(file);
                e.target.value = '';
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageSelected(file);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {/* ===== ANALYZING PHASE ===== */}
        {phase === 'analyzing' && (
          <div className="space-y-4 py-8 text-center">
            {imagePreview && (
              <img
                src={imagePreview}
                alt="Fridge scan"
                className="max-h-48 mx-auto rounded-lg object-cover"
              />
            )}
            <div className="space-y-2">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
              <p className="text-sm font-medium">Analyzing your fridge...</p>
              <p className="text-xs text-muted-foreground">Identifying food items with AI</p>
            </div>
          </div>
        )}

        {/* ===== REVIEW PHASE ===== */}
        {phase === 'review' && (
          <div className="space-y-4">
            {imagePreview && (
              <img
                src={imagePreview}
                alt="Fridge scan"
                className="max-h-32 mx-auto rounded-lg object-cover cursor-pointer"
                onClick={() => setPhase('capture')}
              />
            )}

            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Found <strong>{items.length}</strong> items. Tap to edit or deselect.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5 text-xs">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Rescan
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <Card key={idx} className={!item.selected ? 'opacity-50' : ''}>
                  <CardContent className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={item.selected}
                        onCheckedChange={() => toggleItem(idx)}
                        className="shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <Input
                          value={item.editedName || item.name}
                          onChange={(e) => editItemName(idx, e.target.value)}
                          className="h-7 text-sm border-none px-0 bg-transparent focus-visible:ring-0"
                          style={{ fontSize: '16px' }}
                        />
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <Badge variant="secondary" className="text-xs h-5">
                            {item.category}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            ~{item.estimatedExpiryDays}d expiry
                          </span>
                          {item.confidence === 'low' && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 h-5">
                              Low confidence
                            </Badge>
                          )}
                          {item.confidence === 'medium' && (
                            <Badge variant="outline" className="text-xs text-muted-foreground h-5">
                              Medium
                            </Badge>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => removeItem(idx)}
                        className="text-muted-foreground hover:text-destructive p-1 shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t">
              <Button variant="ghost" size="sm" onClick={reset}>
                Cancel
              </Button>
              <Button
                onClick={addSelectedToPantry}
                disabled={selectedCount === 0}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add {selectedCount} item{selectedCount === 1 ? '' : 's'} to Pantry
              </Button>
            </div>
          </div>
        )}

        {/* ===== ADDING PHASE ===== */}
        {phase === 'adding' && (
          <div className="space-y-4 py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-sm font-medium">Adding items to your pantry...</p>
            <p className="text-xs text-muted-foreground">
              Canonicalizing ingredients with AI for smart matching...
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
