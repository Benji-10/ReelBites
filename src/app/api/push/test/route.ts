/**
 * POST /api/push/test
 *
 * Sends a test push notification to the current user's subscriptions.
 * Used to verify the push setup is working.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';
import webpush from 'web-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:hello@realbites.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  if (!process.env.VAPID_PUBLIC_KEY) {
    return NextResponse.json({ error: 'VAPID keys not configured.' }, { status: 500 });
  }

  try {
    const subscriptions = await db.pushSubscription.findMany({
      where: { userId: user.id },
      select: { endpoint: true, p256dh: true, auth: true },
    });

    if (subscriptions.length === 0) {
      return NextResponse.json({ error: 'No push subscriptions found. Enable notifications first.' }, { status: 400 });
    }

    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify({
            title: '✅ RealBites Push Test',
            body: 'Push notifications are working! You\'ll get expiry alerts here.',
            tag: 'test-notification',
            data: { url: '/pantry' },
          }),
        );
        sent++;
      } catch (err) {
        console.error('[push/test] Failed:', (err as Error).message);
        if ((err as { statusCode?: number }).statusCode === 410) {
          await db.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
        }
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      sent,
      failed,
      message: `Sent ${sent} test notification(s).`,
    });
  } catch (err) {
    console.error('[push/test] Failed:', err);
    return NextResponse.json({ error: 'Could not send test notification.' }, { status: 500 });
  }
}
