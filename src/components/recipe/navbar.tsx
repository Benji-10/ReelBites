'use client';

import { ChefHat, Sparkles, BookOpen, Sun, Moon, Palette, LogOut, Settings, Package, ShoppingCart, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useStore } from '@/lib/store';
import { useTheme } from '@/components/theme-provider';

type ViewName = 'extract' | 'box' | 'detail' | 'pantry' | 'shopping';

interface NavbarProps {
  user: { email: string; user_metadata?: { full_name?: string } } | null;
  isReady: boolean;
  onLogin: () => void;
  onSignup: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onNavigate: (view: ViewName) => void;
  currentView: string;
  pantryCount?: number;
  shoppingCount?: number;
}

export function Navbar({ user, isReady, onLogin, onSignup, onLogout, onOpenSettings, onNavigate, currentView, pantryCount = 0, shoppingCount = 0 }: NavbarProps) {
  const { recipes } = useStore();
  const { theme, toggleTheme, colorTheme, setColorTheme } = useTheme();

  const colorThemes = [
    { key: 'default', label: 'Amber', color: 'bg-amber-500' },
    { key: 'mocha', label: 'Mocha', color: 'bg-amber-800' },
    { key: 'forest', label: 'Forest', color: 'bg-green-600' },
    { key: 'berry', label: 'Berry', color: 'bg-pink-500' },
  ] as const;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-3 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-2">
          {/* Logo */}
          <button
            onClick={() => onNavigate('extract')}
            className="flex items-center gap-2 font-bold text-lg shrink-0 hover:opacity-80 transition-opacity"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ChefHat className="h-5 w-5" />
            </div>
            <span className="hidden sm:inline">RealBites</span>
          </button>

          {/* Main nav */}
          <nav className="flex items-center gap-1 shrink-0">
            <Button
              variant={currentView === 'extract' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onNavigate('extract')}
              className="gap-1.5 px-2 sm:px-3"
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">Import</span>
            </Button>
            <Button
              variant={currentView === 'box' || currentView === 'detail' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onNavigate('box')}
              className="gap-1.5 px-2 sm:px-3"
            >
              <BookOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Recipes</span>
              {recipes.length > 0 && (
                <Badge variant="secondary" className="hidden sm:flex ml-0.5 h-5 px-1.5 text-xs">{recipes.length}</Badge>
              )}
            </Button>
            <Button
              variant={currentView === 'pantry' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onNavigate('pantry')}
              className="gap-1.5 px-2 sm:px-3"
            >
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">Pantry</span>
              {pantryCount > 0 && (
                <Badge variant="secondary" className="hidden sm:flex ml-0.5 h-5 px-1.5 text-xs">{pantryCount}</Badge>
              )}
            </Button>
            <Button
              variant={currentView === 'shopping' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onNavigate('shopping')}
              className="gap-1.5 px-2 sm:px-3"
            >
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">Shopping</span>
              {shoppingCount > 0 && (
                <Badge variant="secondary" className="hidden sm:flex ml-0.5 h-5 px-1.5 text-xs">{shoppingCount}</Badge>
              )}
            </Button>
          </nav>

          {/* Right side controls */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Theme toggle — always visible */}
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>

            {/* Settings button — always visible */}
            {isReady && (
              <Button variant="ghost" size="icon" onClick={onOpenSettings} className="h-9 w-9">
                <Settings className="h-4 w-4" />
              </Button>
            )}

            {/* Menu dropdown — color theme + logout (saves space on mobile) */}
            {isReady && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9">
                    <Menu className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {user && (
                    <>
                      <DropdownMenuLabel className="text-xs text-muted-foreground truncate">
                        {user.email}
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuLabel>Color Theme</DropdownMenuLabel>
                  {colorThemes.map((t) => (
                    <DropdownMenuItem key={t.key} onClick={() => setColorTheme(t.key)} className="gap-2 cursor-pointer">
                      <div className={`h-4 w-4 rounded-full ${t.color}`} />
                      {t.label}
                      {colorTheme === t.key && <span className="ml-auto text-xs">✓</span>}
                    </DropdownMenuItem>
                  ))}
                  {user && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onLogout} className="gap-2 cursor-pointer text-destructive">
                        <LogOut className="h-4 w-4" />
                        Log out
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Sign up button for non-logged-in users */}
            {isReady && !user && (
              <Button size="sm" onClick={onSignup} className="text-xs px-3">Sign up</Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
