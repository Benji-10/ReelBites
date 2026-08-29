/**
 * Pantry API
 * GET    /api/pantry          — list all pantry items
 * POST   /api/pantry          — add a pantry item (with AI categorization)
 * PUT    /api/pantry/[id]     — update a pantry item
 * DELETE /api/pantry/[id]     — delete a pantry item
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';
import { canonicalizeName, type CanonicalIngredient } from '@/lib/canonicalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PantryItemBody {
  name: string;
  genericName?: string;
  category?: string;
  quantity?: string;
  expiryDate?: string;
  barcode?: string;
  isRunningLow?: boolean;
  fillPercent?: number;
}

const FOOD_CATEGORIES = [
  'Produce', 'Dairy', 'Meat & Fish', 'Bakery', 'Pantry', 'Grains', 'Pasta',
  'Sauces', 'Spices', 'Canned Goods', 'Frozen', 'Snacks', 'Beverages',
  'Condiments', 'Oils & Vinegars', 'Baking', 'Other',
];

async function categorizeAndCanonicalize(name: string): Promise<{
  category: string;
  canonical: CanonicalIngredient;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      category: 'Other',
      canonical: { canonical_name: name.toLowerCase(), ancestors: [], attributes: {} },
    };
  }

  // Get the full canonical structure (canonical_name + ancestors + attributes).
  const canonical = await canonicalizeName(name);

  // Category is done separately (different concern).
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    });

    const result = await model.generateContent(
      `Categorize this food product into one of these categories: ${FOOD_CATEGORIES.join(', ')}

Product: "${name}"

Return ONLY: {"category": "..."}`,
    );

    const parsed = JSON.parse(result.response.text());
    return {
      category: parsed.category || 'Other',
      canonical,
    };
  } catch {
    return { category: 'Other', canonical };
  }
}

/**
 * Learn category overrides: if the user has previously set a custom category
 * for a product with the same genericName, use that category instead of
 * re-categorizing with AI.
 */
async function learnCategoryOverride(userId: string, genericName: string): Promise<string | null> {
  try {
    // Find existing pantry items with the same genericName.
    const existing = await db.pantryItem.findFirst({
      where: {
        userId,
        genericName: { equals: genericName, mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // If the user previously set a category for this genericName, use it.
    // We check if the category differs from what AI would assign by seeing
    // if there's an existing item with a non-null category.
    if (existing?.category) {
      console.log(`[pantry] Category override learned: ${genericName} → ${existing.category}`);
      return existing.category;
    }
  } catch {}
  return null;
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  try {
    const items = await db.pantryItem.findMany({
      where: { userId: user.id },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error('Failed to list pantry:', err);
    return NextResponse.json({ items: [], error: 'Database unavailable.' });
  }
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  let body: PantryItemBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.name) {
    return NextResponse.json({ error: 'Missing "name".' }, { status: 400 });
  }

  // Auto-categorize and canonicalize if not provided.
  let category = body.category;
  let genericName = body.genericName;
  let canonicalAncestors: string[] | null = null;
  let canonicalAttributes: Record<string, string> | null = null;

  if (!genericName) {
    const ai = await categorizeAndCanonicalize(body.name);
    if (!category) category = ai.category;
    genericName = ai.canonical.canonical_name;
    canonicalAncestors = ai.canonical.ancestors.length > 0 ? ai.canonical.ancestors : null;
    canonicalAttributes = Object.keys(ai.canonical.attributes).length > 0 ? ai.canonical.attributes : null;
  }

  // Learn category overrides: check if the user has previously set a custom
  // category for this genericName. If so, use that instead.
  if (!body.category && genericName) {
    const learnedCategory = await learnCategoryOverride(user.id, genericName);
    if (learnedCategory) {
      category = learnedCategory;
    }
  }

  try {
    const item = await db.pantryItem.create({
      data: {
        userId: user.id,
        name: body.name,
        genericName,
        canonicalAncestors: canonicalAncestors as never,
        canonicalAttributes: canonicalAttributes as never,
        category,
        quantity: body.quantity || null,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        barcode: body.barcode || null,
        isRunningLow: body.isRunningLow || false,
        fillPercent: body.fillPercent ?? 100,
      },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    console.error('Failed to create pantry item:', err);
    return NextResponse.json({ error: 'Could not save item.' }, { status: 500 });
  }
}
