'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, ShoppingCart, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

interface ShoppingItem {
  id: string;
  name: string;
  quantity: string | null;
  section: string | null;
  isChecked: boolean;
  recipeId: string | null;
}

interface ShoppingList {
  id: string;
  name: string;
  storeName: string | null;
  items: ShoppingItem[];
}

export function ShoppingListView() {
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newListName, setNewListName] = useState('');
  const [showNewList, setShowNewList] = useState(false);
  const authToken = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch('/api/shopping-lists', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
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
    if (!newListName.trim()) return;
    try {
      const res = await fetch('/api/shopping-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
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
    }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemName.trim() || !activeListId) return;

    try {
      const res = await fetch(`/api/shopping-lists/${activeListId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ name: newItemName.trim() }),
      });
      const data = await res.json();

      setLists(lists.map((l) => l.id === activeListId ? { ...l, items: [...l.items, ...data.items] } : l));
      setNewItemName('');
    } catch {
      toast.error('Could not add item.');
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
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify({ isChecked: newChecked }),
    });
  }

  async function deleteItem(itemId: string) {
    setLists(lists.map((l) => l.id === activeListId ? { ...l, items: l.items.filter((i) => i.id !== itemId) } : l));
    await fetch(`/api/shopping-items/${itemId}`, {
      method: 'DELETE',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
  }

  async function deleteList() {
    if (!activeListId) return;
    await fetch(`/api/shopping-lists/${activeListId}`, {
      method: 'DELETE',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    const remaining = lists.filter((l) => l.id !== activeListId);
    setLists(remaining);
    setActiveListId(remaining[0]?.id || null);
    toast.success('List deleted.');
  }

  // Group items by section.
  const groupedItems = activeList?.items.reduce((acc, item) => {
    const section = item.section || 'Other';
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {} as Record<string, ShoppingItem[]>) || {};

  const sortedSections = Object.entries(groupedItems).sort(([, a], [, b]) => {
    const aOrder = a[0]?.sectionOrder || 99;
    const bOrder = b[0]?.sectionOrder || 99;
    return aOrder - bOrder;
  });

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 sm:h-7 sm:w-7 text-primary" />
            Shopping Lists
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{lists.length} list{lists.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => setShowNewList(!showNewList)} variant="outline" size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New List</span>
        </Button>
      </div>

      {/* New list form */}
      {showNewList && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex gap-2">
              <Input placeholder="List name (e.g. Tesco, Saturday Market)..." value={newListName} onChange={(e) => setNewListName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createList()} />
              <Button size="sm" onClick={createList}>Create</Button>
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
            <Input placeholder="Add item..." value={newItemName} onChange={(e) => setNewItemName(e.target.value)} className="flex-1" />
            <Button type="submit" size="icon"><Plus className="h-4 w-4" /></Button>
          </form>

          {/* Items grouped by section */}
          <div className="space-y-4">
            {sortedSections.map(([section, items]) => (
              <div key={section}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{section}</h3>
                <div className="space-y-1">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-border/60 hover:bg-muted/30 transition-colors">
                      <Checkbox checked={item.isChecked} onCheckedChange={() => toggleItem(item)} />
                      <span className={`flex-1 text-sm ${item.isChecked ? 'line-through text-muted-foreground' : ''}`}>
                        {item.name}
                        {item.quantity && <span className="text-muted-foreground ml-2">{item.quantity}</span>}
                      </span>
                      <button onClick={() => deleteItem(item.id)} className="text-muted-foreground hover:text-destructive p-1">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

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
    </div>
  );
}
