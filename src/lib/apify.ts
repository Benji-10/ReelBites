/**
 * Apify integration for scraping Instagram reels.
 *
 * Uses the `apify/instagram-reel-scraper` actor — a purpose-built first-party
 * Apify actor that accepts direct reel URLs and returns:
 *   - The direct video download URL (videoUrl)
 *   - The post caption
 *   - The latest 10 comments (latestComments, with text/author/likes/timestamp)
 *
 * Free tier: ~$0.009 per reel (pay-per-event). The $5/month free credit
 * covers roughly 550 reels/month.
 *
 * Actor input format:
 *   { username: ["https://www.instagram.com/reel/SHORTCODE/"] }
 *
 * (Yes, the field is named `username` even though it accepts reel URLs —
 *  the actor's input schema documents it as "Instagram username, profile URL,
 *  ID, or reel URL".)
 *
 * The actor ID is configurable via the APIFY_INSTAGRAM_ACTOR env var if you
 * want to switch to an alternative (e.g. `apify/instagram-post-scraper`,
 * which uses the same input format and is slightly cheaper at ~$0.003/post).
 */

import { ApifyClient } from 'apify-client';
import type { InstagramComment, InstagramPost } from './types';

const DEFAULT_ACTOR_ID = 'apify/instagram-reel-scraper';

/**
 * Extract a shortcode from any Instagram URL format.
 * Handles /reel/, /reels/, /p/, /tv/, and direct shortcode URLs.
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
 * Normalize an Instagram URL to a clean /reel/SHORTCODE/ format.
 * Strips query params and converts /reels/ (plural) to /reel/ (singular).
 */
function normalizeInstagramUrl(url: string): string {
  const shortcode = extractShortcode(url);
  if (shortcode) {
    return `https://www.instagram.com/reel/${shortcode}/`;
  }
  return url;
}

interface ApifyReelComment {
  id?: string;
  text?: string;
  ownerUsername?: string;
  timestamp?: string;
  likesCount?: number;
  pinnedByOwner?: boolean;
  owner?: {
    id?: string;
    username?: string;
    isVerified?: boolean;
    fullName?: string;
  };
}

interface ApifyReelResult {
  // The Apify instagram-reel-scraper output schema:
  inputUrl?: string;
  id?: string;
  type?: string; // "Reel" | "Video" | etc.
  shortCode?: string;
  caption?: string;
  hashtags?: string[];
  mentions?: unknown[];
  url?: string;
  commentsCount?: number;
  firstComment?: string;
  latestComments?: ApifyReelComment[];
  comments?: ApifyReelComment[]; // some actor versions use this name
  videoUrl?: string | null;
  videoURL?: string | null;
  video_url?: string | null;
  videoDownloadUrl?: string | null;
  displayUrl?: string | null;
  videoDuration?: number;
  likesCount?: number;
  views?: number;
  playCount?: number;
  videoPlayCount?: number;
  videoViewCount?: number;
  timestamp?: string;
  ownerUsername?: string;
  owner?: {
    id?: string;
    username?: string;
    isVerified?: boolean;
    fullName?: string;
  };
  musicInfo?: unknown;
  transcript?: string | null;
  taggedUsers?: unknown[];
  // Error fields (if the actor couldn't scrape the URL):
  error?: string;
  errorDescription?: string;
}

/**
 * Extract the video URL from an Apify result item.
 * Checks multiple field name variants for cross-actor compatibility.
 */
function extractVideoUrl(item: ApifyReelResult): string | null {
  const directFields = [
    'videoUrl',
    'videoURL',
    'video_url',
    'videoDownloadUrl',
  ] as const;
  for (const field of directFields) {
    const value = item[field];
    if (typeof value === 'string' && value.startsWith('http')) {
      return value;
    }
  }
  return null;
}

/**
 * Extract the thumbnail/cover image URL.
 */
function extractThumbnailUrl(item: ApifyReelResult): string | null {
  const fields = ['displayUrl', 'thumbnailUrl', 'imageUrl'] as const;
  for (const field of fields) {
    const value = item[field];
    if (typeof value === 'string' && value.startsWith('http')) {
      return value;
    }
  }
  return null;
}

/**
 * Extract and normalize comments from an Apify result item.
 * The reel-scraper actor returns comments in `latestComments` (10 most recent).
 *
 * Author comments (where the comment author matches the post author) are
 * prioritized — these often contain the full recipe written out by the creator.
 * The `firstComment` field is also checked, as Apify often returns it separately
 * and it's frequently the author's own pinned comment with the recipe.
 */
function extractComments(item: ApifyReelResult): InstagramComment[] {
  const rawComments = item.latestComments || item.comments || [];
  const postAuthor = item.ownerUsername || item.owner?.username;

  const comments = rawComments
    .map((c): InstagramComment => {
      const text = (c.text || '').trim();
      const author =
        c.ownerUsername ||
        c.owner?.username ||
        'unknown';
      const likes = c.likesCount || 0;
      const isPinned = c.pinnedByOwner === true;
      // Mark as author comment if the commenter is the post author.
      const isAuthor = postAuthor ? author === postAuthor : false;

      return { text, author, likes, isPinned, isAuthor };
    })
    .filter((c) => c.text.length > 0);

  // Also check the firstComment field — Apify sometimes returns it separately,
  // and it's often the author's pinned comment with the full recipe.
  if (item.firstComment && typeof item.firstComment === 'string' && item.firstComment.trim()) {
    comments.unshift({
      text: item.firstComment.trim(),
      author: postAuthor || 'unknown',
      likes: 0,
      isPinned: true,
      isAuthor: true,
    });
  }

  return comments;
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

  // Normalize the URL (strip query params, normalize /reels/ → /reel/).
  const normalizedUrl = normalizeInstagramUrl(instagramUrl);
  const shortcode = extractShortcode(normalizedUrl);

  onProgress?.(`Calling Apify actor: ${actorId}`);
  onProgress?.(`Target: ${normalizedUrl}`);

  // The `apify/instagram-reel-scraper` actor accepts direct reel URLs in its
  // `username` field (yes, it's named `username` even for reel URLs — the
  // actor's input schema documents it as accepting "username, profile URL,
  // ID, or reel URL"). The value must be an array of strings.
  //
  // Alternative actors using the same input format:
  //   - apify/instagram-post-scraper (slightly cheaper, ~$0.003/post)
  //
  // If you switch actors, also update the env var APIFY_INSTAGRAM_ACTOR.
  const input = {
    username: [normalizedUrl],
  };

  // Call the actor and wait for it to finish. This typically takes 10-30 seconds.
  const run = await client.actor(actorId).call(input, {
    waitSecs: 120,
  });

  if (run.status !== 'SUCCEEDED') {
    throw new Error(
      `Apify actor run did not succeed (status: ${run.status}). Check your Apify dashboard at https://console.apify.com for run details. The actor may have hit Instagram's rate limits.`,
    );
  }

  onProgress?.('Fetching scraped dataset from Apify...');

  // Fetch the results from the actor's default dataset.
  // NOTE: in apify-client v2.x the method is `listItems()`, not `list()`.
  const { items } = await client.dataset(run.defaultDatasetId).listItems({
    limit: 5,
  });
  if (!items || items.length === 0) {
    throw new Error(
      'Apify returned an empty dataset — the actor processed 0 URLs. ' +
        'This usually means the URL was rejected (private/deleted post) or ' +
        'Instagram blocked the scrape. Check https://console.apify.com for details.',
    );
  }

  const result = items[0] as ApifyReelResult;

  // If the actor returned an error object, surface it directly.
  if (result.error && !extractVideoUrl(result)) {
    const errorDesc =
      result.errorDescription ||
      result.error ||
      'Unknown error';
    throw new Error(
      `Apify actor returned an error: ${errorDesc}. ` +
        'The reel may be private, deleted, or the actor was blocked by Instagram. ' +
        'Check https://console.apify.com for details.',
    );
  }

  // Extract data using robust field detection.
  const videoUrl = extractVideoUrl(result);
  const thumbnailUrl = extractThumbnailUrl(result);
  const caption = result.caption || null;
  const comments = extractComments(result);

  // Sort comments: author comments first (they often contain the recipe),
  // then pinned, then by likes descending.
  comments.sort((a, b) => {
    if (a.isAuthor && !b.isAuthor) return -1;
    if (!a.isAuthor && b.isAuthor) return 1;
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return b.likes - a.likes;
  });
  const topComments = comments.slice(0, 10);

  // If we still don't have a video URL, throw a detailed error.
  if (!videoUrl) {
    const availableKeys = Object.keys(result);
    console.error('[Apify] No video URL found.');
    console.error('[Apify] Available fields:', availableKeys.join(', '));
    console.error(
      '[Apify] Full result (truncated):',
      JSON.stringify(result, null, 2).slice(0, 2000),
    );

    throw new Error(
      `No video URL found in the Apify result. The actor returned these fields: ${availableKeys.join(', ')}. ` +
        `This usually means one of:\n` +
        `1. The post is an image/carousel, not a video reel.\n` +
        `2. The actor couldn't fetch the video URL (Instagram may have blocked it).\n` +
        `3. The actor version uses a different field name.\n\n` +
        `Solutions:\n` +
        `- Check the Apify run at https://console.apify.com to see the raw result.\n` +
        `- Try setting APIFY_INSTAGRAM_ACTOR to "apify/instagram-post-scraper" (uses the same input format).\n` +
        `- Make sure the URL points to a video reel, not an image post.`,
    );
  }

  onProgress?.(
    `Found video from @${result.ownerUsername || result.owner?.username || 'unknown'}. ` +
      `Caption: ${caption?.slice(0, 80) || '(none)'}...`,
  );

  return {
    videoUrl,
    caption,
    comments: topComments,
    thumbnailUrl,
    author: result.ownerUsername || result.owner?.username || null,
    postId: result.id || null,
    shortCode: result.shortCode || shortcode,
  };
}
