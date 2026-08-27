/**
 * useNetlifyIdentity — React hook for Netlify Identity auth.
 *
 * Loads the netlify-identity-widget script and exposes:
 *   - user: the current user (or null)
 *   - token: the JWT access token (for API calls)
 *   - login: opens the login modal
 *   - signup: opens the signup modal
 *   - logout: logs out
 *   - isReady: whether the widget has initialized
 *
 * In local dev (no Netlify Identity), the hook returns a null user and
 * no-op login/logout. The API routes fall back to a dev user in this case.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';

interface NetlifyIdentityUser {
  id: string;
  email: string;
  user_metadata: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
  };
  token: {
    access_token: string;
    expires_at: number;
    refresh_token: string;
    token_type: string;
  };
}

interface NetlifyIdentityWidget {
  init: (siteUrl: string) => void;
  open: (mode?: 'login' | 'signup') => void;
  close: () => void;
  currentUser: () => NetlifyIdentityUser | null;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback: (...args: unknown[]) => void) => void;
  store: { get: () => unknown };
}

declare global {
  interface Window {
    netlifyIdentity?: NetlifyIdentityWidget;
  }
}

const WIDGET_URL = 'https://identity.netlify.com/v1/netlify-identity-widget.js';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export interface UseNetlifyIdentityResult {
  user: NetlifyIdentityUser | null;
  token: string | null;
  isReady: boolean;
  login: () => void;
  signup: () => void;
  logout: () => void;
}

export function useNetlifyIdentity(): UseNetlifyIdentityResult {
  const [user, setUser] = useState<NetlifyIdentityUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    loadScript(WIDGET_URL)
      .then(() => {
        if (!mounted || !window.netlifyIdentity) return;

        // Initialize with the current site URL.
        const siteUrl =
          process.env.NEXT_PUBLIC_SITE_URL ||
          (typeof window !== 'undefined' ? window.location.origin : '');
        try {
          window.netlifyIdentity.init(siteUrl);
        } catch {
          // init may fail on localhost — that's fine.
        }

        setIsReady(true);

        // Check for existing session.
        const currentUser = window.netlifyIdentity.currentUser();
        if (currentUser) {
          setUser(currentUser);
        }

        // Listen for auth events.
        const onLogin = (u: unknown) => {
          setUser(u as NetlifyIdentityUser);
          window.netlifyIdentity?.close();
        };
        const onLogout = () => setUser(null);

        window.netlifyIdentity.on('login', onLogin);
        window.netlifyIdentity.on('logout', onLogout);
      })
      .catch((err) => {
        console.warn('Netlify Identity widget failed to load:', err);
        // In dev without network access, just mark as ready with no user.
        setIsReady(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(() => {
    window.netlifyIdentity?.open('login');
  }, []);

  const signup = useCallback(() => {
    window.netlifyIdentity?.open('signup');
  }, []);

  const logout = useCallback(() => {
    // The netlify-identity-widget doesn't have a simple logout() method.
    // The safest approach is to clear the local storage and reload.
    try {
      if (typeof window !== 'undefined') {
        // Remove the gotrue-js stored session.
        localStorage.removeItem('netlify-user');
        localStorage.removeItem('gotrue-js');
        // The widget stores its state under a key starting with 'netlify-site'
        // — clear all such keys.
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith('netlify') || key.startsWith('gotrue')) {
            localStorage.removeItem(key);
          }
        });
      }
    } catch {
      // Best-effort.
    }
    setUser(null);
    // Reload to clear any cached state.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  const token = user?.token?.access_token ?? null;

  return { user, token, isReady, login, signup, logout };
}
