'use client';

import { ChefHat, Sparkles, BookOpen, LogOut, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/lib/store';

interface NavbarProps {
  user: { email: string; user_metadata?: { full_name?: string } } | null;
  isReady: boolean;
  onLogin: () => void;
  onSignup: () => void;
  onLogout: () => void;
}

export function Navbar({ user, isReady, onLogin, onSignup, onLogout }: NavbarProps) {
  const { view, setView, recipes } = useStore();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Logo */}
          <button
            onClick={() => setView({ name: 'extract' })}
            className="flex items-center gap-2 font-bold text-lg shrink-0 hover:opacity-80 transition-opacity"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ChefHat className="h-5 w-5" />
            </div>
            <span className="hidden sm:inline">Reel Recipes</span>
          </button>

          {/* Nav links */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <Button
              variant={view.name === 'extract' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView({ name: 'extract' })}
              className="gap-1.5"
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">Extract</span>
            </Button>
            <Button
              variant={view.name === 'box' || view.name === 'detail' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView({ name: 'box' })}
              className="gap-1.5"
            >
              <BookOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Recipe Box</span>
              {recipes.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {recipes.length}
                </Badge>
              )}
            </Button>
          </nav>

          {/* Auth */}
          <div className="flex items-center gap-2 shrink-0">
            {isReady && user ? (
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
                  <UserIcon className="h-4 w-4" />
                  <span className="max-w-[150px] truncate">
                    {user.user_metadata?.full_name || user.email}
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={onLogout} className="gap-1.5">
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Logout</span>
                </Button>
              </div>
            ) : isReady && !user ? (
              <>
                <Button variant="ghost" size="sm" onClick={onLogin}>
                  Log in
                </Button>
                <Button size="sm" onClick={onSignup}>
                  Sign up
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
