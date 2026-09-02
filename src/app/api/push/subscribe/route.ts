/**
 * POST /api/push/subscribe
 *
 * Subscribe to push notifications for expiry alerts.
 * Stores the browser's push subscription (endpoint + keys) in the DB.
 *
 * Request: {
 *   endpoint: "https://fcm.googleapis.com/...",
 *   keys: { p256dh: "...", auth: "..." },
 *   expirationTime: number | null,
 *   notificationHour: number  // 0-23, hour of day to send alerts
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  let body: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    expirationTime?: number | null;
    notificationHour?: number;
    timezone?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: 'Missing subscription data.' }, { status: 400 });
  }

  try {
    // Upsert — if this endpoint already exists, update it.
    const subscription = await db.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        expirationTime: body.expirationTime ? new Date(body.expirationTime) : null,
        notificationHour: body.notificationHour ?? 9,
        timezone: body.timezone || 'UTC',
      },
      update: {
        userId: user.id,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        expirationTime: body.expirationTime ? new Date(body.expirationTime) : null,
        notificationHour: body.notificationHour ?? 9,
        timezone: body.timezone || 'UTC',
      },
    });

    return NextResponse.json({ success: true, subscriptionId: subscription.id });
  } catch (err) {
    console.error('[push/subscribe] Failed:', err);
    return NextResponse.json({ error: 'Could not save subscription.' }, { status: 500 });
  }
}

/**
 * DELETE /api/push/subscribe?endpoint=<url>
 * Unsubscribe from push notifications.
 */
export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  const endpoint = request.nextUrl.searchParams.get('endpoint');
  if (!endpoint) {
    return NextResponse.json({ error: 'Missing endpoint parameter.' }, { status: 400 });
  }

  try {
    await db.pushSubscription.deleteMany({
      where: { userId: user.id, endpoint },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[push/subscribe] Delete failed:', err);
    return NextResponse.json({ error: 'Could not unsubscribe.' }, { status: 500 });
  }
}

/**
 * GET /api/push/subscribe
 * Returns the VAPID public key for the browser to use when subscribing.
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: 'VAPID_PUBLIC_KEY not set.' }, { status: 500 });
  }

  // Get the user's subscriptions.
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId: user.id },
    select: { id: true, endpoint: true, notificationHour: true, createdAt: true },
  });

  return NextResponse.json({
    publicKey,
    subscriptions,
  });
}
