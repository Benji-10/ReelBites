'use client';

import { AppShell } from '@/components/recipe/app-shell';
import { useSearchParams } from 'next/navigation';

export default function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // We use a wrapper to unwrap the params promise.
  return <RecipeDetailWrapper params={params} />;
}

import { useEffect, useState } from 'react';

function RecipeDetailWrapper({ params }: { params: Promise<{ id: string }> }) {
  const [recipeId, setRecipeId] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setRecipeId(p.id));
  }, [params]);

  if (!recipeId) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return <AppShell initialView={{ name: 'detail', recipeId }} />;
}
