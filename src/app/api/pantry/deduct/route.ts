/**
 * POST /api/pantry/deduct
 *
 * Deducts ingredient quantities from pantry items after cooking.
 * Each deduction specifies:
 *   - pantryItemId: which pantry item to update
 *   - deductAmount: numeric amount to subtract
 *   - deductUnit: unit of the amount (must match the pantry item's unit, or be convertible)
 *   - markAsUsedUp: if true, delete the item entirely (user finished it)
 *
 * The endpoint updates the pantry item's quantity. If the quantity reaches
 * zero or below, the item is marked as "running low" (or deleted if markAsUsedUp).
 *
 * Request: {
 *   deductions: [
 *     { pantryItemId: "abc", deductAmount: 2, deductUnit: "cups", markAsUsedUp: false },
 *     ...
 *   ]
 * }
 * Response: { updated: 3, deleted: 1, errors: [] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DeductionItem {
  pantryItemId: string;
  deductAmount: number;
  deductUnit?: string;
  markAsUsedUp?: boolean;
}

// Simple unit conversion factors to a common base (grams for weight, ml for volume, count for pieces).
const WEIGHT_TO_GRAMS: Record<string, number> = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
};

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1, milliliter: 1, milliliters: 1,
  l: 1000, liter: 1000, liters: 1000,
  tsp: 5, teaspoon: 5, teaspoons: 5,
  tbsp: 15, tablespoon: 15, tablespoons: 15,
  cup: 240, cups: 240,
  pint: 473, pints: 473,
  quart: 946, quarts: 946,
  gallon: 3785, gallons: 3785,
  'fl oz': 30, floz: 30,
};

/**
 * Parse a quantity string like "500g", "2 cups", "1.5 L" into { amount, unit }.
 */
function parseQuantity(qty: string | null): { amount: number; unit: string } | null {
  if (!qty) return null;
  const match = qty.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z\s]+)?$/);
  if (!match) return null;
  return {
    amount: parseFloat(match[1]),
    unit: (match[2] || '').trim(),
  };
}

/**
 * Try to convert between units. Returns the equivalent amount in the target unit,
 * or null if conversion is not possible.
 */
function convertAmount(amount: number, fromUnit: string, toUnit: string): number | null {
  if (!fromUnit || !toUnit) return null;
  fromUnit = fromUnit.toLowerCase().trim();
  toUnit = toUnit.toLowerCase().trim();
  if (fromUnit === toUnit) return amount;

  // Try weight conversion.
  if (WEIGHT_TO_GRAMS[fromUnit] && WEIGHT_TO_GRAMS[toUnit]) {
    const inGrams = amount * WEIGHT_TO_GRAMS[fromUnit];
    return inGrams / WEIGHT_TO_GRAMS[toUnit];
  }

  // Try volume conversion.
  if (VOLUME_TO_ML[fromUnit] && VOLUME_TO_ML[toUnit]) {
    const inMl = amount * VOLUME_TO_ML[fromUnit];
    return inMl / VOLUME_TO_ML[toUnit];
  }

  // Units are in different categories or unknown — can't convert.
  return null;
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  let body: { deductions?: DeductionItem[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!Array.isArray(body.deductions) || body.deductions.length === 0) {
    return NextResponse.json({ error: 'Missing "deductions" array.' }, { status: 400 });
  }

  const result = {
    updated: 0,
    deleted: 0,
    errors: [] as Array<{ id: string; error: string }>,
  };

  for (const deduction of body.deductions) {
    try {
      // Find the pantry item and verify ownership.
      const item = await db.pantryItem.findUnique({
        where: { id: deduction.pantryItemId },
      });

      if (!item || item.userId !== user.id) {
        result.errors.push({
          id: deduction.pantryItemId,
          error: 'Item not found or not owned by user.',
        });
        continue;
      }

      // If markAsUsedUp is true, delete the item.
      if (deduction.markAsUsedUp) {
        await db.pantryItem.delete({ where: { id: item.id } });
        result.deleted++;
        continue;
      }

      // Parse the current quantity.
      const currentQty = parseQuantity(item.quantity);

      if (!currentQty) {
        // Can't parse the quantity — just mark as running low.
        await db.pantryItem.update({
          where: { id: item.id },
          data: { isRunningLow: true },
        });
        result.updated++;
        continue;
      }

      // Try to convert the deduction amount to the pantry item's unit.
      let amountToDeduct = deduction.deductAmount;
      if (deduction.deductUnit && deduction.deductUnit !== currentQty.unit) {
        const converted = convertAmount(deduction.deductAmount, deduction.deductUnit, currentQty.unit);
        if (converted !== null) {
          amountToDeduct = converted;
        } else {
          // Can't convert — deduct in the original unit (best effort).
          // If units are incompatible, just mark as running low.
          await db.pantryItem.update({
            where: { id: item.id },
            data: { isRunningLow: true },
          });
          result.updated++;
          continue;
        }
      }

      const newAmount = Math.max(0, currentQty.amount - amountToDeduct);
      const newQty = `${newAmount % 1 === 0 ? newAmount : newAmount.toFixed(2)} ${currentQty.unit}`.trim();

      // Calculate the fill percentage based on the remaining amount.
      // If the original amount was > 0, fillPercent = (newAmount / originalAmount) * 100.
      // If we can't calculate (original was 0 or unknown), use a reasonable default.
      let fillPercent = item.fillPercent;
      if (currentQty.amount > 0) {
        fillPercent = Math.round((newAmount / currentQty.amount) * 100);
      }
      fillPercent = Math.max(0, Math.min(100, fillPercent));

      // If the new amount is 0 or very close, mark as running low.
      const isRunningLow = newAmount <= 0 || (currentQty.amount > 0 && fillPercent < 25);

      await db.pantryItem.update({
        where: { id: item.id },
        data: {
          quantity: newQty,
          isRunningLow,
          fillPercent,
        },
      });
      result.updated++;
    } catch (err) {
      console.error(`[pantry/deduct] Failed for item ${deduction.pantryItemId}:`, err);
      result.errors.push({
        id: deduction.pantryItemId,
        error: (err as Error).message,
      });
    }
  }

  return NextResponse.json(result);
}
