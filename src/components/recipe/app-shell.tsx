'use client';

import { useEffect, useState } from 'react';
import { useNetlifyIdentity } from '@/hooks/use-netlify-identity';
import { useStore } from '@/lib/store';
import { useSettings } from '@/lib/settings';
import { Navbar } from './navbar';
import { ExtractorView } from './extractor-view';
import { RecipeBox } from './recipe-box';
import { RecipeDetail } from './recipe-detail';
import { PantryView } from './pantry-view';
import { ShoppingListView } from './shopping-list-view';
import { Footer } from './footer';
import { SettingsModal } from './settings-modal';

export function AppShell() {
  const { user, token, isReady, login, signup, logout } = useNetlifyIdentity();
  const { view, setAuthToken, fetchRecipes } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { loadFromStorage, syncFromServer, syncToServer } = useSettings();
  const [pantryCount, setPantryCount] = useState(0);
  const [shoppingCount, setShoppingCount] = useState(0);

  // Load settings from localStorage on mount.
  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  // Sync the auth token to the store whenever it changes.
  useEffect(() => {
    setAuthToken(token);
  }, [token, setAuthToken]);

  // When the user logs in, sync settings from the server.
  useEffect(() => {
    if (user && token) {
      syncFromServer(token);
      fetchRecipes();
    }
  }, [user, token, syncFromServer, fetchRecipes]);

  // Fetch pantry + shopping counts for nav badges.
  useEffect(() => {
    if (token) {
      const headers = { Authorization: `Bearer ${token}` };
      Promise.all([
        fetch('/api/pantry', { headers }).then((r) => r.json()).catch(() => ({ items: [] })),
        fetch('/api/shopping-lists', { headers }).then((r) => r.json()).catch(() => ({ lists: [] })),
      ]).then(([pantryData, listsData]) => {
        setPantryCount(pantryData.items?.length || 0);
        const allItems = (listsData.lists || []).flatMap((l: { items: unknown[] }) => l.items || []);
        setShoppingCount(allItems.filter((i: { isChecked: boolean }) => !(i as { isChecked: boolean }).isChecked).length);
      });
    }
  }, [token]);

  // Listen for settings changes and sync to server.
  useEffect(() => {
    const handleSettingsChange = () => {
      if (token) {
        syncToServer(token);
      }
    };
    window.addEventListener('settings-changed', handleSettingsChange);
    return () => window.removeEventListener('settings-changed', handleSettingsChange);
  }, [token, syncToServer]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar
        user={user}
        isReady={isReady}
        onLogin={login}
        onSignup={signup}
        onLogout={logout}
        onOpenSettings={() => setSettingsOpen(true)}
        pantryCount={pantryCount}
        shoppingCount={shoppingCount}
      />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {view.name === 'extract' && <ExtractorView />}
        {view.name === 'box' && <RecipeBox />}
        {view.name === 'detail' && <RecipeDetail />}
        {view.name === 'pantry' && <PantryView />}
        {view.name === 'shopping' && <ShoppingListView />}
      </main>
      <Footer />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
