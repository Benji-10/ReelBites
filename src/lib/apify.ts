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
 *
 * Different Apify Instagram actors return data with slightly different field
 * names (videoUrl, videoURL, video.url, mediaUrl, etc.). This module checks
 * all known field name variants so it works regardless of which actor you use.
 */

import { ApifyClient } from 'apify-client';
import type { InstagramComment, InstagramPost } from './types';

// The default actor. This is Apify's official Instagram scraper and handles
// all post types (reels, posts, stories, carousels). If it fails to return
// video URLs, you can switch to an alternative actor via APIFY_INSTAGRAM_ACTOR.
// Alternatives known to work:
//   - apify/instagram-scraper          (default, Cheerio-based)
//   - apify/instagram-api-scraper       (uses Instagram's private API)
//   - kaitoeasyapi/instagram-reels-scraper (dedicated reels scraper)
const DEFAULT_ACTOR_ID = 'apify/instagram-scraper';

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

/**
 * Extract the video URL from an Apify result item.
 *
 * Different actors and actor versions use different field names. We check
 * all known variants to maximize compatibility:
 *   - videoUrl / videoURL / video_url
 *   - videoDownloadUrl / videoDownloadURL
 *   - mediaUrl / mediaURL
 *   - downloadUrl / downloadURL
 *   - video.url (nested object)
 *   - videoUrls[0] / videos[0].url (array fields)
 */
function extractVideoUrl(item: Record<string, unknown>): string | null {
  // Check direct string fields (in order of likelihood).
  const directFields = [
    'videoUrl',
    'videoURL',
    'video_url',
    'videoDownloadUrl',
    'videoDownloadURL',
    'mediaUrl',
    'mediaURL',
    'downloadUrl',
    'downloadURL',
    'videoLink',
    'videoSrc',
  ];
  for (const field of directFields) {
    const value = item[field];
    if (typeof value === 'string' && value.startsWith('http')) {
      return value;
    }
  }

  // Check nested 'video' object.
  const video = item.video as Record<string, unknown> | undefined;
  if (video && typeof video === 'object' && video !== null) {
    const videoUrl = video.url as string | undefined;
    if (typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
      return videoUrl;
    }
    const videoDownloadUrl = video.downloadUrl as string | undefined;
    if (typeof videoDownloadUrl === 'string' && videoDownloadUrl.startsWith('http')) {
      return videoDownloadUrl;
    }
  }

  // Check array fields.
  const arrayFields = ['videoUrls', 'videoURLs', 'videos', 'video_urls'];
  for (const field of arrayFields) {
    const arr = item[field];
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      if (typeof first === 'string' && first.startsWith('http')) {
        return first;
      }
      if (typeof first === 'object' && first !== null) {
        const obj = first as Record<string, unknown>;
        const objUrl = obj.url as string | undefined;
        if (typeof objUrl === 'string' && objUrl.startsWith('http')) {
          return objUrl;
        }
      }
    }
  }

  return null;
}

/**
 * Extract the thumbnail/cover image URL from an Apify result item.
 */
function extractThumbnailUrl(item: Record<string, unknown>): string | null {
  const fields = [
    'thumbnailUrl',
    'thumbnailURL',
    'displayUrl',
    'displayURL',
    'imageUrl',
    'imageURL',
    'coverImageUrl',
    'previewImageUrl',
  ];
  for (const field of fields) {
    const value = item[field];
    if (typeof value === 'string' && value.startsWith('http')) {
      return value;
    }
  }
  // Check the 'images' array.
  const images = item.images as unknown[] | undefined;
  if (Array.isArray(images) && images.length > 0 && typeof images[0] === 'string') {
    return images[0] as string;
  }
  return null;
}

/**
 * Extract the caption from an Apify result item.
 */
function extractCaption(item: Record<string, unknown>): string | null {
  const fields = ['caption', 'text', 'description', 'textContent'];
  for (const field of fields) {
    const value = item[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Extract and normalize comments from an Apify result item.
 * Handles different comment field name variants.
 */
function extractComments(item: Record<string, unknown>): InstagramComment[] {
  const rawComments = (item.comments as Array<Record<string, unknown>>) || [];

  return rawComments
    .map((c): InstagramComment => {
      // Comment text can be in 'text', 'content', or 'comment' field.
      const text =
        (c.text as string) ||
        (c.content as string) ||
        (c.comment as string) ||
        '';

      // Author can be in 'ownerUsername', 'username', or 'owner.username'.
      const author =
        (c.ownerUsername as string) ||
        (c.username as string) ||
        ((c.owner as Record<string, unknown>)?.username as string) ||
        'unknown';

      // Likes can be in 'latestLikeCount', 'likeCount', or 'likesCount'.
      const likes =
        (c.latestLikeCount as number) ||
        (c.likeCount as number) ||
        (c.likesCount as number) ||
        0;

      // Pinned flag can be 'pinnedByOwner' or 'pinned' or 'isPinned'.
      const isPinned =
        c.pinnedByOwner === true ||
        c.pinned === true ||
        c.isPinned === true;

      return {
        text: text.trim(),
        author,
        likes,
        isPinned,
      };
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

  // Normalize the URL to a clean format (strips query params, normalizes /reels/ → /reel/).
  const normalizedUrl = normalizeInstagramUrl(instagramUrl);
  const shortcode = extractShortcode(normalizedUrl);

  onProgress?.(`Calling Apify actor: ${actorId}`);
  onProgress?.(`Target: ${normalizedUrl}`);

  // The Apify Instagram scraper accepts direct URLs in the `startUrls` input.
  // We request posts + comments.
  const input: Record<string, unknown> = {
    startUrls: [{ url: normalizedUrl }],
    resultsType: 'posts',
    resultsLimit: 1,
    scrapeCommentsFirst: 100,
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
      'Apify returned no results. The Instagram URL may be private, deleted, or the actor failed to scrape it. Check your Apify dashboard for details.',
    );
  }

  const result = items[0] as Record<string, unknown>;

  // Extract data using robust field detection.
  const videoUrl = extractVideoUrl(result);
  const thumbnailUrl = extractThumbnailUrl(result);
  const caption = extractCaption(result);
  const comments = extractComments(result);

  // Sort comments: pinned first, then by likes descending.
  comments.sort((a, b) => {
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
        `- Try setting APIFY_INSTAGRAM_ACTOR to a different actor (e.g. "apify/instagram-api-scraper" or "kaitoeasyapi/instagram-reels-scraper").\n` +
        `- Make sure the URL points to a video reel, not an image post.`,
    );
  }

  onProgress?.(
    `Found video from @${(result.ownerUsername as string) || 'unknown'}. Caption: ${caption?.slice(0, 80) || '(none)'}...`,
  );

  return {
    videoUrl,
    caption,
    comments: topComments,
    thumbnailUrl,
    author: (result.ownerUsername as string) || null,
    postId: (result.id as string) || null,
    shortCode: (result.shortCode as string) || shortcode,
  };
}
