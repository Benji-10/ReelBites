/**
 * POST /api/canonicalize
 *
 * Batch-canonicalize ingredient names using Gemini.
 * Returns the full semantic structure (canonical_name, ancestors, attributes)
 * for each input name.
 *
 * Request:  { "names": ["Chicken Breast Tenders", "Red Capsicum", ...] }
 * Response: { "canonical": { "Chicken Breast Tenders": { "canonical_name": "chicken breast", "ancestors": ["chicken"], "attributes": {} }, ... } }
 *
 * No auth required — canonicalization doesn't expose user data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { canonicalizeNames, type CanonicalIngredient } from '@/lib/canonicalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: { names?: string[] };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!Array.isArray(body.names) || body.names.length === 0) {
    return NextResponse.json({ error: 'Missing "names" array.' }, { status: 400 });
  }

  const uniqueNames = Array.from(new Set(body.names.filter((n) => n && typeof n === 'string')));

  const canonicalMap = await canonicalizeNames(uniqueNames);

  const canonical: Record<string, CanonicalIngredient> = {};
  for (const [original, canon] of canonicalMap) {
    canonical[original] = canon;
  }

  return NextResponse.json({ canonical });
}
