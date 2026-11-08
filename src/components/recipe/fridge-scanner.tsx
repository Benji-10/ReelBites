'use client';

/**
 * FridgeScanner — multi-phase dialog for scanning a fridge into the pantry.
 *
 *   Phase 1 (capture):   camera preview (getUserMedia) + capture button
 *   Phase 2 (analyzing): spinner while POSTing to /api/pantry/scan-fridge
 *   Phase 3 (review):    editable list of detected items — deselect/remove
 *   Phase 4 (adding):    POSTs each selected item to /api/pantry
 *
 * CRITICAL: the camera stream MUST be stopped on close — stop all
 * MediaStream tracks and null the video element's srcObject. Failing to do
 * this leaves the camera light on (especially on iOS Safari).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, X, Check, Loader2, Refrigerator, ScanLine, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';

interface FridgeScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DetectedItem {
  name: string;
  quantity: string | null;
  unit: string | null;
  category: string | null;
  genericName: string | null;
  expiryDate: string | null;
  selected: boolean;
}

type Phase = 'capture' | 'analyzing' | 'review' | 'adding';

export function FridgeScanner({ open, onOpenChange }: FridgeScannerProps) {
  const { authToken, addPantryItem } = useStore();
  const [phase, setPhase] = useState<Phase>('capture');
  const [items, setItems] = useState<DetectedItem[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  /** Stop the camera stream: stop all tracks, then null the video srcObject. */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /** Start the camera for phase 1. */
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.warn('[fridge-scanner] Camera failed:', err);
      setCameraError(
        'Could not access the camera. Check browser permissions (camera access requires HTTPS).',
      );
    }
  }, []);

  // Start camera when the dialog opens in capture phase.
  useEffect(() => {
    if (open && phase === 'capture') {
      // Give the Dialog a tick to mount the <video> element.
      const timer = setTimeout(() => { startCamera(); }, 100);
      return () => clearTimeout(timer);
    }
  }, [open, phase, startCamera]);

  // CRITICAL: stop the camera when the dialog closes or the component unmounts.
  useEffect(() => {
    if (!open) {
      stopCamera();
    }
  }, [open, stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  /** Capture the current frame as a JPEG data URL. */
  function captureFrame(): string | null {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  /** Phase 1 → 2: capture + analyze. */
  async function handleCapture() {
    const dataUrl = captureFrame();
    if (!dataUrl) {
      toast.error('Could not capture the photo. Try again.');
      return;
    }

    // Camera is done — release it immediately.
    stopCamera();
    setPhase('analyzing');

    try {
      const res = await fetch('/api/pantry/scan-fridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ image: dataUrl }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Scan failed.' }));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const detected: DetectedItem[] = (data.items || []).map((item: Omit<DetectedItem, 'selected'>) => ({
        ...item,
        selected: true,
      }));

      if (detected.length === 0) {
        toast.info('No food items detected. Try another angle or more light.');
        setPhase('capture');
        return;
      }

      setItems(detected);
      setPhase('review');
    } catch (err) {
      toast.error('Could not scan fridge: ' + (err as Error).message);
      setPhase('capture');
    }
  }

  /** Phase 3 helpers — edit / toggle / remove items. */
  function updateItem(idx: number, updates: Partial<DetectedItem>) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...updates } : item)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  /** Phase 3 → 4: add all selected items to the pantry. */
  async function handleAddToPantry() {
    const selected = items.filter((i) => i.selected && i.name.trim());
    if (selected.length === 0) {
      toast.info('No items selected.');
      return;
    }

    setPhase('adding');
    let added = 0;
    let failed = 0;

    for (const item of selected) {
      try {
        const res = await fetch('/api/pantry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            name: item.name.trim(),
            genericName: item.genericName || undefined,
            category: item.category || undefined,
            quantity: [item.quantity, item.unit].filter(Boolean).join(' ') || undefined,
            expiryDate: item.expiryDate || undefined,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.item) addPantryItem(data.item);
        added++;
      } catch {
        failed++;
      }
    }

    if (added > 0) {
      toast.success(`Added ${added} item${added === 1 ? '' : 's'} to your pantry!`);
    }
    if (failed > 0) {
      toast.error(`Could not add ${failed} item${failed === 1 ? '' : 's'}.`);
    }

    // Reset + close.
    setItems([]);
    setPhase('capture');
    onOpenChange(false);
  }

  /** Close handler — always stop the camera and reset state. */
  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      stopCamera();
      setItems([]);
      setPhase('capture');
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Refrigerator className="h-5 w-5 text-primary" />
            Scan Fridge
          </DialogTitle>
          <DialogDescription>
            {phase === 'capture' && 'Take a photo of your fridge — AI will identify the food items.'}
            {phase === 'analyzing' && 'Analyzing your fridge photo...'}
            {phase === 'review' && 'Review the detected items. Edit names/quantities, untick anything wrong.'}
            {phase === 'adding' && 'Adding items to your pantry...'}
          </DialogDescription>
        </DialogHeader>

        {/* ===== Phase 1: capture ===== */}
        {phase === 'capture' && (
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
              {cameraError ? (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <p className="text-sm text-white/80 text-center">{cameraError}</p>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-3/4 h-3/4 border-2 border-white/60 rounded-xl" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleCapture} className="gap-2 flex-1" disabled={!!cameraError}>
                <Camera className="h-4 w-4" />
                Capture &amp; Analyze
              </Button>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Tip: open the fridge door for better light, and fill the frame with the shelves.
            </p>
          </div>
        )}

        {/* ===== Phase 2: analyzing ===== */}
        {phase === 'analyzing' && (
          <div className="py-16 text-center space-y-3">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">
              Identifying food items with Gemini vision...
            </p>
            <p className="text-xs text-muted-foreground">This takes ~10 seconds.</p>
          </div>
        )}

        {/* ===== Phase 3: review ===== */}
        {phase === 'review' && (
          <div className="space-y-3">
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border ${
                    item.selected ? 'border-border bg-background' : 'border-border/50 bg-muted/30 opacity-60'
                  }`}
                >
                  <Checkbox
                    checked={item.selected}
                    onCheckedChange={(checked) => updateItem(idx, { selected: !!checked })}
                  />
                  <Input
                    value={item.name}
                    onChange={(e) => updateItem(idx, { name: e.target.value })}
                    className="flex-1 min-w-0 h-9 text-sm"
                    style={{ fontSize: '16px' }}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  <Input
                    value={item.quantity || ''}
                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                    placeholder="Qty"
                    className="w-16 shrink-0 h-9 text-sm text-center"
                    style={{ fontSize: '16px' }}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  <Input
                    value={item.unit || ''}
                    onChange={(e) => updateItem(idx, { unit: e.target.value })}
                    placeholder="Unit"
                    className="w-20 shrink-0 h-9 text-sm text-center"
                    style={{ fontSize: '16px' }}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-muted-foreground hover:text-destructive p-1 shrink-0"
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={handleAddToPantry} className="gap-2 flex-1">
                <Check className="h-4 w-4" />
                Add {items.filter((i) => i.selected).length} to Pantry
              </Button>
              <Button variant="outline" onClick={() => { setItems([]); setPhase('capture'); }} className="gap-2">
                <ScanLine className="h-4 w-4" />
                Retake
              </Button>
            </div>
          </div>
        )}

        {/* ===== Phase 4: adding ===== */}
        {phase === 'adding' && (
          <div className="py-16 text-center space-y-3">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">
              Adding {items.filter((i) => i.selected).length} items to your pantry...
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
