/**
 * POST /api/canonicalize
 *
 * Batch-canonicalize ingredient names using Gemini.
 * Used by the recipe-pantry-integration to canonicalize recipe ingredients
 * so they can be matched against pantry items.
 *
 * Request:  { "names": ["Chicken Breast Tenders", "Red Capsicum", ...] }
 * Response: { "canonical": { "Chicken Breast Tenders": "chicken breast", "Red Capsicum": "red bell pepper", ... } }
 *
 * No auth required — canonicalization doesn't expose user data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { canonicalizeNames } from '@/lib/canonicalize';

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

  // Deduplicate names to reduce API cost.
  const uniqueNames = Array.from(new Set(body.names.filter((n) => n && typeof n === 'string')));

  const canonicalMap = await canonicalizeNames(uniqueNames);

  // Convert Map to plain object for JSON response.
  const canonical: Record<string, string> = {};
  for (const [original, canon] of canonicalMap) {
    canonical[original] = canon;
  }

  return NextResponse.json({ canonical });
}
