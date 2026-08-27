'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, X, ShoppingCart, Loader2, ScanLine, ShoppingBasket, Check, ChevronDown, ChevronRight, Package, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ShoppingItem {
  id: string;
  name: string;
  genericName: string | null;
  quantity: string | null;
  section: string | null;
  sectionOrder: number;
  isChecked: boolean;
  recipeId: string | null;
}

interface ShoppingList {
  id: string;
  name: string;
  storeName: string | null;
  items: ShoppingItem[];
}

// Basket item — items scanned/tapped while shopping, not yet in pantry.
interface BasketItem {
  name: string;
  barcode?: string;
  quantity?: string;
  genericName?: string;
}

function guessSection(name: string): { section: string; order: number } {
  const lower = name.toLowerCase();
  if (/tomato|onion|garlic|lettuce|potato|carrot|pepper|herb|fruit|veg|lemon|lime|avocado|ginger/.test(lower))
    return { section: 'Produce', order: 1 };
  if (/bread|bagel|croissant|bun/.test(lower)) return { section: 'Bakery', order: 2 };
  if (/milk|cheese|yogurt|cream|butter|egg/.test(lower)) return { section: 'Dairy', order: 3 };
  if (/chicken|beef|pork|fish|salmon|shrimp|bacon|sausage/.test(lower)) return { section: 'Meat & Fish', order: 4 };
  if (/pasta|spaghetti|penne|rice|noodle|flour|oat|grain|quinoa/.test(lower)) return { section: 'Grains & Pasta', order: 6 };
  if (/sauce|ketchup|mayo|mustard|vinegar|oil|soy/.test(lower)) return { section: 'Sauces & Condiments', order: 7 };
  if (/salt|pepper|spice|cumin|paprika|oregano|basil/.test(lower)) return { section: 'Spices', order: 8 };
  if (/can|tin|bean|tuna|soup/.test(lower)) return { section: 'Canned Goods', order: 9 };
  if (/frozen|ice/.test(lower)) return { section: 'Frozen', order: 10 };
  if (/chips|cookie|cracker|snack|chocolate|candy/.test(lower)) return { section: 'Snacks', order: 11 };
  if (/juice|soda|water|tea|coffee|wine|beer/.test(lower)) return { section: 'Beverages', order: 12 };
  return { section: 'Other', order: 99 };
}

export function ShoppingListView() {
  const { authToken } = useStore();
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newListName, setNewListName] = useState('');
  const [showNewList, setShowNewList] = useState(false);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<IScannerControls | null>(null);

  const authHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch('/api/shopping-lists', { headers: authHeaders });
      const data = await res.json();
      setLists(data.lists || []);
      if (data.lists?.length > 0 && !activeListId) {
        setActiveListId(data.lists[0].id);
      }
    } catch {
      toast.error('Failed to load shopping lists.');
    } finally {
      setLoading(false);
    }
  }, [authToken, activeListId]);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  const activeList = lists.find((l) => l.id === activeListId);

  async function createList() {
    if (!newListName.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch('/api/shopping-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ name: newListName.trim() }),
      });
      const data = await res.json();
      setLists([data.list, ...lists]);
      setActiveListId(data.list.id);
      setNewListName('');
      setShowNewList(false);
      toast.success('List created.');
    } catch {
      toast.error('Could not create list.');
    } finally {
      setAdding(false);
    }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemName.trim() || !activeListId || adding) return;
    setAdding(true);

    try {
      const res = await fetch(`/api/shopping-lists/${activeListId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ name: newItemName.trim() }),
      });
      const data = await res.json();
      setLists(lists.map((l) => l.id === activeListId ? { ...l, items: [...l.items, ...data.items] } : l));
      setNewItemName('');
    } catch {
      toast.error('Could not add item.');
    } finally {
      setAdding(false);
    }
  }

  async function toggleItem(item: ShoppingItem) {
    const newChecked = !item.isChecked;
    setLists(lists.map((l) => l.id === activeListId ? {
      ...l,
      items: l.items.map((i) => i.id === item.id ? { ...i, isChecked: newChecked } : i),
    } : l));
    await fetch(`/api/shopping-items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ isChecked: newChecked }),
    });
  }

  // Tap item → add to shopping basket.
  function addToBasket(item: ShoppingItem) {
    setBasket([...basket, { name: item.name, genericName: item.genericName || undefined, quantity: item.quantity || undefined }]);
    // Mark as checked on the list.
    if (!item.isChecked) toggleItem(item);
    toast.success(`${item.name} added to basket.`);
  }

  async function deleteItem(itemId: string) {
    setLists(lists.map((l) => l.id === activeListId ? { ...l, items: l.items.filter((i) => i.id !== itemId) } : l));
    await fetch(`/api/shopping-items/${itemId}`, { method: 'DELETE', headers: authHeaders });
  }

  async function deleteList() {
    if (!activeListId) return;
    await fetch(`/api/shopping-lists/${activeListId}`, { method: 'DELETE', headers: authHeaders });
    const remaining = lists.filter((l) => l.id !== activeListId);
    setLists(remaining);
    setActiveListId(remaining[0]?.id || null);
    toast.success('List deleted.');
  }

  // Barcode scanning for shopping.
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
            stopScan();
            handleScannedBarcode(code);
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

  // When a barcode is scanned while shopping, look up the product and add to basket.
  async function handleScannedBarcode(barcode: string) {
    toast.info(`Scanned: ${barcode}. Looking up...`);

    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
      if (!res.ok) throw new Error('Lookup failed.');
      const data = await res.json();

      if (data.status === 1 && data.product) {
        const p = data.product;
        const name = p.product_name || p.generic_name || 'Unknown product';
        const quantity = p.quantity || '';

        // Check if this matches any item on the shopping list.
        const matchingItem = activeList?.items.find((i) => {
          const iName = (i.genericName || i.name).toLowerCase();
          return name.toLowerCase().includes(iName) || iName.includes(name.toLowerCase());
        });

        if (matchingItem && !matchingItem.isChecked) {
          // Tick it off the list.
          toggleItem(matchingItem);
          toast.success(`✓ ${matchingItem.name} — found on your list!`);
        }

        // Add to basket.
        setBasket([...basket, { name, barcode, quantity, genericName: name.toLowerCase() }]);
        toast.success(`${name} added to basket.`);
      } else {
        // Product not found — add with barcode as name.
        setBasket([...basket, { name: `Product ${barcode}`, barcode }]);
        toast.info('Product not found. Added to basket with barcode.');
      }
    } catch {
      toast.info('Could not look up product. Added to basket.');
      setBasket([...basket, { name: `Product ${barcode}`, barcode }]);
    }
  }

  // Confirm basket → move all items to pantry.
  async function confirmBasket() {
    if (basket.length === 0) return;
    setAdding(true);
    toast.info(`Adding ${basket.length} items to pantry...`);

    try {
      for (const item of basket) {
        // Enrich with AI for category + expiry.
        let category = '';
        let expiryDate = '';

        try {
          const enrichRes = await fetch('/api/pantry/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ barcode: item.barcode, name: item.name, quantity: item.quantity, category: '' }),
          });
          if (enrichRes.ok) {
            const enrichData = await enrichRes.json();
            category = enrichData.category || '';
            expiryDate = enrichData.expiryDate || '';
          }
        } catch {}

        await fetch('/api/pantry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            name: item.name,
            quantity: item.quantity || undefined,
            barcode: item.barcode || undefined,
            category: category || undefined,
            expiryDate: expiryDate || undefined,
          }),
        });
      }

      toast.success(`${basket.length} items added to pantry!`);
      setBasket([]);
    } catch {
      toast.error('Could not add some items to pantry.');
    } finally {
      setAdding(false);
    }
  }

  function toggleSection(section: string) {
    const next = new Set(collapsedSections);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    setCollapsedSections(next);
  }

  // Group items by section.
  // Drag-and-drop sensors — require slightly more movement to avoid accidental drags.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Track the order of sections (can be reordered by drag).
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);

  // Update section order when sections change.
  useEffect(() => {
    if (sortedSections.length > 0) {
      const currentSections = sortedSections.map(([s]) => s);
      // Only update if sections changed (not on every render).
      if (JSON.stringify(currentSections) !== JSON.stringify(sectionOrder)) {
        setSectionOrder(currentSections);
      }
    }
  }, [activeList?.items]);

  // Re-sort sections based on user's custom order.
  const customSortedSections = sortedSections.sort((a, b) => {
    const aIdx = sectionOrder.indexOf(a[0]);
    const bIdx = sectionOrder.indexOf(b[0]);
    if (aIdx === -1 && bIdx === -1) return a[1][0]?.sectionOrder - b[1][0]?.sectionOrder || 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sectionOrder.indexOf(active.id as string);
    const newIndex = sectionOrder.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    // Reorder the section order array.
    const newOrder = [...sectionOrder];
    const [moved] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, moved);
    setSectionOrder(newOrder);

    // Persist the new section order to the database (update all items in the moved sections).
    // We update the sectionOrder field on all items in the affected sections.
    // This is a best-effort background save.
    const activeList = lists.find((l) => l.id === activeListId);
    if (activeList) {
      newOrder.forEach((section, idx) => {
        const sectionItems = activeList.items.filter((i) => (i.section || 'Other') === section);
        sectionItems.forEach((item) => {
          fetch(`/api/shopping-items/${item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ sectionOrder: idx + 1 }),
          }).catch(() => {});
        });
      });
    }

    toast.success('Section order saved.');
  }

  const groupedItems = activeList?.items.reduce((acc, item) => {
    const section = item.section || 'Other';
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {} as Record<string, ShoppingItem[]>) || {};

  const sortedSections = Object.entries(groupedItems).sort(([, a], [, b]) => a[0]?.sectionOrder - b[0]?.sectionOrder || 0);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 sm:h-7 sm:w-7 text-primary" />
            Shopping
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{lists.length} list{lists.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {activeListId && (
            <Button onClick={startBarcodeScan} variant="outline" size="icon" className="h-9 w-9" disabled={scanning} aria-label="Scan barcode">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            </Button>
          )}
          <Button onClick={() => setShowNewList(!showNewList)} variant="outline" size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New List</span>
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
            <p className="text-xs text-muted-foreground text-center mt-2">Scan a product barcode to add to basket...</p>
          </CardContent>
        </Card>
      )}

      {/* New list form */}
      {showNewList && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex gap-2">
              <Input placeholder="List name (e.g. Tesco, Saturday Market)..." value={newListName} onChange={(e) => setNewListName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createList()} />
              <Button size="sm" onClick={createList} disabled={adding}>Create</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List tabs */}
      {lists.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
          {lists.map((list) => (
            <button key={list.id} onClick={() => setActiveListId(list.id)} className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${activeListId === list.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              {list.name} ({list.items.filter((i) => !i.isChecked).length})
            </button>
          ))}
        </div>
      )}

      {/* Active list */}
      {activeList ? (
        <>
          {/* Add item */}
          <form onSubmit={addItem} className="flex gap-2">
            <Input placeholder="Add item..." value={newItemName} onChange={(e) => setNewItemName(e.target.value)} disabled={adding} className="flex-1" />
            <Button type="submit" size="icon" disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </form>

          {/* Items grouped by collapsible, drag-and-drop sections */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleSectionDragEnd}
          >
            <SortableContext items={customSortedSections.map(([s]) => s)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {customSortedSections.map(([section, items]) => (
                  <SortableSection
                    key={section}
                    section={section}
                    items={items}
                    isCollapsed={collapsedSections.has(section)}
                    onToggle={() => toggleSection(section)}
                    onItemToggle={toggleItem}
                    onAddToBasket={addToBasket}
                    onDeleteItem={deleteItem}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Delete list */}
          <Button variant="ghost" size="sm" onClick={deleteList} className="text-destructive hover:text-destructive gap-1.5">
            <Trash2 className="h-3.5 w-3.5" />
            Delete list
          </Button>
        </>
      ) : (
        <Card className="p-12 text-center">
          <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No shopping lists yet. Create one to get started.</p>
        </Card>
      )}

      {/* Shopping basket — floating at bottom */}
      {basket.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-md shadow-lg">
          <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBasket className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Basket ({basket.length})</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setBasket([])} className="text-xs">Clear</Button>
                <Button size="sm" onClick={confirmBasket} disabled={adding} className="gap-1.5">
                  {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                  Add to Pantry
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto custom-scrollbar">
              {basket.map((item, i) => (
                <Badge key={i} variant="secondary" className="text-xs gap-1">
                  {item.name}
                  <button onClick={() => setBasket(basket.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Sortable section component — can be dragged to reorder.
interface SortableSectionProps {
  section: string;
  items: ShoppingItem[];
  isCollapsed: boolean;
  onToggle: () => void;
  onItemToggle: (item: ShoppingItem) => void;
  onAddToBasket: (item: ShoppingItem) => void;
  onDeleteItem: (id: string) => void;
}

function SortableSection({
  section,
  items,
  isCollapsed,
  onToggle,
  onItemToggle,
  onAddToBasket,
  onDeleteItem,
}: SortableSectionProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const uncheckedCount = items.filter((i) => !i.isChecked).length;

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-1">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground touch-none"
          aria-label="Drag to reorder section"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          className="flex items-center gap-2 py-1.5 text-left flex-1"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{section}</span>
          <Badge variant="secondary" className="text-xs h-5 px-1.5">{uncheckedCount}</Badge>
        </button>
      </div>

      {!isCollapsed && (
        <div className="space-y-1 ml-10">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-border/60 hover:bg-muted/30 transition-colors">
              <Checkbox checked={item.isChecked} onCheckedChange={() => onItemToggle(item)} />
              <button
                onClick={() => onAddToBasket(item)}
                className={`flex-1 text-left text-sm ${item.isChecked ? 'line-through text-muted-foreground' : ''}`}
              >
                {item.name}
                {item.quantity && <span className="text-muted-foreground ml-2">{item.quantity}</span>}
              </button>
              <button onClick={() => onDeleteItem(item.id)} className="text-muted-foreground hover:text-destructive p-1">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
