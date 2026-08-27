'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
import type { AppView } from '@/lib/types';

interface AppShellProps {
  initialView?: AppView;
}

export function AppShell({ initialView }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, isReady, login, signup, logout } = useNetlifyIdentity();
  const { setAuthToken, fetchRecipes } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { loadFromStorage, syncFromServer, syncToServer } = useSettings();
  const [pantryCount, setPantryCount] = useState(0);
  const [shoppingCount, setShoppingCount] = useState(0);

  // Determine the current view from the route.
  const view: AppView = initialView || (() => {
    if (pathname === '/pantry') return { name: 'pantry' };
    if (pathname === '/shopping') return { name: 'shopping' };
    if (pathname === '/recipes') return { name: 'box' };
    if (pathname?.startsWith('/recipes/')) {
      const id = pathname.split('/recipes/')[1];
      return { name: 'detail', recipeId: id };
    }
    return { name: 'extract' };
  })();

  // Navigation function — uses router.push.
  const navigate = (v: AppView) => {
    if (v.name === 'extract') router.push('/');
    else if (v.name === 'box') router.push('/recipes');
    else if (v.name === 'detail') router.push(`/recipes/${v.recipeId}`);
    else if (v.name === 'pantry') router.push('/pantry');
    else if (v.name === 'shopping') router.push('/shopping');
  };

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    setAuthToken(token);
  }, [token, setAuthToken]);

  useEffect(() => {
    if (user && token) {
      syncFromServer(token);
      fetchRecipes();
    }
  }, [user, token, syncFromServer, fetchRecipes]);

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

  useEffect(() => {
    const handleSettingsChange = () => {
      if (token) syncToServer(token);
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
        onNavigate={navigate}
        currentView={view.name}
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
