/**
 * POST /api/pantry/scan-fridge
 *
 * Takes a fridge photo and uses Gemini vision (GEMINI_MODEL env var) to identify food
 * items. Each item is canonicalized (canonicalizeAndEnrich) before being
 * returned, so the client can add them directly via /api/pantry POST.
 *
 * Request:  { "image": "data:image/jpeg;base64,..." }
 * Response: { "items": [{ name, quantity, unit, category, genericName,
 *                          expiryDate, canonicalAncestors, ... }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { canonicalizeAndEnrich } from '@/lib/canonicalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface DetectedItem {
  name: string;
  quantity: string | null;
  unit: string | null;
  category: string | null;
}

export async function POST(request: NextRequest) {
  let body: { image?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { image } = body;
  if (!image || typeof image !== 'string' || !image.startsWith('data:')) {
    return NextResponse.json(
      { error: 'Missing "image" field (expected a data URL).' },
      { status: 400 },
    );
  }

  // Extract base64 data + mime type from the data URL.
  const dataUrlMatch = image.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (!dataUrlMatch) {
    return NextResponse.json({ error: 'Invalid data URL format.' }, { status: 400 });
  }
  const [, mimeType, base64Data] = dataUrlMatch;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not set.' }, { status: 500 });
  }

  try {
    // ---- Step 1: Vision — identify food items in the fridge ----------------
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const visionResult = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are a fridge inventory scanner. Look at this photo of a fridge (or shelf of groceries) and identify every FOOD item you can see.

Rules:
- Identify distinct food items only (ignore packaging brands, shelves, drinks containers unless the drink is identifiable, e.g. "milk")
- Use natural, generic names a home cook would use: "milk", "eggs", "chicken breast", "bell pepper"
- Estimate quantity from visual size/packaging (e.g. "6", "500", "1")
- Use a sensible unit for each item: "eggs" → count, "milk" → ml, "chicken breast" → g or count
- Only include items you are reasonably confident about
- If you can't see any food, return an empty array

Return ONLY a JSON object:
{
  "items": [
    { "name": "string", "quantity": "string | null", "unit": "string | null", "category": "Produce | Dairy | Meat & Fish | Bakery | Pantry | Grains | Pasta | Sauces | Spices | Canned Goods | Frozen | Snacks | Beverages | Condiments | Oils & Vinegars | Baking | Other" }
  ]
}`,
            },
            { inlineData: { mimeType, data: base64Data } },
          ],
        },
      ],
    });

    const visionText = visionResult.response.text();
    let detected: { items?: DetectedItem[] };
    try {
      detected = JSON.parse(visionText);
    } catch {
      const match = visionText.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse vision response.');
      detected = JSON.parse(match[0]);
    }

    const rawItems = (detected.items || []).filter(
      (i) => i && typeof i.name === 'string' && i.name.trim().length > 0,
    );

    if (rawItems.length === 0) {
      return NextResponse.json({ items: [] });
    }

    console.log(`[scan-fridge] Detected ${rawItems.length} items — canonicalizing...`);

    // ---- Step 2: Canonicalize each item --------------------------------------
    // canonicalizeAndEnrich gives us the canonical name + category + expiry
    // estimate, so the client can POST each item to /api/pantry directly.
    const items = await Promise.all(
      rawItems.map(async (item) => {
        const knownQuantity =
          item.quantity && item.unit
            ? `${item.quantity} ${item.unit}`
            : item.quantity || undefined;

        try {
          const enriched = await canonicalizeAndEnrich({
            productName: item.name.trim(),
            knownQuantity,
            knownCategory: item.category || undefined,
          });

          return {
            name: item.name.trim(),
            quantity: item.quantity,
            unit: item.unit,
            category: enriched.category || item.category,
            genericName: enriched.canonical_name,
            expiryDate: enriched.expiryDate,
            canonicalAncestors: enriched.ancestors,
            canonicalAttributes: enriched.attributes,
            canonicalHardAttributeKeys: enriched.hardAttributeKeys,
          };
        } catch {
          // Canonicalization failed — still return the raw item.
          return {
            name: item.name.trim(),
            quantity: item.quantity,
            unit: item.unit,
            category: item.category,
            genericName: null,
            expiryDate: null,
            canonicalAncestors: null,
            canonicalAttributes: null,
            canonicalHardAttributeKeys: null,
          };
        }
      }),
    );

    console.log(`[scan-fridge] Returning ${items.length} canonicalized items.`);
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[scan-fridge] Failed:', err);
    return NextResponse.json(
      { error: `Could not scan fridge: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
