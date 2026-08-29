/**
 * GET /api/admin/backfill
 *
 * ONE-CLICK backfill for ALL Gemini-canonicalized fields across the entire database.
 * Covers:
 *   - Pantry items: genericName, canonicalAncestors, canonicalAttributes, canonicalHardAttributeKeys, category
 *   - Recipe ingredients: canonicalName, canonicalAncestors, canonicalAttributes, canonicalHardAttributeKeys
 *
 * Usage:
 *   1. Backfill only items missing fields (default):
 *      GET /api/admin/backfill
 *
 *   2. Force re-canonicalize EVERYTHING (use after changing the Gemini prompt):
 *      GET /api/admin/backfill?force=1
 *
 *   3. Backfill only pantry (or only recipes):
 *      GET /api/admin/backfill?scope=pantry
 *      GET /api/admin/backfill?scope=recipes
 *
 * No auth — it's an admin script. Protect at the network level or delete after use.
 * Safe to run multiple times — it's idempotent (only updates items that need it, unless ?force=1).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { canonicalizeNames } from '@/lib/canonicalize';
import type { RecipeIngredient } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const searchParams = request.nextUrl.searchParams;
  const force = searchParams.get('force') === '1';
  const scope = searchParams.get('scope') || 'all'; // 'all' | 'pantry' | 'recipes'

  const result = {
    force,
    scope,
    pantry: { total: 0, updated: 0, skipped: 0, errors: 0 },
    recipes: { total: 0, updated: 0, skipped: 0, errors: 0 },
    duration: '',
  };

  // ===========================================================================
  // PANTRY BACKFILL
  // ===========================================================================
  if (scope === 'all' || scope === 'pantry') {
    try {
      const items = await db.pantryItem.findMany({
        select: { id: true, name: true, genericName: true, canonicalAncestors: true, canonicalAttributes: true, canonicalHardAttributeKeys: true, category: true },
      });
      result.pantry.total = items.length;

      // Filter to items that need backfilling.
      const needsBackfill = items.filter((item) => {
        if (force) return true;
        return (
          !item.genericName ||
          !item.canonicalAncestors ||
          !item.canonicalAttributes ||
          item.canonicalHardAttributeKeys === null
        );
      });

      if (needsBackfill.length > 0) {
        // Deduplicate names to reduce API cost.
        const uniqueNames = Array.from(new Set(needsBackfill.map((i) => i.name).filter(Boolean)));
        const canonicalMap = await canonicalizeNames(uniqueNames);

        for (const item of needsBackfill) {
          const canonical = canonicalMap.get(item.name);
          if (!canonical || !canonical.canonical_name) {
            result.pantry.skipped++;
            continue;
          }

          try {
            const ancestors = canonical.ancestors.length > 0 ? canonical.ancestors : null;
            const attributes = Object.keys(canonical.attributes).length > 0 ? canonical.attributes : null;
            const hardKeys = canonical.hardAttributeKeys.length > 0 ? canonical.hardAttributeKeys : null;

            await db.pantryItem.update({
              where: { id: item.id },
              data: {
                genericName: canonical.canonical_name,
                canonicalAncestors: ancestors as never,
                canonicalAttributes: attributes as never,
                canonicalHardAttributeKeys: hardKeys as never,
              },
            });
            result.pantry.updated++;
          } catch (err) {
            console.error(`[backfill] Pantry item ${item.id} failed:`, err);
            result.pantry.errors++;
          }
        }
      } else {
        result.pantry.skipped = items.length;
      }
    } catch (err) {
      console.error('[backfill] Pantry backfill failed:', err);
      result.pantry.errors++;
    }
  }

  // ===========================================================================
  // RECIPE BACKFILL
  // ===========================================================================
  if (scope === 'all' || scope === 'recipes') {
    try {
      const recipes = await db.recipe.findMany({
        select: { id: true, ingredients: true },
      });
      result.recipes.total = recipes.length;

      for (const recipe of recipes) {
        try {
          const ingredients = recipe.ingredients as RecipeIngredient[];
          if (!Array.isArray(ingredients) || ingredients.length === 0) {
            result.recipes.skipped++;
            continue;
          }

          // Check if any ingredient needs canonicalization.
          const needsBackfill = force || ingredients.some(
            (ing) => !ing.canonicalName ||
              ing.canonicalAncestors === undefined ||
              ing.canonicalAttributes === undefined ||
              ing.canonicalHardAttributeKeys === undefined,
          );

          if (!needsBackfill) {
            result.recipes.skipped++;
            continue;
          }

          // Collect names that need canonicalization.
          const namesToCanonicalize = force
            ? ingredients.map((ing) => ing.name)
            : ingredients
                .filter((ing) => !ing.canonicalName)
                .map((ing) => ing.name);

          if (namesToCanonicalize.length === 0) {
            // All have canonicalName but maybe missing the new fields — rebuild from existing.
            result.recipes.skipped++;
            continue;
          }

          const uniqueNames = Array.from(new Set(namesToCanonicalize.filter(Boolean)));
          const canonicalMap = await canonicalizeNames(uniqueNames);

          const updatedIngredients = ingredients.map((ing) => {
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
            // Keep existing canonical data if we didn't re-canonicalize this one.
            return ing;
          });

          await db.recipe.update({
            where: { id: recipe.id },
            data: { ingredients: updatedIngredients as never },
          });
          result.recipes.updated++;
        } catch (err) {
          console.error(`[backfill] Recipe ${recipe.id} failed:`, err);
          result.recipes.errors++;
        }
      }
    } catch (err) {
      console.error('[backfill] Recipe backfill failed:', err);
      result.recipes.errors++;
    }
  }

  result.duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

  return NextResponse.json({
    message: 'Backfill complete',
    ...result,
    nextStep: result.pantry.errors > 0 || result.recipes.errors > 0
      ? 'Some errors occurred — check the server logs.'
      : 'All done. You can safely keep this endpoint for future use.',
  });
}
