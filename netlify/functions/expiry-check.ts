/**
 * Netlify Scheduled Function: Expiry Check
 *
 * Runs EVERY HOUR to check if it's notification time (9am) in each user's
 * local timezone. When it is, checks all their pantry items for upcoming
 * expiries and sends push notifications.
 *
 * Alerts are sent at: 7 days, 3 days, 1 day, and day-of expiry.
 * The NotifiedItem table prevents duplicate notifications.
 *
 * The function is scheduled hourly with schedule('0 * * * *').
 * For each subscription, it checks: is the current hour (in the user's
 * timezone) equal to their notificationHour? If yes, send alerts.
 * This ensures each user gets alerts at 9am THEIR local time.
 *
 * You can also trigger it manually:
 *   curl -X POST https://your-site.netlify.app/.netlify/functions/expiry-check
 */

import { schedule } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import webpush from 'web-push';

const prisma = new PrismaClient();

// Configure web-push with VAPID keys.
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:hello@realbites.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

/**
 * Get the current hour in a given IANA timezone.
 * Returns -1 if the timezone is invalid.
 */
function getCurrentHourInTimezone(timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === 'hour');
    return hourPart ? parseInt(hourPart.value, 10) : -1;
  } catch {
    return -1;
  }
}

function daysUntil(expiryDate: Date, timezone: string = 'UTC'): number {
  // Get "today" in the user's timezone.
  const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  nowInTz.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  const diffMs = expiry.getTime() - nowInTz.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function getAlertType(daysLeft: number): string | null {
  if (daysLeft === 7) return 'week_before';
  if (daysLeft === 3) return 'three_days_before';
  if (daysLeft === 1) return 'day_before';
  if (daysLeft === 0) return 'day_of';
  return null;
}

function getAlertMessage(daysLeft: number, itemName: string): { title: string; body: string } {
  if (daysLeft === 7) {
    return {
      title: '📦 Expiring in a week',
      body: `"${itemName}" expires in 7 days. Time to plan a meal around it!`,
    };
  }
  if (daysLeft === 3) {
    return {
      title: '⏰ Expiring in 3 days',
      body: `"${itemName}" expires in 3 days. Use it soon!`,
    };
  }
  if (daysLeft === 1) {
    return {
      title: '⚠️ Expiring tomorrow',
      body: `"${itemName}" expires tomorrow. Don't let it go to waste!`,
    };
  }
  if (daysLeft === 0) {
    return {
      title: '🚨 Expires today!',
      body: `"${itemName}" expires today. Use it or lose it!`,
    };
  }
  return { title: 'RealBites', body: '' };
}

async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; tag?: string; data?: { url: string } },
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return true;
  } catch (err) {
    console.error('[expiry-check] Push failed:', (err as Error).message);
    if ((err as { statusCode?: number }).statusCode === 410) {
      try {
        await prisma.pushSubscription.delete({ where: { endpoint: subscription.endpoint } });
        console.log('[expiry-check] Deleted expired subscription:', subscription.endpoint.slice(0, 50));
      } catch {}
    }
    return false;
  }
}

async function runExpiryCheck() {
  const startTime = Date.now();
  const utcHour = new Date().getUTCHours();
  console.log(`[expiry-check] Running hourly check (UTC hour: ${utcHour})...`);

  const stats = {
    itemsChecked: 0,
    notificationsSent: 0,
    notificationsSkipped: 0,
    usersChecked: 0,
    usersSkipped: 0,
    errors: 0,
  };

  try {
    // Get ALL push subscriptions.
    const allSubscriptions = await prisma.pushSubscription.findMany({
      select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true, notificationHour: true, timezone: true },
    });

    console.log(`[expiry-check] Found ${allSubscriptions.length} total subscriptions.`);

    // Group subscriptions by user.
    const subsByUser = new Map<string, typeof allSubscriptions>();
    for (const sub of allSubscriptions) {
      const arr = subsByUser.get(sub.userId) || [];
      arr.push(sub);
      subsByUser.set(sub.userId, arr);
    }

    // For each user, check if it's their notification hour.
    for (const [userId, subs] of subsByUser) {
      // Use the first subscription's timezone (all subscriptions for a user should have the same timezone).
      const timezone = subs[0].timezone || 'UTC';
      const notificationHour = subs[0].notificationHour ?? 9;

      const currentLocalHour = getCurrentHourInTimezone(timezone);
      if (currentLocalHour === -1) {
        console.warn(`[expiry-check] Invalid timezone "${timezone}" for user ${userId.slice(-8)}`);
        stats.errors++;
        continue;
      }

      // Only proceed if it's the user's notification hour.
      if (currentLocalHour !== notificationHour) {
        stats.usersSkipped++;
        continue;
      }

      stats.usersChecked++;
      console.log(`[expiry-check] User ${userId.slice(-8)} — local hour ${currentLocalHour} matches notification hour ${notificationHour} (${timezone})`);

      // Get this user's pantry items with expiry dates.
      const items = await prisma.pantryItem.findMany({
        where: { userId, expiryDate: { not: null } },
        select: { id: true, userId: true, name: true, expiryDate: true, quantity: true },
      });
      stats.itemsChecked += items.length;

      if (items.length === 0) continue;

      for (const item of items) {
        if (!item.expiryDate) continue;

        const daysLeft = daysUntil(item.expiryDate, timezone);
        const alertType = getAlertType(daysLeft);

        if (!alertType) continue;

        // Check if we already notified for this item + alert type.
        const alreadyNotified = await prisma.notifiedItem.findUnique({
          where: {
            userId_pantryItemId_alertType: {
              userId: item.userId,
              pantryItemId: item.id,
              alertType,
            },
          },
        }).catch(() => null);

        if (alreadyNotified) {
          stats.notificationsSkipped++;
          continue;
        }

        const { title, body } = getAlertMessage(daysLeft, item.name);
        const payload = {
          title,
          body,
          tag: `expiry-${item.id}-${alertType}`,
          data: { url: '/pantry' },
        };

        console.log(`[expiry-check] Sending "${alertType}" for "${item.name}" (days left: ${daysLeft})`);

        let sent = false;
        for (const sub of subs) {
          const success = await sendPushNotification(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            payload,
          );
          if (success) sent = true;
        }

        if (sent) {
          try {
            await prisma.notifiedItem.create({
              data: {
                userId: item.userId,
                pantryItemId: item.id,
                alertType,
              },
            });
          } catch (err) {
            if ((err as { code?: string }).code !== 'P2002') {
              console.error('[expiry-check] Failed to record notification:', err);
            }
          }
          stats.notificationsSent++;
        } else {
          stats.errors++;
        }
      }
    }
  } catch (err) {
    console.error('[expiry-check] Failed:', err);
    stats.errors++;
  } finally {
    await prisma.$disconnect();
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[expiry-check] Complete in ${duration}s:`, stats);

  return { duration: `${duration}s`, stats };
}

// Schedule: runs EVERY HOUR.
// For each user, it checks if the current hour in their timezone matches
// their notificationHour (default 9). This ensures alerts come at 9am local time.
const handler = schedule('0 * * * *', async () => {
  const result = await runExpiryCheck();

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Expiry check complete',
      ...result,
    }),
  };
});

export { handler };
