/**
 * Shopping List Items API
 * POST /api/shopping-lists/[id]/items — add item(s) to a list
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ItemBody {
  name: string;
  genericName?: string;
  quantity?: string;
  section?: string;
  sectionOrder?: number;
  recipeId?: string;
}

// Default supermarket sections and their order.
const DEFAULT_SECTIONS: Record<string, number> = {
  'Produce': 1,
  'Bakery': 2,
  'Dairy': 3,
  'Meat & Fish': 4,
  'Pantry': 5,
  'Grains & Pasta': 6,
  'Sauces & Condiments': 7,
  'Spices': 8,
  'Canned Goods': 9,
  'Frozen': 10,
  'Snacks': 11,
  'Beverages': 12,
  'Other': 99,
};

function guessSection(name: string): { section: string; order: number } {
  const lower = name.toLowerCase();
  // Simple keyword matching — could use AI for better results.
  if (/tomato|onion|garlic|lettuce|potato|carrot|pepper|herb|fruit|veg|lemon|lime|avocado|ginger/.test(lower))
    return { section: 'Produce', order: 1 };
  if (/bread|bagel|croissant|bun/.test(lower))
    return { section: 'Bakery', order: 2 };
  if (/milk|cheese|yogurt|cream|butter|egg/.test(lower))
    return { section: 'Dairy', order: 3 };
  if (/chicken|beef|pork|fish|salmon|shrimp|bacon|sausage/.test(lower))
    return { section: 'Meat & Fish', order: 4 };
  if (/pasta|spaghetti|penne|rice|noodle|flour|oat|grain|quinoa/.test(lower))
    return { section: 'Grains & Pasta', order: 6 };
  if (/sauce|ketchup|mayo|mustard|vinegar|oil|soy/.test(lower))
    return { section: 'Sauces & Condiments', order: 7 };
  if (/salt|pepper|spice|cumin|paprika|oregano|basil/.test(lower))
    return { section: 'Spices', order: 8 };
  if (/can|tin|bean|tuna|soup/.test(lower))
    return { section: 'Canned Goods', order: 9 };
  if (/frozen|ice/.test(lower))
    return { section: 'Frozen', order: 10 };
  if (/chips|cookie|cracker|snack|chocolate|candy/.test(lower))
    return { section: 'Snacks', order: 11 };
  if (/juice|soda|water|tea|coffee|wine|beer/.test(lower))
    return { section: 'Beverages', order: 12 };
  return { section: 'Other', order: 99 };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);
  const { id } = await params;

  let body: ItemBody | ItemBody[];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  try {
    // Verify the list belongs to the user.
    const list = await db.shoppingList.findUnique({ where: { id } });
    if (!list || list.userId !== user.id) {
      return NextResponse.json({ error: 'List not found.' }, { status: 404 });
    }

    const items = Array.isArray(body) ? body : [body];
    const created = [];

    for (const item of items) {
      if (!item.name) continue;

      // Auto-assign section if not provided.
      let section = item.section;
      let sectionOrder = item.sectionOrder;

      if (!section) {
        const guessed = guessSection(item.name);
        section = guessed.section;
        sectionOrder = guessed.order;
      } else if (sectionOrder === undefined) {
        sectionOrder = DEFAULT_SECTIONS[section] || 99;
      }

      const createdItem = await db.shoppingItem.create({
        data: {
          shoppingListId: id,
          name: item.name,
          genericName: item.genericName || item.name.toLowerCase(),
          quantity: item.quantity || null,
          section,
          sectionOrder: sectionOrder || 99,
          recipeId: item.recipeId || null,
        },
      });
      created.push(createdItem);
    }

    return NextResponse.json({ items: created }, { status: 201 });
  } catch (err) {
    console.error('Failed to add shopping items:', err);
    return NextResponse.json({ error: 'Could not add items.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);
  const { id } = await params;

  try {
    const list = await db.shoppingList.findUnique({ where: { id } });
    if (!list || list.userId !== user.id) {
      return NextResponse.json({ error: 'List not found.' }, { status: 404 });
    }

    await db.shoppingList.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete shopping list:', err);
    return NextResponse.json({ error: 'Could not delete list.' }, { status: 500 });
  }
}
