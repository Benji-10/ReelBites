'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, AlertTriangle, X, ShoppingCart, Package, ScanLine, Loader2, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';

interface PantryItem {
  id: string;
  name: string;
  genericName: string | null;
  category: string | null;
  quantity: string | null;
  expiryDate: string | null;
  barcode: string | null;
  isRunningLow: boolean;
}

const CATEGORIES = [
  'Produce', 'Dairy', 'Meat & Fish', 'Bakery', 'Pantry', 'Grains', 'Pasta',
  'Sauces', 'Spices', 'Canned Goods', 'Frozen', 'Snacks', 'Beverages',
  'Condiments', 'Oils & Vinegars', 'Baking', 'Other',
];

export function PantryView() {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [scanning, setScanning] = useState(false);
  const [barcodeValue, setBarcodeValue] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<IScannerControls | null>(null);
  const authToken = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/pantry', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      toast.error('Failed to load pantry.');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      const res = await fetch('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({
          name: newName.trim(),
          quantity: newQuantity || undefined,
          expiryDate: newExpiry || undefined,
          category: newCategory || undefined,
          barcode: barcodeValue || undefined,
        }),
      });

      if (!res.ok) throw new Error('Failed to add.');
      const data = await res.json();
      setItems([...items, data.item]);
      setNewName(''); setNewQuantity(''); setNewExpiry(''); setNewCategory(''); setBarcodeValue('');
      setShowAdd(false);
      toast.success('Added to pantry.');
    } catch {
      toast.error('Could not add item.');
    }
  }

  // Barcode scanning using ZXing — works on ALL browsers including iOS Safari.
  async function startBarcodeScan() {
    setScanning(true);

    try {
      const reader = new BrowserMultiFormatReader();

      // Give the video element a moment to render.
      await new Promise((r) => setTimeout(r, 100));

      // ZXing's decodeFromVideoDevice uses the rear camera on mobile.
      // Pass undefined for device ID to let the browser pick the best camera.
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result, error) => {
          if (result) {
            const code = result.getText();
            setBarcodeValue(code);
            stopScan();
            setShowAdd(true);
            toast.success(`Barcode scanned: ${code}`);
          }
        },
      );

      scannerRef.current = controls;
    } catch {
      toast.error('Could not access camera. Check browser permissions.');
      setScanning(false);
    }
  }

  function stopScan() {
    setScanning(false);
    if (scannerRef.current) {
      scannerRef.current.stop();
      scannerRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop();
      }
    };
  }, []);

  async function toggleRunningLow(item: PantryItem) {
    const updated = { ...item, isRunningLow: !item.isRunningLow };
    setItems(items.map((i) => (i.id === item.id ? updated : i)));
    await fetch(`/api/pantry/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify({ isRunningLow: !item.isRunningLow }),
    });
  }

  async function deleteItem(id: string) {
    setItems(items.filter((i) => i.id !== id));
    await fetch(`/api/pantry/${id}`, {
      method: 'DELETE',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    toast.success('Removed from pantry.');
  }

  // Group items by category.
  const categories = Array.from(new Set(items.map((i) => i.category || 'Other'))).sort();
  const filtered = filter === 'all' ? items : items.filter((i) => (i.category || 'Other') === filter);

  // Check for expiring soon.
  const now = new Date();
  const expiringSoon = items.filter((i) => {
    if (!i.expiryDate) return false;
    const d = new Date(i.expiryDate);
    const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff <= 3 && diff >= 0;
  });

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6 sm:h-7 sm:w-7 text-primary" />
            Pantry
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{items.length} items tracked</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => startBarcodeScan()} variant="outline" size="icon" className="h-9 w-9" aria-label="Scan barcode">
            <ScanLine className="h-4 w-4" />
          </Button>
          <Button onClick={() => setShowAdd(!showAdd)} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Item</span>
          </Button>
        </div>
      </div>

      {/* Barcode scanner camera view */}
      {scanning && (
        <Card>
          <CardContent className="pt-4">
            <div className="relative">
              <video ref={videoRef} className="w-full rounded-lg" playsInline muted />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-3/4 h-1 border-2 border-primary rounded" />
              </div>
              <Button variant="destructive" size="sm" onClick={stopScan} className="absolute top-2 right-2 gap-1">
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">Point camera at a barcode...</p>
          </CardContent>
        </Card>
      )}

      {/* Expiring soon alert */}
      {expiringSoon.length > 0 && (
        <Card className="border-amber-300/50 bg-amber-50/50">
          <CardContent className="py-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="text-sm">{expiringSoon.length} item{expiringSoon.length > 1 ? 's' : ''} expiring soon:</span>
            <span className="text-sm font-medium">{expiringSoon.map((i) => i.name).join(', ')}</span>
          </CardContent>
        </Card>
      )}

      {/* Add form */}
      {showAdd && (
        <Card>
          <CardContent className="pt-4">
            <form onSubmit={addItem} className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <Input placeholder="Product name..." value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1" />
                <Input placeholder="Qty (e.g. 500g)" value={newQuantity} onChange={(e) => setNewQuantity(e.target.value)} className="w-full sm:w-32" />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Auto-categorize</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <Input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} className="w-full sm:w-auto" />
              </div>
              {barcodeValue && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">Barcode: {barcodeValue}</Badge>
                  <button onClick={() => setBarcodeValue('')} className="text-xs text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm">Add</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
              <p className="text-xs text-muted-foreground">Category and generic name are auto-assigned using AI if not specified.</p>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filter tabs */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
          <button onClick={() => setFilter('all')} className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
            All ({items.length})
          </button>
          {categories.map((cat) => {
            const count = items.filter((i) => (i.category || 'Other') === cat).length;
            return (
              <button key={cat} onClick={() => setFilter(cat)} className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                {cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Items list */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">{items.length === 0 ? 'Your pantry is empty. Add items to track what you have.' : 'No items in this category.'}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const expiry = item.expiryDate ? new Date(item.expiryDate) : null;
            const daysToExpiry = expiry ? Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
            const isExpired = daysToExpiry !== null && daysToExpiry < 0;
            const isExpiringSoon = daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 3;

            return (
              <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/60 hover:bg-muted/30 transition-colors">
                <Checkbox checked={item.isRunningLow} onCheckedChange={() => toggleRunningLow(item)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{item.name}</span>
                    {item.quantity && <span className="text-xs text-muted-foreground">{item.quantity}</span>}
                    {item.isRunningLow && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Low</Badge>}
                    {item.category && <Badge variant="secondary" className="text-xs">{item.category}</Badge>}
                  </div>
                  {expiry && (
                    <span className={`text-xs ${isExpired ? 'text-red-500' : isExpiringSoon ? 'text-amber-500' : 'text-muted-foreground'}`}>
                      {isExpired ? 'Expired' : `Expires in ${daysToExpiry} day${daysToExpiry !== 1 ? 's' : ''}`}
                    </span>
                  )}
                </div>
                <button onClick={() => deleteItem(item.id)} className="text-muted-foreground hover:text-destructive p-1">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
