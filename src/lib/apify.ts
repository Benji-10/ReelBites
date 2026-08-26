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
 *
 * NOTE: `firstComment` is the TEXT of the first comment, NOT necessarily from
 * the author. We only add it if it's not already in latestComments (to avoid
 * duplicates). We do NOT assume it's from the author.
 */
function extractComments(item: ApifyReelResult): InstagramComment[] {
  const rawComments = item.latestComments || item.comments || [];
  const postAuthor = item.ownerUsername || item.owner?.username;

  // Log raw comment data for debugging.
  console.log('[apify] Raw comments data:', JSON.stringify(rawComments, null, 2));
  console.log('[apify] firstComment:', item.firstComment);
  console.log('[apify] postAuthor:', postAuthor);

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

  // Check if firstComment is already in the list (to avoid duplicates).
  if (item.firstComment && typeof item.firstComment === 'string' && item.firstComment.trim()) {
    const firstCommentText = item.firstComment.trim();
    const alreadyExists = comments.some((c) => c.text === firstCommentText);
    if (!alreadyExists) {
      // Don't assume firstComment is from the author — we don't know who made it.
      // Try to find the author from the first entry in rawComments if available.
      const firstRawComment = rawComments[0];
      const firstAuthor = firstRawComment?.ownerUsername || firstRawComment?.owner?.username || 'unknown';
      const isAuthor = postAuthor ? firstAuthor === postAuthor : false;
      comments.unshift({
        text: firstCommentText,
        author: firstAuthor,
        likes: firstRawComment?.likesCount || 0,
        isPinned: firstRawComment?.pinnedByOwner === true,
        isAuthor,
      });
    }
  }

  return comments;
}

/**
 * Fetch comments for an Instagram post using the dedicated comment scraper.
 *
 * The reel-scraper only returns the 10 most RECENT comments, which may not
 * include the author's pinned recipe comment. This function uses
 * `apify/instagram-comment-scraper` which can fetch comments sorted by
 * likes and includes all comments (not just recent ones).
 *
 * Cost: ~$0.003 per call on the free tier.
 */
async function fetchComments(
  instagramUrl: string,
  token: string,
  postAuthor: string | null,
): Promise<InstagramComment[]> {
  const client = new ApifyClient({ token });
  const commentActorId = 'apify/instagram-comment-scraper';

  console.log('[Apify] Fetching comments via:', commentActorId);
  console.log('[Apify] Post author for isAuthor check:', postAuthor);

  const input = {
    directUrls: [normalizeInstagramUrl(instagramUrl)],
    resultsLimit: 30, // Fetch up to 30 comments.
  };

  const run = await client.actor(commentActorId).call(input, {
    waitSecs: 120,
  });

  if (run.status !== 'SUCCEEDED') {
    console.warn('[Apify] Comment scraper did not succeed:', run.status);
    return [];
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 30 });
  console.log('[Apify] Comment scraper returned', items.length, 'comments');

  // Log all comment authors for debugging.
  console.log('[Apify] Comment authors:', (items as Array<Record<string, unknown>>).map((c) => ({
    author: c.ownerUsername,
    textPreview: ((c.text as string) || '').slice(0, 60),
    likes: c.likesCount,
    pinned: c.pinnedByOwner,
  })));

  return (items as Array<Record<string, unknown>>)
    .map((c): InstagramComment => {
      const text = ((c.text as string) || '').trim();
      const author = (c.ownerUsername as string) || 'unknown';
      const likes = (c.likesCount as number) || 0;
      const isPinned = c.pinnedByOwner === true;
      const isAuthor = postAuthor ? author === postAuthor : false;
      return { text, author, likes, isPinned, isAuthor };
    })
    .filter((c) => c.text.length > 0);
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
  let topComments = comments.slice(0, 10);

  // If no author comments were found, try fetching them separately
  // using the dedicated comment scraper actor. This is more reliable
  // because the reel-scraper only returns the 10 most RECENT comments,
  // which may not include the author's pinned recipe comment.
  const hasAuthorComment = topComments.some((c) => c.isAuthor);
  if (!hasAuthorComment) {
    onProgress?.('No author comments found in initial scrape. Fetching comments separately...');

    const postAuthor = result.ownerUsername || result.owner?.username || null;
    try {
      const fetchedComments = await fetchComments(instagramUrl, token!, postAuthor);
      if (fetchedComments.length > 0) {
        // Merge with existing comments (deduplicate by text).
        const existingTexts = new Set(topComments.map((c) => c.text));
        const newComments = fetchedComments.filter((c) => !existingTexts.has(c.text));

        // Sort the fetched comments the same way.
        newComments.sort((a, b) => {
          if (a.isAuthor && !b.isAuthor) return -1;
          if (!a.isAuthor && b.isAuthor) return 1;
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return b.likes - a.likes;
        });

        // Merge: author comments first, then the rest.
        const allComments = [...topComments, ...newComments];
        allComments.sort((a, b) => {
          if (a.isAuthor && !b.isAuthor) return -1;
          if (!a.isAuthor && b.isAuthor) return 1;
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return b.likes - a.likes;
        });
        topComments = allComments.slice(0, 10);

        console.log('[Apify] Fetched comments separately. Author comments found:',
          topComments.filter((c) => c.isAuthor).length);
      }
    } catch (err) {
      console.warn('[Apify] Comment fetch failed:', (err as Error).message);
      // Continue with the comments we have.
    }
  }

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
