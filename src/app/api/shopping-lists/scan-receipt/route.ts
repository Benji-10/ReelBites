/**
 * POST /api/shopping-lists/scan-receipt
 *
 * Takes a receipt photo and uses Gemini vision (GEMINI_MODEL env var) to extract grocery
 * items (name, quantity, unit, estimated price).
 *
 * NOTE: items are NOT canonicalized here — receipt items go to the shopping
 * basket, not the pantry. Canonicalization happens later, when the basket is
 * confirmed and items are actually added to the pantry.
 *
 * Request:  { "image": "data:image/jpeg;base64,..." }
 * Response: { "items": [{ name, quantity, unit, estimatedPrice }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are a grocery receipt scanner. Read this receipt photo and extract every GROCERY item purchased.

Rules:
- Use natural, generic names a home cook would use: "milk", "eggs", "chicken breast" — not brand names, product codes, or SKUs
- Skip non-food items UNLESS they're clearly groceries (e.g. kitchen roll is fine to skip; keep obvious food only)
- Skip subtotal, tax, total, payment lines, loyalty points, store name
- Estimate quantity from the receipt line (e.g. "2 x Milk" → quantity "2")
- The price is the line-item price — estimate the per-item price if only a total is shown
- If the receipt is unreadable, return an empty array

Return ONLY a JSON object:
{
  "items": [
    { "name": "string", "quantity": "string | null", "unit": "string | null", "estimatedPrice": "string | null" }
  ]
}`,
            },
            { inlineData: { mimeType, data: base64Data } },
          ],
        },
      ],
    });

    const text = result.response.text();
    let parsed: {
      items?: Array<{
        name?: string;
        quantity?: string | null;
        unit?: string | null;
        estimatedPrice?: string | null;
      }>;
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse receipt response.');
      parsed = JSON.parse(match[0]);
    }

    const items = (parsed.items || [])
      .filter((i) => i && typeof i.name === 'string' && i.name.trim().length > 0)
      .map((i) => ({
        name: i.name!.trim(),
        quantity: i.quantity || null,
        unit: i.unit || null,
        estimatedPrice: i.estimatedPrice || null,
      }));

    console.log(`[scan-receipt] Extracted ${items.length} items.`);
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[scan-receipt] Failed:', err);
    return NextResponse.json(
      { error: `Could not scan receipt: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
