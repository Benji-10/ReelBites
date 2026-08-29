/**
 * GET /api/admin/backfill-canonical
 *
 * ONE-TIME backfill script. Visits all pantry items in the DB and
 * canonicalizes their names using the shared canonicalizeNames() function.
 * Populates: genericName (canonical_name), canonicalAncestors, canonicalAttributes.
 *
 * Usage:
 *   1. Deploy this file to production
 *   2. Visit https://your-site.netlify.app/api/admin/backfill-canonical in a browser
 *   3. Wait for the JSON response (shows how many items were updated)
 *   4. Delete this file and redeploy
 *
 * No auth — it's a one-time admin script. Delete after use.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { canonicalizeNames } from '@/lib/canonicalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes — enough for large pantries

export async function GET() {
  const startTime = Date.now();

  try {
    // Fetch ALL pantry items (all users).
    const items = await db.pantryItem.findMany({
      select: { id: true, name: true, genericName: true },
    });

    if (items.length === 0) {
      return NextResponse.json({ message: 'No pantry items to backfill.', updated: 0 });
    }

    // Collect unique names to canonicalize (deduplication reduces API cost).
    const uniqueNames = Array.from(
      new Set(items.map((i) => i.name).filter(Boolean)),
    );

    // Batch canonicalize — one Gemini call per batch (the function handles batching internally).
    const canonicalMap = await canonicalizeNames(uniqueNames);

    // Update each pantry item.
    let updated = 0;
    let skipped = 0;

    for (const item of items) {
      const canonical = canonicalMap.get(item.name);
      if (!canonical || !canonical.canonical_name) {
        skipped++;
        continue;
      }

      const ancestors = canonical.ancestors.length > 0 ? canonical.ancestors : null;
      const attributes = Object.keys(canonical.attributes).length > 0 ? canonical.attributes : null;

      await db.pantryItem.update({
        where: { id: item.id },
        data: {
          genericName: canonical.canonical_name,
          canonicalAncestors: ancestors as never,
          canonicalAttributes: attributes as never,
        },
      });
      updated++;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    return NextResponse.json({
      message: `Backfill complete in ${duration}s`,
      totalItems: items.length,
      updated,
      skipped,
      uniqueNamesCanonicalized: uniqueNames.length,
    });
  } catch (err) {
    console.error('Backfill failed:', err);
    return NextResponse.json(
      { error: 'Backfill failed', details: (err as Error).message },
      { status: 500 },
    );
  }
}
