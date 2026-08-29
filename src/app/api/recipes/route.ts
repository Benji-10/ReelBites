/**
 * GET  /api/recipes  — list the current user's saved recipes.
 * POST /api/recipes  — create a new recipe manually (no extraction).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb, migrateGuestRecipes } from '@/lib/auth';
import { canonicalizeNames } from '@/lib/canonicalize';
import type { RecipeIngredient, RecipeInstruction, RecipeMetadata, RecipeFlag } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  // If the user is logged in (not a guest), migrate any guest recipes
  // to their real account before fetching.
  await migrateGuestRecipes(user);

  try {
    const recipes = await db.recipe.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    const serialized = recipes.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      ingredients: r.ingredients as RecipeIngredient[],
      instructions: r.instructions as RecipeInstruction[],
      metadata: r.metadata as RecipeMetadata[],
      flags: r.flags as RecipeFlag[],
      sourceUrl: r.sourceUrl,
      sourceCaption: r.sourceCaption,
      sourceComments: r.sourceComments,
      transcript: r.transcript,
      ocrText: r.ocrText,
      imageUrl: r.imageUrl,
      sourceVideoUrl: r.sourceVideoUrl,
      isFavorite: r.isFavorite,
      tags: r.tags as string[] | null,
      collection: r.collection,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return NextResponse.json({ recipes: serialized });
  } catch (err) {
    console.error('Failed to list recipes:', err);
    return NextResponse.json({ recipes: [], error: 'Database unavailable.' });
  }
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  let body: {
    title: string;
    description?: string;
    ingredients?: RecipeIngredient[];
    instructions?: RecipeInstruction[];
    metadata?: RecipeMetadata[];
    flags?: RecipeFlag[];
    sourceUrl?: string;
    sourceCaption?: string;
    sourceComments?: unknown;
    transcript?: string;
    ocrText?: string;
    imageUrl?: string;
    sourceVideoUrl?: string;
    isFavorite?: boolean;
    tags?: string[];
    collection?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.title || typeof body.title !== 'string') {
    return NextResponse.json({ error: 'Missing "title" field.' }, { status: 400 });
  }

  // Canonicalize ingredients if any are missing canonicalName.
  // This ensures new recipes are immediately matchable against the pantry.
  let ingredients = body.ingredients || [];
  if (ingredients.length > 0) {
    const needsCanonicalization = ingredients.some((ing) => !ing.canonicalName);
    if (needsCanonicalization) {
      const names = ingredients.map((ing) => ing.name);
      const canonicalMap = await canonicalizeNames(names);
      ingredients = ingredients.map((ing) => {
        const c = canonicalMap.get(ing.name);
        if (c) {
          return {
            ...ing,
            canonicalName: c.canonical_name,
            canonicalAncestors: c.ancestors.length > 0 ? c.ancestors : null,
            canonicalAttributes: Object.keys(c.attributes).length > 0 ? c.attributes : null,
            canonicalHardAttributeKeys: c.hardAttributeKeys.length > 0 ? c.hardAttributeKeys : null,
          };
        }
        return ing;
      });
    }
  }

  try {
    const recipe = await db.recipe.create({
      data: {
        userId: user.id,
        title: body.title,
        description: body.description || null,
        ingredients: ingredients as never,
        instructions: (body.instructions || []) as never,
        metadata: (body.metadata || []) as never,
        flags: (body.flags || []) as never,
        sourceUrl: body.sourceUrl || null,
        sourceCaption: body.sourceCaption || null,
        sourceComments: (body.sourceComments || null) as never,
        transcript: body.transcript || null,
        ocrText: body.ocrText || null,
        imageUrl: body.imageUrl || null,
        sourceVideoUrl: body.sourceVideoUrl || null,
        isFavorite: body.isFavorite || false,
        tags: (body.tags || null) as never,
        collection: body.collection || null,
      },
    });

    return NextResponse.json({ recipe: { id: recipe.id } }, { status: 201 });
  } catch (err) {
    console.error('Failed to create recipe:', err);
    return NextResponse.json(
      { error: 'Could not save recipe to the database.', details: (err as Error).message },
      { status: 500 },
    );
  }
}
