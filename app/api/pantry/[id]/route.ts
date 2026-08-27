/**
 * PUT    /api/pantry/[id]  — update a pantry item
 * DELETE /api/pantry/[id]  — delete a pantry item
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
    const existing = await db.pantryItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const allowed = ['name', 'genericName', 'category', 'quantity', 'expiryDate', 'barcode', 'isRunningLow'];
    const data: Record<string, unknown> = {};
    for (const f of allowed) {
      if (f in body) {
        if (f === 'expiryDate' && body[f]) {
          data[f] = new Date(body[f] as string);
        } else {
          data[f] = body[f];
        }
      }
    }

    const updated = await db.pantryItem.update({ where: { id }, data: data as never });
    return NextResponse.json({ item: updated });
  } catch (err) {
    console.error('Failed to update pantry item:', err);
    return NextResponse.json({ error: 'Could not update.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);
  const { id } = await params;

  try {
    const existing = await db.pantryItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    await db.pantryItem.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete pantry item:', err);
    return NextResponse.json({ error: 'Could not delete.' }, { status: 500 });
  }
}
