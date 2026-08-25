'use client';

import { ChefHat, Sparkles, BookOpen, Sun, Moon, Palette, LogOut } from 'lucide-react';
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

interface NavbarProps {
  user: { email: string; user_metadata?: { full_name?: string } } | null;
  isReady: boolean;
  onLogin: () => void;
  onSignup: () => void;
  onLogout: () => void;
}

export function Navbar({ user, isReady, onLogin, onSignup, onLogout }: NavbarProps) {
  const { view, setView, recipes } = useStore();
  const { theme, toggleTheme, colorTheme, setColorTheme } = useTheme();

  const colorThemes = [
    { key: 'default', label: 'Amber', color: 'bg-amber-500' },
    { key: 'mocha', label: 'Mocha', color: 'bg-amber-800' },
    { key: 'forest', label: 'Forest', color: 'bg-green-600' },
    { key: 'berry', label: 'Berry', color: 'bg-pink-500' },
  ] as const;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Logo */}
          <button
            onClick={() => setView({ name: 'extract' })}
            className="flex items-center gap-2 font-bold text-lg shrink-0 hover:opacity-80 transition-opacity"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ChefHat className="h-5 w-5" />
            </div>
            <span className="hidden sm:inline">RealBites</span>
          </button>

          {/* Nav */}
          <nav className="flex items-center gap-1">
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

          {/* Right side */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Theme toggle */}
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>

            {/* Color theme picker */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Palette className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Color Theme</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {colorThemes.map((t) => (
                  <DropdownMenuItem
                    key={t.key}
                    onClick={() => setColorTheme(t.key)}
                    className="gap-2 cursor-pointer"
                  >
                    <div className={`h-4 w-4 rounded-full ${t.color}`} />
                    {t.label}
                    {colorTheme === t.key && <span className="ml-auto text-xs">✓</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Auth */}
            {isReady && user ? (
              <Button variant="ghost" size="icon" onClick={onLogout} className="h-9 w-9">
                <LogOut className="h-4 w-4" />
              </Button>
            ) : isReady && !user ? (
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={onLogin} className="text-xs">
                  Log in
                </Button>
                <Button size="sm" onClick={onSignup} className="text-xs">
                  Sign up
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
