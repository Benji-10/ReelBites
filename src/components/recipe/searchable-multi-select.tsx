'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, X, Check, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface SearchableMultiSelectProps {
  options: string[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  placeholder: string;
  searchPlaceholder?: string;
  maxDisplay?: number; // max items to show in dropdown before "+N more"
  label?: string;
  icon?: React.ReactNode;
  capitalize?: boolean;
}

export function SearchableMultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  searchPlaceholder = 'Search...',
  maxDisplay = 100,
  label,
  icon,
  capitalize = false,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return options;
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [options, search]);

  function toggle(option: string) {
    const next = new Set(selected);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    onChange(next);
  }

  function remove(option: string) {
    const next = new Set(selected);
    next.delete(option);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{label}</span>
          {selected.size > 0 && (
            <Badge variant="secondary" className="text-xs">{selected.size} selected</Badge>
          )}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between h-9">
            <span className="text-muted-foreground truncate">
              {selected.size === 0 ? placeholder : `${selected.size} selected`}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          {/* Search input inside the dropdown */}
          <div className="p-2 border-b sticky top-0 bg-popover z-10">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-sm"
                autoFocus
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">
                No matches for &ldquo;{search}&rdquo;
              </p>
            )}
            {filtered.slice(0, maxDisplay).map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(opt)}
                  onCheckedChange={() => toggle(opt)}
                />
                <span className={`text-sm ${capitalize ? 'capitalize' : ''}`}>{opt}</span>
              </label>
            ))}
            {filtered.length > maxDisplay && (
              <p className="text-xs text-muted-foreground text-center py-2">
                +{filtered.length - maxDisplay} more — refine your search to see them
              </p>
            )}
          </div>

          {/* Footer with clear button */}
          {selected.size > 0 && (
            <div className="p-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => { onChange(new Set()); }}
              >
                Clear all ({selected.size})
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Selected badges */}
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1">
          {Array.from(selected).map((opt) => (
            <Badge key={opt} variant="secondary" className={`text-xs gap-1 ${capitalize ? 'capitalize' : ''}`}>
              {opt}
              <button onClick={() => remove(opt)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
