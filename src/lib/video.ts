/**
 * Video processing utilities using ffmpeg.
 *
 * - Downloads the Instagram video to a temp file.
 * - Extracts the audio track (for Whisper STT).
 * - Extracts frames at a fixed interval (for OCR).
 *
 * Uses ffmpeg-static for the ffmpeg binary so it works in serverless
 * environments (Netlify Functions) without needing a system ffmpeg install.
 *
 * On Netlify, the ffmpeg-static binary must be included in the function
 * bundle via `included_files` in netlify.toml, and the module must be in
 * `external_node_modules` so esbuild doesn't break the path resolution.
 */

import ffmpeg from 'fluent-ffmpeg';
import { existsSync, chmodSync } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Resolve the ffmpeg binary path.
 *
 * Tries in order:
 *   1. The ffmpeg-static package (preferred — bundled with the function)
 *   2. Common system locations (fallback for environments with system ffmpeg)
 *   3. The PATH (lets the OS find it)
 *
 * Returns null if no ffmpeg binary could be found, which will cause the
 * extraction to fail with a clear error message.
 */
function resolveFfmpegPath(): string | null {
  // 1. Try common system locations FIRST.
  // On Netlify's AWS Lambda runtime, ffmpeg is often available at these paths.
  // System ffmpeg is more reliable than ffmpeg-static because it doesn't have
  // bundling/path-resolution issues.
  const systemPaths = [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/bin/ffmpeg',
  ];
  for (const p of systemPaths) {
    if (existsSync(p)) {
      console.log('[ffmpeg] Using system ffmpeg at:', p);
      return p;
    }
  }

  // 2. Try ffmpeg-static as a fallback (for environments without system ffmpeg).
  try {
    // Use dynamic require so esbuild leaves this as an external import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && typeof ffmpegStatic === 'string' && existsSync(ffmpegStatic)) {
      console.log('[ffmpeg] Using ffmpeg-static binary at:', ffmpegStatic);
      return ffmpegStatic;
    }
    // ffmpeg-static may return a path that doesn't exist on this platform.
    console.warn('[ffmpeg] ffmpeg-static returned a path but file does not exist:', ffmpegStatic);
  } catch (err) {
    console.warn('[ffmpeg] Could not load ffmpeg-static:', (err as Error).message);
  }

  // 3. Return null — let fluent-ffmpeg try the PATH.
  console.warn('[ffmpeg] No ffmpeg binary found via system paths or ffmpeg-static. Trying PATH...');
  return null;
}

// Resolve and set the ffmpeg path at module load time.
const resolvedFfmpegPath = resolveFfmpegPath();
if (resolvedFfmpegPath) {
  // On Netlify, the binary may lose its executable permission during bundling.
  // Try to chmod it to be safe (best-effort — may fail if read-only filesystem).
  try {
    chmodSync(resolvedFfmpegPath, 0o755);
    console.log('[ffmpeg] Set executable permission on:', resolvedFfmpegPath);
  } catch (chmodErr) {
    console.warn('[ffmpeg] Could not chmod (may already be executable):', (chmodErr as Error).message);
  }
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}

const TMP_DIR = tmpdir();

async function ensureDir(path: string): Promise<void> {
  try {
    await fs.mkdir(path, { recursive: true });
  } catch {
    // Ignore if it already exists.
  }
}

/**
 * Download a video URL to a temp file.
 */
export async function downloadVideo(
  videoUrl: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const jobId = randomUUID();
  const workDir = join(TMP_DIR, `recipe-${jobId}`);
  await ensureDir(workDir);
  const videoPath = join(workDir, 'source.mp4');

  onProgress?.(`Downloading video from ${new URL(videoUrl).hostname}...`);

  const response = await fetch(videoUrl, {
    headers: {
      // Some CDNs require a user agent.
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download video: HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

  if (!response.body) {
    throw new Error('Video download returned no body.');
  }

  const reader = response.body.getReader();
  const fileHandle = await fs.open(videoPath, 'w');
  const writer = fileHandle.createWriteStream();

  let receivedBytes = 0;
  let lastProgressUpdate = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await new Promise<void>((resolve, reject) => {
      writer.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
    });
    receivedBytes += value.length;

    // Report progress every ~10% or every 1MB.
    if (totalBytes > 0) {
      const percent = Math.floor((receivedBytes / totalBytes) * 100);
      if (percent >= lastProgressUpdate + 10) {
        lastProgressUpdate = percent;
        onProgress?.(`Downloading video... ${percent}% (${(receivedBytes / 1024 / 1024).toFixed(1)} MB)`);
      }
    } else if (receivedBytes - lastProgressUpdate > 1024 * 1024) {
      lastProgressUpdate = receivedBytes;
      onProgress?.(`Downloading video... ${(receivedBytes / 1024 / 1024).toFixed(1)} MB`);
    }
  }

  await new Promise<void>((resolve, reject) => {
    writer.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
  });
  await fileHandle.close();

  const stats = await fs.stat(videoPath);
  onProgress?.(`Video downloaded: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);

  return videoPath;
}

/**
 * Extract the audio track from a video file as MP3 (16kHz mono, which is
 * what Whisper expects).
 */
export async function extractAudio(
  videoPath: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  // Pre-check: verify ffmpeg is available before starting.
  if (!resolvedFfmpegPath) {
    throw new Error(
      'ffmpeg binary not found. The ffmpeg-static package should provide one, ' +
        'but it may not be included in the Netlify function bundle. ' +
        'Check that netlify.toml includes "ffmpeg-static" in both ' +
        'external_node_modules and included_files.',
    );
  }

  const audioPath = videoPath.replace(/\.mp4$/, '.mp3');
  onProgress?.('Extracting audio track with ffmpeg...');

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-vn', // no video
        '-acodec', 'libmp3lame',
        '-ar', '16000', // 16kHz sample rate (Whisper)
        '-ac', '1', // mono
        '-b:a', '32k', // low bitrate is fine for speech
      ])
      .output(audioPath)
      .on('end', () => {
        onProgress?.('Audio extraction complete.');
        resolve(audioPath);
      })
      .on('error', (err) => {
        reject(new Error(`ffmpeg audio extraction failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Extract frames from a video at a fixed interval.
 *
 * @returns Array of { path, timestamp } for each extracted frame.
 */
export async function extractFrames(
  videoPath: string,
  intervalSeconds: number = 2,
  maxFrames: number = 30,
  onProgress?: (message: string) => void,
): Promise<{ path: string; timestamp: number }[]> {
  const framesDir = videoPath.replace(/\.mp4$/, '_frames');
  await ensureDir(framesDir);

  onProgress?.(`Extracting frames every ${intervalSeconds}s...`);

  // First, get the video duration so we can cap the number of frames.
  const duration = await getVideoDuration(videoPath);
  const estimatedFrames = Math.floor(duration / intervalSeconds) + 1;
  const actualMaxFrames = Math.min(maxFrames, estimatedFrames);

  return new Promise((resolve, reject) => {
    const frames: { path: string; timestamp: number }[] = [];

    ffmpeg(videoPath)
      .outputOptions([
        '-vf', `fps=1/${intervalSeconds}`,
        '-frames:v', String(actualMaxFrames),
        '-q:v', '2',
      ])
      .output(`${framesDir}/frame_%04d.jpg`)
      .on('end', async () => {
        // List the generated frames.
        const files = await fs.readdir(framesDir);
        const jpgFiles = files.filter((f) => f.endsWith('.jpg')).sort();
        for (let i = 0; i < jpgFiles.length; i++) {
          frames.push({
            path: join(framesDir, jpgFiles[i]),
            timestamp: i * intervalSeconds,
          });
        }
        onProgress?.(`Extracted ${frames.length} frames.`);
        resolve(frames);
      })
      .on('error', (err) => {
        reject(new Error(`ffmpeg frame extraction failed: ${err.message}`));
      })
      .run();
  });
}

function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data.format.duration || 0);
    });
  });
}

/**
 * Clean up all temp files created during processing.
 */
export async function cleanupTempFiles(videoPath: string): Promise<void> {
  const workDir = join(videoPath, '..');
  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}
