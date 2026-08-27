/**
 * Shopping Lists API
 * GET  /api/shopping-lists          — list all shopping lists with items
 * POST /api/shopping-lists          — create a shopping list
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  try {
    const lists = await db.shoppingList.findMany({
      where: { userId: user.id },
      include: { items: { orderBy: { sectionOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ lists });
  } catch (err) {
    console.error('Failed to list shopping lists:', err);
    return NextResponse.json({ lists: [], error: 'Database unavailable.' });
  }
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  let body: { name?: string; storeName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  try {
    const list = await db.shoppingList.create({
      data: {
        userId: user.id,
        name: body.name || 'Shopping List',
        storeName: body.storeName || null,
      },
      include: { items: true },
    });

    return NextResponse.json({ list }, { status: 201 });
  } catch (err) {
    console.error('Failed to create shopping list:', err);
    return NextResponse.json({ error: 'Could not create list.' }, { status: 500 });
  }
}
