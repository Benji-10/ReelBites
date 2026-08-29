/**
 * GET    /api/recipes/:id  — get a single recipe.
 * PUT    /api/recipes/:id  — update a recipe (full or partial).
 * DELETE /api/recipes/:id  — delete a recipe.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';
import { canonicalizeNames } from '@/lib/canonicalize';
import type { RecipeIngredient, RecipeInstruction, RecipeMetadata, RecipeFlag } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = getUserFromRequest(request);

  const { id } = await params;

  try {
    const recipe = await db.recipe.findUnique({ where: { id } });
    if (!recipe || recipe.userId !== user.id) {
      return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 });
    }

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
        sourceCaption: recipe.sourceCaption,
        sourceComments: recipe.sourceComments,
        transcript: recipe.transcript,
        ocrText: recipe.ocrText,
        imageUrl: recipe.imageUrl,
        sourceVideoUrl: recipe.sourceVideoUrl,
        isFavorite: recipe.isFavorite,
        tags: recipe.tags as string[] | null,
        collection: recipe.collection,
        createdAt: recipe.createdAt.toISOString(),
        updatedAt: recipe.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('Failed to get recipe:', err);
    return NextResponse.json({ error: 'Database unavailable.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = getUserFromRequest(request);

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const existing = await db.recipe.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 });
    }

    const allowedFields = [
      'title', 'description', 'ingredients', 'instructions',
      'metadata', 'flags', 'sourceUrl', 'sourceCaption', 'sourceComments',
      'transcript', 'ocrText', 'imageUrl', 'sourceVideoUrl',
      'isFavorite', 'tags', 'collection',
    ];

    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        data[field] = body[field];
      }
    }

    // If ingredients are being updated, canonicalize any that are missing canonicalName.
    // This handles manual edits where the user adds/changes ingredients.
    if (Array.isArray(data.ingredients) && data.ingredients.length > 0) {
      const ingredients = data.ingredients as RecipeIngredient[];
      const needsCanonicalization = ingredients.some((ing) => !ing.canonicalName);
      if (needsCanonicalization) {
        const names = ingredients.map((ing) => ing.name);
        const canonicalMap = await canonicalizeNames(names);
        data.ingredients = ingredients.map((ing) => {
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

    const updated = await db.recipe.update({
      where: { id },
      data: data as never,
    });

    return NextResponse.json({
      recipe: {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        ingredients: updated.ingredients as RecipeIngredient[],
        instructions: updated.instructions as RecipeInstruction[],
        metadata: updated.metadata as RecipeMetadata[],
        flags: updated.flags as RecipeFlag[],
        sourceUrl: updated.sourceUrl,
        sourceCaption: updated.sourceCaption,
        sourceComments: updated.sourceComments,
        transcript: updated.transcript,
        ocrText: updated.ocrText,
        imageUrl: updated.imageUrl,
        sourceVideoUrl: updated.sourceVideoUrl,
        isFavorite: updated.isFavorite,
        tags: updated.tags as string[] | null,
        collection: updated.collection,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('Failed to update recipe:', err);
    return NextResponse.json(
      { error: 'Could not update recipe.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  const { id } = await params;

  try {
    // First check if the recipe exists at all.
    const existing = await db.recipe.findUnique({ where: { id } });
    if (!existing) {
      // Recipe doesn't exist in DB — could be a temp ID or already deleted.
      return NextResponse.json({ success: true, message: 'Recipe not in DB (already deleted or temp ID).' });
    }

    // Allow deletion if the recipe belongs to this user OR to the guest user.
    // This handles the case where a recipe was created as a guest and then
    // the user logged in (or vice versa).
    if (existing.userId !== user.id && existing.userId !== 'guest-user') {
      return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 });
    }

    // If the recipe belongs to the guest user but the current user is logged in,
    // migrate it first (so the migration logic is consistent).
    if (existing.userId === 'guest-user' && !user.isGuest) {
      await db.recipe.update({ where: { id }, data: { userId: user.id } });
    }

    await db.recipe.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete recipe:', err);
    return NextResponse.json(
      { error: 'Could not delete recipe.' },
      { status: 500 },
    );
  }
}
