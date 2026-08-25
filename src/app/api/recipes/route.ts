/**
 * GET  /api/recipes  — list the current user's saved recipes.
 * POST /api/recipes  — create a new recipe manually (no extraction).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';
import type { RecipeIngredient, RecipeInstruction, RecipeMetadata, RecipeFlag } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

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
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.title || typeof body.title !== 'string') {
    return NextResponse.json({ error: 'Missing "title" field.' }, { status: 400 });
  }

  try {
    const recipe = await db.recipe.create({
      data: {
        userId: user.id,
        title: body.title,
        description: body.description || null,
        ingredients: (body.ingredients || []) as never,
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
      },
    });

    return NextResponse.json({ recipe: { id: recipe.id } }, { status: 201 });
  } catch (err) {
    console.error('Failed to create recipe:', err);
    return NextResponse.json(
      { error: 'Could not save recipe to the database.' },
      { status: 500 },
    );
  }
}
