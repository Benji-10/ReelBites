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
import { GoogleGenerativeAI } from '@google/generative-ai';

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

async function categorizeWithAI(name: string): Promise<{ category: string; genericName: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { category: 'Other', genericName: name.toLowerCase() };

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    });

    const result = await model.generateContent(
      `Categorize this food product. Return JSON with "category" (one of: ${FOOD_CATEGORIES.join(', ')}) and "genericName" (a normalized lowercase name for lookups, e.g. "spaghetti" → "pasta", "whole milk" → "milk").

Product: "${name}"

Return ONLY: {"category": "...", "genericName": "..."}`,
    );

    const parsed = JSON.parse(result.response.text());
    return {
      category: parsed.category || 'Other',
      genericName: (parsed.genericName || name).toLowerCase(),
    };
  } catch {
    return { category: 'Other', genericName: name.toLowerCase() };
  }
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

  // Auto-categorize if not provided.
  let category = body.category;
  let genericName = body.genericName;

  if (!category || !genericName) {
    const ai = await categorizeWithAI(body.name);
    if (!category) category = ai.category;
    if (!genericName) genericName = ai.genericName;
  }

  try {
    const item = await db.pantryItem.create({
      data: {
        userId: user.id,
        name: body.name,
        genericName,
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
