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

type ViewName = 'extract' | 'box' | 'detail' | 'pantry' | 'shopping';

interface AppShellProps {
  viewName?: ViewName;
  recipeId?: string;
}

export function AppShell({ viewName, recipeId }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, isReady, login, signup, logout } = useNetlifyIdentity();
  const { setAuthToken, fetchRecipes } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { loadFromStorage, syncFromServer, syncToServer } = useSettings();
  const [pantryCount, setPantryCount] = useState(0);
  const [shoppingCount, setShoppingCount] = useState(0);

  // Determine the current view: use prop, then fall back to pathname.
  const currentView: ViewName = viewName || (() => {
    if (pathname === '/pantry') return 'pantry';
    if (pathname === '/shopping') return 'shopping';
    if (pathname === '/recipes') return 'box';
    if (pathname?.startsWith('/recipes/')) return 'detail';
    return 'extract';
  })();

  // Get recipeId from prop or URL.
  const currentRecipeId = recipeId || (pathname?.startsWith('/recipes/') ? pathname.split('/recipes/')[1] : null);

  function navigate(view: ViewName) {
    if (view === 'extract') router.push('/');
    else if (view === 'box') router.push('/recipes');
    else if (view === 'pantry') router.push('/pantry');
    else if (view === 'shopping') router.push('/shopping');
  }

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
        currentView={currentView}
        pantryCount={pantryCount}
        shoppingCount={shoppingCount}
      />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {currentView === 'extract' && <ExtractorView />}
        {currentView === 'box' && <RecipeBox />}
        {currentView === 'detail' && <RecipeDetail key={currentRecipeId} />}
        {currentView === 'pantry' && <PantryView />}
        {currentView === 'shopping' && <ShoppingListView />}
      </main>
      <Footer />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
