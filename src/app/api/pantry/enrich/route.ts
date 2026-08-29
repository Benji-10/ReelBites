/**
 * POST /api/pantry/enrich
 *
 * Uses Gemini to canonicalize AND enrich a pantry item in one call:
 * - canonical_name, ancestors, attributes (for matching)
 * - category (food category)
 * - quantity (estimated if not known)
 * - expiryDate (estimated based on product type)
 *
 * Request:  { "barcode"?: "...", "name": "...", "quantity"?: "...", "category"?: "..." }
 * Response: { "canonical_name": "...", "ancestors": [...], "attributes": {...}, "category": "...", "quantity": "...", "expiryDate": "..." }
 */

import { NextRequest, NextResponse } from 'next/server';
import { canonicalizeAndEnrich } from '@/lib/canonicalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: { barcode?: string; name?: string; quantity?: string; category?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { barcode, name, quantity, category } = body;

  if (!name && !barcode) {
    return NextResponse.json({ error: 'No product info provided.' }, { status: 400 });
  }

  const result = await canonicalizeAndEnrich({
    productName: name || `Product ${barcode}`,
    barcode,
    knownQuantity: quantity,
    knownCategory: category,
  });

  return NextResponse.json({
    canonical_name: result.canonical_name,
    ancestors: result.ancestors,
    attributes: result.attributes,
    genericName: result.canonical_name, // Backward compat — old clients expect this field
    category: result.category,
    quantity: result.quantity || '',
    expiryDate: result.expiryDate || '',
  });
}
