/**
 * GET /api/recipes/[id]/public
 *
 * Returns a recipe without authentication — for public sharing.
 * Only returns the recipe data (no user info, no raw source data).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { RecipeIngredient, RecipeInstruction, RecipeMetadata, RecipeFlag } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    const recipe = await db.recipe.findUnique({ where: { id } });
    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 });
    }

    // Return only the public-safe fields (no userId, no raw source data).
    return NextResponse.json({
      recipe: {
        id: recipe.id,
        title: recipe.title,
        description: recipe.description,
        ingredients: recipe.ingredients as RecipeIngredient[],
        instructions: recipe.instructions as RecipeInstruction[],
        metadata: recipe.metadata as RecipeMetadata[],
        flags: recipe.flags as RecipeFlag[],
        sourceUrl: recipe.sourceUrl,
        imageUrl: recipe.imageUrl,
        tags: recipe.tags as string[] | null,
        createdAt: recipe.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('Failed to get public recipe:', err);
    return NextResponse.json({ error: 'Database unavailable.' }, { status: 500 });
  }
}
