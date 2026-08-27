'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/recipe/app-shell';

export default function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  return <AppShell viewName="detail" recipeId={recipeId} />;
}
