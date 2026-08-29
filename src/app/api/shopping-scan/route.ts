/**
 * POST /api/shopping-scan
 *
 * Combined endpoint for scanning a product while shopping. In ONE Gemini call:
 *   1. Canonicalize the scanned product (canonical_name + ancestors + attributes)
 *   2. Enrich it (category, expiryDate, quantity)
 *   3. Match it against the shopping list — returns which item to tick off
 *
 * Request:
 *   {
 *     "productName": "Tesco Spaghetti 500g",
 *     "barcode"?: "0123456789012",
 *     "knownQuantity"?: "500g",
 *     "shoppingListItems": [
 *       { "id": "abc123", "name": "Spaghetti", "genericName": "spaghetti" },
 *       { "id": "def456", "name": "Pasta", "genericName": "pasta" }
 *     ]
 *   }
 *
 * Response:
 *   {
 *     "canonical_name": "spaghetti",
 *     "ancestors": ["pasta"],
 *     "attributes": {},
 *     "category": "Pasta",
 *     "expiryDate": "2026-08-29",
 *     "quantity": "500g",
 *     "matchedItemId": "abc123"
 *   }
 *
 * No auth required — the client passes the shopping list items explicitly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { scanMatchAndEnrich } from '@/lib/canonicalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: {
    productName?: string;
    barcode?: string;
    knownQuantity?: string;
    shoppingListItems?: Array<{ id: string; name: string; genericName: string | null }>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.productName && !body.barcode) {
    return NextResponse.json({ error: 'Missing "productName" or "barcode".' }, { status: 400 });
  }

  if (!Array.isArray(body.shoppingListItems)) {
    body.shoppingListItems = [];
  }

  const result = await scanMatchAndEnrich({
    productName: body.productName || `Product ${body.barcode}`,
    barcode: body.barcode,
    knownQuantity: body.knownQuantity,
    shoppingListItems: body.shoppingListItems,
  });

  return NextResponse.json({
    canonical_name: result.canonical_name,
    ancestors: result.ancestors,
    attributes: result.attributes,
    genericName: result.canonical_name, // Backward compat
    category: result.category,
    expiryDate: result.expiryDate,
    quantity: result.quantity,
    matchedItemId: result.matchedItemId,
  });
}
