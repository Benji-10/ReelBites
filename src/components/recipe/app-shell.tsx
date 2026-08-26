'use client';

import { useEffect, useState } from 'react';
import { useNetlifyIdentity } from '@/hooks/use-netlify-identity';
import { useStore } from '@/lib/store';
import { useSettings } from '@/lib/settings';
import { Navbar } from './navbar';
import { ExtractorView } from './extractor-view';
import { RecipeBox } from './recipe-box';
import { RecipeDetail } from './recipe-detail';
import { Footer } from './footer';
import { SettingsModal } from './settings-modal';

export function AppShell() {
  const { user, token, isReady, login, signup, logout } = useNetlifyIdentity();
  const { view, setAuthToken, fetchRecipes } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { loadFromStorage, syncFromServer, syncToServer } = useSettings();

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
      />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {view.name === 'extract' && <ExtractorView />}
        {view.name === 'box' && <RecipeBox />}
        {view.name === 'detail' && <RecipeDetail />}
      </main>
      <Footer />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
