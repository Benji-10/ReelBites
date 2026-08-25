/**
 * Video processing utilities using ffmpeg.
 *
 * - Downloads the Instagram video to a temp file.
 * - Extracts the audio track (for Whisper STT).
 * - Extracts frames at a fixed interval (for OCR).
 *
 * FFmpeg binary resolution strategy (tries in order):
 *   1. System ffmpeg at common Linux paths (/usr/bin/ffmpeg, etc.)
 *   2. @ffmpeg-installer/ffmpeg package (robust path resolution)
 *   3. ffmpeg-static package (fallback)
 *   4. PATH lookup via `which ffmpeg`
 *
 * On Netlify, the binary files from these packages must be included in the
 * function bundle via `included_files` in netlify.toml.
 */

import ffmpeg from 'fluent-ffmpeg';
import { existsSync, chmodSync, accessSync, constants } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

/**
 * Check if a file exists AND is executable.
 */
function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to make a file executable (best-effort — may fail on read-only filesystems).
 */
function makeExecutable(filePath: string): void {
  try {
    chmodSync(filePath, 0o755);
    console.log(`[ffmpeg] Set executable permission on: ${filePath}`);
  } catch (err) {
    console.warn(`[ffmpeg] Could not chmod ${filePath}:`, (err as Error).message);
  }
}

/**
 * Resolve the ffmpeg binary path.
 *
 * Tries multiple sources in order of reliability on serverless platforms.
 * Returns the path to a working ffmpeg binary, or null if none found.
 */
function resolveFfmpegPath(): string | null {
  const triedPaths: string[] = [];

  // 1. Try the project's bin/ffmpeg (downloaded during build by scripts/download-ffmpeg.js).
  // This is the most reliable source because the binary is committed to the
  // function bundle via included_files in netlify.toml.
  // We check several possible locations where the binary might end up:
  //   - /var/task/bin/ffmpeg  (Netlify Lambda root)
  //   - ./bin/ffmpeg           (relative to CWD)
  //   - /opt/bin/ffmpeg        (Lambda layer)
  const projectPaths = [
    '/var/task/bin/ffmpeg',
    join(process.cwd(), 'bin', 'ffmpeg'),
    '/opt/bin/ffmpeg',
  ];
  for (const p of projectPaths) {
    triedPaths.push(p);
    if (existsSync(p)) {
      makeExecutable(p);
      if (isExecutable(p)) {
        console.log('[ffmpeg] Using project ffmpeg at:', p);
        return p;
      }
    }
  }

  // 2. Try common system locations.
  const systemPaths = [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ];
  for (const p of systemPaths) {
    triedPaths.push(p);
    if (existsSync(p)) {
      if (isExecutable(p)) {
        console.log('[ffmpeg] Using system ffmpeg at:', p);
        return p;
      }
      makeExecutable(p);
      if (isExecutable(p)) {
        console.log('[ffmpeg] Using system ffmpeg at:', p, '(after chmod)');
        return p;
      }
    }
  }

  // 3. Try ffmpeg-static as a fallback.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && typeof ffmpegStatic === 'string') {
      triedPaths.push(`ffmpeg-static → ${ffmpegStatic}`);
      if (existsSync(ffmpegStatic)) {
        makeExecutable(ffmpegStatic);
        if (isExecutable(ffmpegStatic)) {
          console.log('[ffmpeg] Using ffmpeg-static at:', ffmpegStatic);
          return ffmpegStatic;
        }
      }
    }
  } catch (err) {
    console.warn('[ffmpeg] Could not load ffmpeg-static:', (err as Error).message);
  }

  // 4. Try `which ffmpeg` (PATH lookup).
  try {
    const which = execSync('which ffmpeg 2>/dev/null', { encoding: 'utf8' }).trim();
    if (which) {
      triedPaths.push(`which → ${which}`);
      if (isExecutable(which)) {
        console.log('[ffmpeg] Using ffmpeg from PATH at:', which);
        return which;
      }
    }
  } catch {
    // ffmpeg not on PATH.
  }

  console.error('[ffmpeg] No ffmpeg binary found. Tried:');
  triedPaths.forEach((p) => console.error(`  - ${p}`));

  return null;
}

// Resolve and set the ffmpeg path at module load time.
const resolvedFfmpegPath = resolveFfmpegPath();
if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
} else {
  console.error('[ffmpeg] WARNING: No ffmpeg binary available. Audio/frame extraction will fail.');
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
 * Get the resolved ffmpeg path (for debugging/inspection).
 */
export function getFfmpegPath(): string | null {
  return resolvedFfmpegPath;
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
      'ffmpeg binary not found. Tried: /usr/bin/ffmpeg, /usr/local/bin/ffmpeg, ' +
        '/opt/bin/ffmpeg, @ffmpeg-installer/ffmpeg, ffmpeg-static, and PATH lookup. ' +
        'None were available in the Netlify function environment. ' +
        'Check the function logs for "[ffmpeg]" messages to see what was tried.',
    );
  }

  const audioPath = videoPath.replace(/\.mp4$/, '.mp3');
  onProgress?.(`Extracting audio with ffmpeg (${resolvedFfmpegPath})...`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-vn',
        '-acodec', 'libmp3lame',
        '-ar', '16000',
        '-ac', '1',
        '-b:a', '32k',
      ])
      .output(audioPath)
      .on('start', (commandLine) => {
        console.log('[ffmpeg] Running command:', commandLine);
      })
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
