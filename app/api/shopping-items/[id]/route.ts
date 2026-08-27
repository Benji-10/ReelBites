/**
 * Shopping Item API
 * PUT    /api/shopping-items/[id]  — update item (check/uncheck, edit)
 * DELETE /api/shopping-items/[id]  — delete item
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  try {
    const item = await db.shoppingItem.findUnique({
      where: { id },
      include: { shoppingList: { select: { userId: true } } },
    });

    if (!item || item.shoppingList.userId !== user.id) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const allowed = ['name', 'genericName', 'quantity', 'section', 'sectionOrder', 'isChecked', 'recipeId'];
    const data: Record<string, unknown> = {};
    for (const f of allowed) {
      if (f in body) data[f] = body[f];
    }

    const updated = await db.shoppingItem.update({ where: { id }, data: data as never });
    return NextResponse.json({ item: updated });
  } catch (err) {
    console.error('Failed to update shopping item:', err);
    return NextResponse.json({ error: 'Could not update.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);
  const { id } = await params;

  try {
    const item = await db.shoppingItem.findUnique({
      where: { id },
      include: { shoppingList: { select: { userId: true } } },
    });

    if (!item || item.shoppingList.userId !== user.id) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    await db.shoppingItem.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete shopping item:', err);
    return NextResponse.json({ error: 'Could not delete.' }, { status: 500 });
  }
}
