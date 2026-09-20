/**
 * POST /api/pantry/scan-fridge
 *
 * Takes a photo of a fridge/pantry interior and uses Gemini Vision to identify
 * all visible food items. Returns a structured list with names, categories,
 * estimated expiry, and confidence levels.
 *
 * Request:  { "image": "base64-encoded JPEG/PNG" }
 * Response: { "items": [{ "name": "...", "category": "...", "estimatedExpiryDays": 7, "confidence": "high" }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FOOD_CATEGORIES = [
  'Produce', 'Dairy', 'Meat & Fish', 'Bakery', 'Pantry', 'Grains', 'Pasta',
  'Sauces', 'Spices', 'Canned Goods', 'Frozen', 'Snacks', 'Beverages',
  'Condiments', 'Oils & Vinegars', 'Baking', 'Other',
];

export async function POST(request: NextRequest) {
  let body: { image?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { image } = body;
  if (!image || typeof image !== 'string') {
    return NextResponse.json({ error: 'Missing "image" field.' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not set.' }, { status: 500 });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Use gemini-2.5-flash for better vision — flash-lite may miss items.
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    });

    // Parse the base64 image.
    let mimeType = 'image/jpeg';
    let imageData = image;
    if (image.startsWith('data:')) {
      const match = image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        imageData = match[2];
      }
    }

    console.log('[scan-fridge] Image size:', Math.round(imageData.length * 0.75 / 1024), 'KB, type:', mimeType);

    const prompt = `You are a food identification expert. Analyze this photo of a refrigerator or pantry interior and identify ALL visible food items.

For each item, return:
- name: The food item name (simple, natural name like "milk", "eggs", "cheddar cheese", "chicken breast")
- category: One of: ${FOOD_CATEGORIES.join(', ')}
- estimatedExpiryDays: Estimated days until expiry from today (e.g. milk=7, eggs=21, canned beans=365, fresh spinach=5, frozen peas=180)
- confidence: "high" (clearly visible), "medium" (partially visible/uncertain), "low" (guessing)

RULES:
- Identify EVERYTHING visible — don't skip items.
- If you see a bottle, identify what it likely is (e.g. "ketchup", "soy sauce", "orange juice").
- If you see produce in a drawer, identify each type.
- If you see packaging with text, read it.
- Use generic names, not brands (e.g. "milk" not "Tesco Semi-Skimmed Milk").
- If an item is partially hidden and you're not sure, set confidence to "low".
- Group identical items (don't list "egg" 6 times — just list "eggs" once).
- Today's date is ${new Date().toISOString().split('T')[0]}.

Return JSON:
{ "items": [{ "name": "...", "category": "...", "estimatedExpiryDays": 7, "confidence": "high" }] }

Return ONLY the JSON.`;

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageData } },
        ],
      }],
    });

    const responseText = result.response.text();

    let parsed: { items?: Array<{ name: string; category: string; estimatedExpiryDays: number; confidence: string }> };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse Gemini response as JSON.');
      }
    }

    const items = parsed.items || [];
    console.log(`[scan-fridge] Identified ${items.length} food items.`);

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[scan-fridge] Failed:', err);
    return NextResponse.json({ error: `Scan failed: ${(err as Error).message}` }, { status: 500 });
  }
}
