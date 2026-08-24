/**
 * Apify integration for scraping Instagram reels.
 *
 * Uses the Apify Instagram scraper actor to fetch:
 *   - The direct video download URL
 *   - The post caption
 *   - Pinned + top comments
 *
 * The free Apify tier gives $5/month of credits (~10-25 Instagram scrapes
 * depending on the actor). The actor ID is configurable via the
 * APIFY_INSTAGRAM_ACTOR env var so users can swap to a cheaper/different actor.
 */

import { ApifyClient } from 'apify-client';
import type { InstagramComment, InstagramPost } from './types';

const DEFAULT_ACTOR_ID = 'apify/instagram-scraper';

interface ApifyActorResult {
  videoUrl?: string | null;
  caption?: string | null;
  comments?: Array<{
    text?: string;
    ownerUsername?: string;
    latestLikeCount?: number;
    pinnedByOwner?: boolean;
    id?: string;
  }>;
  thumbnailUrl?: string | null;
  ownerUsername?: string | null;
  shortCode?: string | null;
  id?: string | null;
  url?: string | null;
}

/**
 * Extract a shortcode from any Instagram URL format.
 * Handles /reel/, /p/, /tv/, and direct shortcode URLs.
 */
export function extractShortcode(url: string): string | null {
  const patterns = [
    /instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/[^/]+\/(?:p|reel)\/([A-Za-z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function isValidInstagramUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes('instagram.com') &&
      /\/(reel|reels|p|tv)\//.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Scrape an Instagram reel/post using Apify.
 *
 * @param instagramUrl - The full Instagram reel URL.
 * @param onProgress - Optional callback for progress updates.
 * @returns The scraped post data (video URL, caption, comments).
 */
export async function scrapeInstagramPost(
  instagramUrl: string,
  onProgress?: (message: string) => void,
): Promise<InstagramPost> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_API_TOKEN is not set. Add it to your .env file or Netlify environment variables.',
    );
  }

  const actorId = process.env.APIFY_INSTAGRAM_ACTOR || DEFAULT_ACTOR_ID;
  const client = new ApifyClient({ token });

  onProgress?.(`Calling Apify actor: ${actorId}`);

  // The Apify Instagram scraper accepts direct URLs in the `startUrls` input.
  // We request posts + comments.
  const input = {
    startUrls: [{ url: instagramUrl }],
    resultsLimit: 1,
    resultsType: 'posts',
    scrapeCommentsFirst: 100,
  };

  // Call the actor and wait for it to finish. This typically takes 10-30 seconds.
  const run = await client.actor(actorId).call(input, {
    waitSecs: 120,
  });

  if (run.status !== 'SUCCEEDED') {
    throw new Error(
      `Apify actor run did not succeed (status: ${run.status}). Check your Apify dashboard for details.`,
    );
  }

  onProgress?.('Fetching scraped dataset from Apify...');

  // Fetch the results from the actor's default dataset.
  const { items } = await client.dataset(run.defaultDatasetId).list();
  if (!items || items.length === 0) {
    throw new Error(
      'Apify returned no results. The Instagram URL may be private, deleted, or the actor failed to scrape it.',
    );
  }

  const result = items[0] as ApifyActorResult;

  // Normalize the comments.
  const comments: InstagramComment[] = (result.comments || [])
    .map((c) => ({
      text: c.text || '',
      author: c.ownerUsername || 'unknown',
      likes: c.latestLikeCount || 0,
      isPinned: c.pinnedByOwner === true,
    }))
    .filter((c) => c.text.length > 0);

  // Sort: pinned first, then by likes descending.
  comments.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return b.likes - a.likes;
  });

  // Keep top 10 comments for the LLM context.
  const topComments = comments.slice(0, 10);

  return {
    videoUrl: result.videoUrl || null,
    caption: result.caption || null,
    comments: topComments,
    thumbnailUrl: result.thumbnailUrl || null,
    author: result.ownerUsername || null,
    postId: result.id || null,
    shortCode: result.shortCode || extractShortcode(instagramUrl),
  };
}
