/**
 * POST /api/pantry/enrich
 *
 * Uses Gemini to estimate missing pantry item fields from a barcode lookup:
 * - genericName: normalized name for lookups (e.g. "chopped tomatoes")
 * - category: food category (e.g. "Canned Goods")
 * - quantity: estimated quantity (e.g. "400g")
 * - expiryDate: estimated expiry date (YYYY-MM-DD) based on product type
 *
 * Request:  { "barcode": "...", "name": "...", "quantity": "...", "category": "..." }
 * Response: { "genericName": "...", "category": "...", "quantity": "...", "expiryDate": "..." }
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: { barcode?: string; name?: string; quantity?: string; category?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not set.' }, { status: 500 });
  }

  const { barcode, name, quantity, category } = body;

  // Build a description of what we know.
  const knownInfo = [
    barcode ? `Barcode: ${barcode}` : null,
    name ? `Product name: ${name}` : null,
    quantity ? `Quantity: ${quantity}` : null,
    category ? `Category: ${category}` : null,
  ].filter(Boolean).join('\n');

  if (!knownInfo) {
    return NextResponse.json({ error: 'No product info provided.' }, { status: 400 });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    // Calculate today's date for expiry estimation.
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const result = await model.generateContent(
      `You are a food product expert. Given the following product information, estimate the missing fields.

Known information:
${knownInfo}
Today's date: ${todayStr}

Estimate:
1. "genericName": A normalized lowercase name for pantry lookups. This should be the GENERIC product type, NOT the brand name. Examples: "Kewpie" → "mayonnaise", "Napolina Chopped Tomatoes" → "chopped tomatoes", "Heinz Baked Beans" → "baked beans", "Barilla Spaghetti" → "pasta", "Minute Rice" → "rice", "Lean Beef Mince 95%" → "beef mince". Remove brand names, percentages, and packaging info.
2. "category": A food category from this list: Produce, Dairy, Meat & Fish, Bakery, Pantry, Grains, Pasta, Sauces, Spices, Canned Goods, Frozen, Snacks, Beverages, Condiments, Oils & Vinegars, Baking, Other
3. "quantity": If not already known, estimate the typical package size (e.g. "400g", "1L", "6 pack", "500ml"). Only fill if the quantity is empty.
4. "expiryDate": Estimate a reasonable expiry date (YYYY-MM-DD format). For fresh produce: 5-7 days from today. For dairy: 7-14 days. For canned goods: 1-2 years. For pasta/rice: 1 year. For frozen: 3-6 months. For spices: 1 year. For bread: 3-5 days.

Return ONLY JSON:
{
  "genericName": "...",
  "category": "...",
  "quantity": "...",
  "expiryDate": "YYYY-MM-DD"
}`,
    );

    const parsed = JSON.parse(result.response.text());

    return NextResponse.json({
      genericName: parsed.genericName || (name || '').toLowerCase(),
      category: parsed.category || category || 'Other',
      quantity: parsed.quantity || quantity || '',
      expiryDate: parsed.expiryDate || '',
    });
  } catch (err) {
    console.error('[pantry/enrich] Failed:', err);
    return NextResponse.json({
      genericName: (name || '').toLowerCase(),
      category: category || 'Other',
      quantity: quantity || '',
      expiryDate: '',
    });
  }
}
