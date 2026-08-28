'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, X, Package, ScanLine, Loader2, ChevronRight, Percent, Check, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

interface PantryItem {
  id: string;
  name: string;
  genericName: string | null;
  category: string | null;
  quantity: string | null;
  expiryDate: string | null;
  barcode: string | null;
  isRunningLow: boolean;
  fillPercent?: number;
}

const CATEGORIES = [
  'Produce', 'Dairy', 'Meat & Fish', 'Bakery', 'Pantry', 'Grains', 'Pasta',
  'Sauces', 'Spices', 'Canned Goods', 'Frozen', 'Snacks', 'Beverages',
  'Condiments', 'Oils & Vinegars', 'Baking', 'Other',
];

// Unit groups for quantity input.
const LIQUID_UNITS = ['ml', 'L', 'fl oz', 'pints', 'gallons'];
const WEIGHT_UNITS = ['g', 'kg', 'oz', 'lb'];
const COUNT_UNITS = ['pcs', 'pack', 'box', 'bag', 'bottle', 'can', 'jar'];

function detectUnitType(qty: string): 'liquid' | 'weight' | 'count' | null {
  const lower = qty.toLowerCase();
  if (LIQUID_UNITS.some((u) => lower.includes(u))) return 'liquid';
  if (WEIGHT_UNITS.some((u) => lower.includes(u))) return 'weight';
  if (COUNT_UNITS.some((u) => lower.includes(u))) return 'count';
  // Heuristic: if it starts with a number followed by a letter.
  const match = lower.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)/);
  if (match) {
    const unit = match[2];
    if (LIQUID_UNITS.some((u) => u.startsWith(unit) || unit.startsWith(u))) return 'liquid';
    if (WEIGHT_UNITS.some((u) => u.startsWith(unit) || unit.startsWith(u))) return 'weight';
  }
  return null;
}

function extractNumber(qty: string): string {
  const match = qty.match(/^(\d+(?:\.\d+)?)/);
  return match ? match[1] : qty;
}

function extractUnit(qty: string): string {
  const match = qty.match(/^\d+(?:\.\d+)?\s*([a-z\s]+)/i);
  return match ? match[1].trim() : '';
}

export function PantryView() {
  const { authToken, pantryItems, fetchPantry, addPantryItem, updatePantryItem, removePantryItem } = useStore();
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [scanning, setScanning] = useState(false);
  const [barcodeValue, setBarcodeValue] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PantryItem | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<IScannerControls | null>(null);

  const authHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  // Use cached items from the store. Fetch only if the store is empty.
  const items: PantryItem[] = pantryItems as PantryItem[];

  useEffect(() => {
    if (pantryItems.length === 0) {
      fetchPantry().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [pantryItems.length, fetchPantry]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || adding) return;
    setAdding(true);

    try {
      const res = await fetch('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
      addPantryItem(data.item);
      setNewName(''); setNewQuantity(''); setNewExpiry(''); setNewCategory(''); setBarcodeValue('');
      setShowAdd(false);
      toast.success('Added to pantry.');
    } catch {
      toast.error('Could not add item.');
    } finally {
      setAdding(false);
    }
  }

  async function startBarcodeScan() {
    setScanning(true);
    await new Promise((r) => setTimeout(r, 200));
    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
        videoRef.current!,
        (result, _error) => {
          if (result) {
            const code = result.getText();
            setBarcodeValue(code);
            stopScan();
            lookupProduct(code);
          }
        },
      );
      scannerRef.current = controls;
    } catch {
      toast.error('Could not access camera.');
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
    return () => { if (scannerRef.current) scannerRef.current.stop(); };
  }, []);

  async function lookupProduct(barcode: string) {
    setLookingUp(true);
    setShowAdd(true);
    toast.info(`Looking up product ${barcode}...`);

    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
      if (!res.ok) throw new Error('Lookup failed.');
      const data = await res.json();
      let productName = '';
      let productQuantity = '';
      let productCategory = '';

      if (data.status === 1 && data.product) {
        const p = data.product;
        productName = p.product_name || p.generic_name || '';
        productQuantity = p.quantity || '';
        const categories = p.categories_tags || [];
        if (categories.length > 0) {
          const firstCat = categories[0].replace('en:', '').replace(/-/g, ' ');
          productCategory = firstCat.charAt(0).toUpperCase() + firstCat.slice(1);
        }
        if (productName) { setNewName(productName); toast.success(`Found: ${productName}`); }
        if (productQuantity) setNewQuantity(productQuantity);
        if (productCategory) setNewCategory(productCategory);
      }

      // Gemini enrichment — always call, even if OFF had some data,
      // to fill in missing fields (category, expiry, quantity).
      try {
        const enrichRes = await fetch('/api/pantry/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode, name: productName, quantity: productQuantity, category: productCategory }),
        });
        if (enrichRes.ok) {
          const enrichData = await enrichRes.json();
          // Only fill if not already set by OFF.
          if (enrichData.category) setNewCategory(enrichData.category);
          if (enrichData.quantity && !productQuantity) setNewQuantity(enrichData.quantity);
          if (enrichData.expiryDate) setNewExpiry(enrichData.expiryDate);
        }
      } catch {}
    } catch {
      toast.info('Could not look up product. Enter details manually.');
    } finally {
      setLookingUp(false);
    }
  }

  async function updateItem(id: string, updates: Record<string, unknown>) {
    // Optimistic update via the store.
    const existing = pantryItems.find((i) => i.id === id);
    if (existing) {
      updatePantryItem({ ...existing, ...updates } as PantryItem);
    }
    if (selectedItem) setSelectedItem({ ...selectedItem, ...updates } as PantryItem);
    await fetch(`/api/pantry/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(updates),
    });
  }

  async function deleteItem(id: string) {
    removePantryItem(id);
    setSelectedItem(null);
    setShowDeleteConfirm(false);
    await fetch(`/api/pantry/${id}`, { method: 'DELETE', headers: authHeaders });
    toast.success('Removed from pantry.');
  }

  function startEdit(field: string, currentValue: string) {
    setEditingField(field);
    setEditValue(currentValue);
  }

  async function saveEdit(field: string) {
    if (!selectedItem) return;
    const updates: Record<string, unknown> = { [field]: editValue };
    if (field === 'expiryDate' && editValue) {
      updates[field] = editValue;
    }
    await updateItem(selectedItem.id, updates);
    setEditingField(null);
  }

  // Unit conversion for quantity input.
  const currentQty = newQuantity || selectedItem?.quantity || '';
  const qtyNumber = extractNumber(currentQty);
  const qtyUnit = extractUnit(currentQty);
  const unitType = detectUnitType(currentQty);
  const availableUnits = unitType === 'liquid' ? LIQUID_UNITS : unitType === 'weight' ? WEIGHT_UNITS : unitType === 'count' ? COUNT_UNITS : [];

  function changeUnit(newUnit: string, target: 'add' | 'edit') {
    if (target === 'add') {
      setNewQuantity(qtyNumber ? `${qtyNumber} ${newUnit}` : newQuantity);
    } else if (selectedItem) {
      const num = extractNumber(selectedItem.quantity || '');
      setEditValue(num ? `${num} ${newUnit}` : editValue);
    }
  }

  const categories = Array.from(new Set(items.map((i) => i.category || 'Other'))).sort();
  const filtered = filter === 'all' ? items : items.filter((i) => (i.category || 'Other') === filter);
  const now = new Date();

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
          <Button onClick={startBarcodeScan} variant="outline" size="icon" className="h-9 w-9" disabled={scanning} aria-label="Scan barcode">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
          </Button>
          <Button onClick={() => setShowAdd(!showAdd)} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Item</span>
          </Button>
        </div>
      </div>

      {/* Scanner */}
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

      {/* Add form */}
      {showAdd && (
        <Card>
          <CardContent className="pt-4">
            <form onSubmit={addItem} className="space-y-3">
              {/* Product name with suggestions */}
              <div className="relative">
                <Input
                  placeholder="Product name..."
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="h-10"
                />
                {showSuggestions && (
                  <CommonItemsDropdown
                    query={newName}
                    pantryItems={items}
                    onSelect={(name) => {
                      setNewName(name);
                      setShowSuggestions(false);
                    }}
                  />
                )}
              </div>
              <div className="flex gap-2">
                <Input placeholder="Qty (e.g. 500g)" value={newQuantity} onChange={(e) => setNewQuantity(e.target.value)} className="flex-1 min-w-0 h-10" />
                <Input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} className="w-[140px] shrink-0 h-10" />
              </div>
              {/* Unit buttons */}
              {availableUnits.length > 0 && qtyNumber && (
                <div className="flex gap-1 flex-wrap">
                  {availableUnits.map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => changeUnit(u, 'add')}
                      className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                        qtyUnit === u ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              )}
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Auto-categorize</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {barcodeValue && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">Barcode: {barcodeValue}</Badge>
                  {lookingUp && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                  <button type="button" onClick={() => setBarcodeValue('')} className="text-xs text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={adding}>
                  {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)} disabled={adding}>Cancel</Button>
              </div>
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

      {/* Items */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">{items.length === 0 ? 'Your pantry is empty. Add items to track what you have.' : 'No items in this category.'}</p>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((item) => {
            const expiry = item.expiryDate ? new Date(item.expiryDate) : null;
            const daysToExpiry = expiry ? Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
            const isExpired = daysToExpiry !== null && daysToExpiry < 0;
            const isExpiringSoon = daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 3;
            const fill = item.fillPercent ?? 100;

            return (
              <button
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/60 hover:bg-muted/30 transition-colors text-left"
              >
                {/* Fill indicator bar */}
                <div className="w-1.5 h-10 rounded-full shrink-0 overflow-hidden bg-muted">
                  <div
                    className={`w-full rounded-full ${fill > 50 ? 'bg-green-500' : fill > 20 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ height: `${fill}%` }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{item.name}</span>
                    {item.quantity && <span className="text-xs text-muted-foreground shrink-0">{item.quantity}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.category && <span className="text-xs text-muted-foreground">{item.category}</span>}
                    {item.isRunningLow && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 h-4 px-1">Low</Badge>}
                    {expiry && (
                      <span className={`text-xs ${isExpired ? 'text-red-500' : isExpiringSoon ? 'text-amber-500' : 'text-muted-foreground'}`}>
                        {isExpired ? 'Expired' : `${daysToExpiry}d`}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {/* Item detail sheet */}
      <Sheet open={!!selectedItem} onOpenChange={(open) => { if (!open) { setSelectedItem(null); setEditingField(null); } }}>
        <SheetContent className="overflow-y-auto">
          {selectedItem && (
            <div className="px-6 pb-6">
              <SheetHeader className="px-0">
                <SheetTitle>{selectedItem.name}</SheetTitle>
                <SheetDescription>
                  {selectedItem.category} {selectedItem.quantity && `· ${selectedItem.quantity}`}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 mt-6">
                {/* Fill level slider — larger hitbox */}
                <div className="space-y-3 p-3 -mx-3 rounded-lg hover:bg-muted/30">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium flex items-center gap-1.5">
                      <Percent className="h-3.5 w-3.5" />
                      Fill level
                    </label>
                    <span className="text-sm text-muted-foreground tabular-nums">{selectedItem.fillPercent ?? 100}%</span>
                  </div>
                  <div className="py-2">
                    <Slider
                      value={[selectedItem.fillPercent ?? 100]}
                      onValueChange={(v) => updateItem(selectedItem.id, { fillPercent: v[0] })}
                      max={100}
                      step={10}
                      className="w-full"
                    />
                  </div>
                  {(selectedItem.fillPercent ?? 100) <= 20 && (
                    <p className="text-xs text-amber-500">Running low — consider adding to shopping list</p>
                  )}
                </div>

                {/* Quantity — editable */}
                <div className="p-3 -mx-3 rounded-lg hover:bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">Quantity</p>
                  {editingField === 'quantity' ? (
                    <div className="flex gap-2">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-8 text-sm flex-1"
                        autoFocus
                      />
                      <Button size="icon" className="h-8 w-8" onClick={() => saveEdit('quantity')}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEdit('quantity', selectedItem.quantity || '')}
                      className="flex items-center gap-2 text-sm font-medium w-full text-left"
                    >
                      {selectedItem.quantity || 'Not set'}
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                  {/* Unit conversion buttons */}
                  {editingField === 'quantity' && availableUnits.length > 0 && qtyNumber && (
                    <div className="flex gap-1 flex-wrap mt-2">
                      {availableUnits.map((u) => (
                        <button
                          key={u}
                          onClick={() => {
                            const num = extractNumber(editValue);
                            setEditValue(num ? `${num} ${u}` : editValue);
                          }}
                          className={`px-2 py-0.5 rounded text-xs border ${extractUnit(editValue) === u ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Expiry — editable */}
                <div className="p-3 -mx-3 rounded-lg hover:bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">Expiry date</p>
                  {editingField === 'expiryDate' ? (
                    <div className="flex gap-2">
                      <Input
                        type="date"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-8 text-sm flex-1"
                        autoFocus
                      />
                      <Button size="icon" className="h-8 w-8" onClick={() => saveEdit('expiryDate')}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEdit('expiryDate', selectedItem.expiryDate ? selectedItem.expiryDate.split('T')[0] : '')}
                      className="flex items-center gap-2 text-sm font-medium w-full text-left"
                    >
                      {selectedItem.expiryDate
                        ? new Date(selectedItem.expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : 'Not set'}
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>

                {/* Category — editable */}
                <div className="p-3 -mx-3 rounded-lg hover:bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">Category</p>
                  {editingField === 'category' ? (
                    <div className="flex gap-2">
                      <select
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm"
                        autoFocus
                      >
                        <option value="">Select...</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <Button size="icon" className="h-8 w-8" onClick={() => saveEdit('category')}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEdit('category', selectedItem.category || '')}
                      className="flex items-center gap-2 text-sm font-medium w-full text-left"
                    >
                      {selectedItem.category || 'Not set'}
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>

                {/* Barcode */}
                {selectedItem.barcode && (
                  <div className="p-3 -mx-3 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Barcode</p>
                    <p className="text-sm font-mono">{selectedItem.barcode}</p>
                  </div>
                )}

                {/* Running low toggle */}
                <Button
                  variant={selectedItem.isRunningLow ? 'default' : 'outline'}
                  size="sm"
                  className="w-full"
                  onClick={() => updateItem(selectedItem.id, { isRunningLow: !selectedItem.isRunningLow })}
                >
                  {selectedItem.isRunningLow ? '✓ Marked as running low' : 'Mark as running low'}
                </Button>

                {/* Delete with confirmation */}
                <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full text-destructive hover:text-destructive gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete item
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this item?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently remove &ldquo;{selectedItem.name}&rdquo; from your pantry.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteItem(selectedItem.id)}
                        className="bg-destructive text-white hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Common staple items — shown as suggestions when the user starts typing.
const COMMON_STAPLES = [
  'Milk', 'Eggs', 'Bread', 'Butter', 'Cheese', 'Yogurt',
  'Onions', 'Garlic', 'Tomatoes', 'Potatoes', 'Carrots', 'Lettuce',
  'Bananas', 'Apples', 'Lemons', 'Avocados',
  'Chicken Breast', 'Minced Beef', 'Bacon', 'Salmon',
  'Pasta', 'Rice', 'Flour', 'Sugar', 'Olive Oil', 'Salt', 'Black Pepper',
  'Soy Sauce', 'Tomato Paste', 'Canned Beans', 'Canned Tomatoes',
  'Tuna', 'Stock Cubes', 'Baking Powder', 'Vanilla Extract',
  'Coffee', 'Tea', 'Orange Juice', 'Sparkling Water',
  'Chocolate', 'Honey', 'Peanut Butter', 'Jam',
];

interface CommonItemsDropdownProps {
  query: string;
  pantryItems: PantryItem[];
  onSelect: (name: string) => void;
}

function CommonItemsDropdown({ query, pantryItems, onSelect }: CommonItemsDropdownProps) {
  // Get unique names from pantry (user's previously added items).
  const userItems = Array.from(new Set(pantryItems.map((i) => i.name))).slice(0, 20);

  // Combine user items with common staples, deduplicate, and filter by query.
  const allItems = Array.from(new Set([...userItems, ...COMMON_STAPLES]));
  const filtered = query.trim()
    ? allItems.filter((name) => name.toLowerCase().includes(query.toLowerCase()))
    : allItems;

  // Show top 8 suggestions.
  const suggestions = filtered.slice(0, 8);

  if (suggestions.length === 0) return null;

  return (
    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md max-h-60 overflow-y-auto custom-scrollbar">
      {suggestions.map((name) => {
        const isInPantry = pantryItems.some((i) => i.name === name);
        return (
          <button
            key={name}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(name);
            }}
            className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
          >
            <span>{name}</span>
            {isInPantry && (
              <Badge variant="secondary" className="text-xs h-4 px-1">In pantry</Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
