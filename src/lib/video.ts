/**
 * Server-side video utilities (fluent-ffmpeg + runtime-resolved ffmpeg binary).
 *
 * IMPORTANT — Netlify 250 MB function size limit:
 * ffmpeg-static and @ffmpeg-installer/ffmpeg ship ~77 MB and ~66 MB static
 * binaries. Bundling them into the Next.js server bundle pushed the
 * ___netlify-handler function past Netlify's 250 MB deploy limit, so those
 * packages are NOT dependencies anymore. Instead the binary is resolved
 * lazily at runtime, in this order:
 *
 *   1. FFMPEG_PATH / FFMPEG_BIN env var (explicit override)
 *   2. `ffmpeg` on the system PATH (local dev machines)
 *   3. /tmp/realbites-video/bin/ffmpeg (downloaded by a previous invocation
 *      of this warm function instance)
 *   4. one-time download of a static build (cached in /tmp per instance):
 *        a. @ffmpeg-installer tarball from the npm registry (reliable CDN)
 *        b. ffmpeg-static release from GitHub (fallback)
 *
 * The download only happens on cold starts; warm invocations reuse /tmp.
 *
 * Everything here is defensive: no-audio reels, unsupported codecs, and
 * download failures must NOT break the extraction pipeline — every function
 * returns null (or an empty array) on failure instead of throwing.
 *
 * NOTE: these run server-side (Node runtime). The client-side pipeline
 * (src/lib/client-ffmpeg.ts) does the same jobs in WASM for the browser.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { gunzipSync } from 'zlib';
import ffmpeg from 'fluent-ffmpeg';

/** Temp directory for video/audio/frame scratch files (and the ffmpeg binary). */
const TMP_DIR = path.join(os.tmpdir(), 'realbites-video');
const FFMPEG_BIN = path.join(TMP_DIR, 'bin', 'ffmpeg');

/** Static-build download sources (linux only — Netlify functions run linux). */
const REGISTRY_TARBALLS: Record<string, string> = {
  'linux-x64':
    'https://registry.npmjs.org/@ffmpeg-installer/linux-x64/-/linux-x64-4.1.0.tgz',
  'linux-arm64':
    'https://registry.npmjs.org/@ffmpeg-installer/linux-arm64/-/linux-arm64-4.1.4.tgz',
};
const GITHUB_RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1';

// ---------------------------------------------------------------------------
// ffmpeg binary resolution
// ---------------------------------------------------------------------------

export interface FfmpegResolution {
  path: string;
  source: string;
}

let resolvedFfmpeg: FfmpegResolution | null = null;
let resolvePromise: Promise<FfmpegResolution | null> | null = null;

function execWorks(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile(bin, ['-version'], { timeout: 10000 }, (err) => resolve(!err));
    } catch {
      resolve(false);
    }
  });
}

/** Minimal tar reader: return the data for `entryName` ("package/ffmpeg"), or null. */
function extractTarEntry(tar: Buffer, entryName: string): Buffer | null {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    // End-of-archive: a zero block.
    if (header.every((b) => b === 0)) break;

    const name = header
      .subarray(0, 100)
      .toString('utf8')
      .replace(/\0.*$/, '')
      .replace(/^\.\//, '');
    const sizeField = header
      .subarray(124, 136)
      .toString('utf8')
      .replace(/\0.*$/, '')
      .trim();
    const size = sizeField ? parseInt(sizeField, 8) : NaN;
    if (Number.isNaN(size)) break;

    const dataStart = offset + 512;
    if (name === entryName) {
      return tar.subarray(dataStart, dataStart + size);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function fetchBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function platformKey(): string | null {
  if (process.platform !== 'linux') return null;
  if (process.arch === 'x64') return 'linux-x64';
  if (process.arch === 'arm64') return 'linux-arm64';
  return null;
}

/** Download a static ffmpeg build to `dest` (two sources, npm registry first). */
async function downloadFfmpegTo(dest: string): Promise<void> {
  const key = platformKey();
  if (!key) {
    throw new Error(
      `No static ffmpeg download available for ${process.platform}-${process.arch}. ` +
        'Install ffmpeg on the system PATH or set FFMPEG_PATH.',
    );
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const errors: string[] = [];

  // Source 1: npm registry tarball (very reliable CDN, no rate limits).
  const tarballUrl = process.env.FFMPEG_TARBALL_URL || REGISTRY_TARBALLS[key];
  try {
    const tgz = await fetchBuffer(tarballUrl, 120000);
    const tar = gunzipSync(tgz);
    const bin = extractTarEntry(tar, 'package/ffmpeg');
    if (!bin || bin.length < 10 * 1024 * 1024) {
      throw new Error(
        `unexpected tarball contents (extracted ${bin ? Math.round(bin.length / 1024) : 0}KB)`,
      );
    }
    fs.writeFileSync(dest, bin);
    fs.chmodSync(dest, 0o755);
    return;
  } catch (err) {
    errors.push(`registry tarball: ${(err as Error).message}`);
  }

  // Source 2: ffmpeg-static GitHub release (gzipped raw binary).
  const gzUrl = process.env.FFMPEG_GZ_URL || `${GITHUB_RELEASE}/ffmpeg-${key}.gz`;
  try {
    const gz = await fetchBuffer(gzUrl, 120000);
    const bin = gunzipSync(gz);
    if (bin.length < 10 * 1024 * 1024) {
      throw new Error('unexpected binary size');
    }
    fs.writeFileSync(dest, bin);
    fs.chmodSync(dest, 0o755);
    return;
  } catch (err) {
    errors.push(`github release: ${(err as Error).message}`);
  }

  throw new Error(`all download sources failed (${errors.join('; ')})`);
}

async function doResolveFfmpeg(): Promise<FfmpegResolution | null> {
  // 1. Explicit override.
  for (const envVar of ['FFMPEG_PATH', 'FFMPEG_BIN']) {
    const candidate = process.env[envVar];
    if (candidate) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return { path: candidate, source: `${envVar} env var` };
      } catch {
        console.warn(`[video] ${envVar} is set but not an executable file: ${candidate}`);
      }
    }
  }

  // 2. System ffmpeg (local dev machines).
  if (await execWorks('ffmpeg')) {
    return { path: 'ffmpeg', source: 'system PATH' };
  }

  // 3./4. Static binary in /tmp (warm-instance cache) or downloaded on demand.
  try {
    if (fs.existsSync(FFMPEG_BIN)) {
      if (await execWorks(FFMPEG_BIN)) {
        return { path: FFMPEG_BIN, source: '/tmp cache (previous invocation)' };
      }
      // Partial/corrupt file from an interrupted download — start over.
      fs.unlinkSync(FFMPEG_BIN);
    }
  } catch {
    // Ignore /tmp inspection failures and fall through to the download.
  }

  try {
    console.log('[video] No local ffmpeg — downloading static build to /tmp (cached per instance)...');
    await downloadFfmpegTo(FFMPEG_BIN);
    if (await execWorks(FFMPEG_BIN)) {
      return { path: FFMPEG_BIN, source: 'runtime download (/tmp)' };
    }
    try {
      fs.unlinkSync(FFMPEG_BIN);
    } catch {}
    return null;
  } catch (err) {
    console.error('[video] ffmpeg download failed:', (err as Error).message);
    return null;
  }
}

/**
 * Resolve the ffmpeg binary at runtime (see the resolution order at the top
 * of this file). Memoized per function instance — the ~30MB download happens
 * at most once per cold start. Returns null when no binary is available
 * (callers degrade gracefully; recipe-pipeline falls back to sending the
 * video file directly to Whisper).
 */
export function resolveFfmpeg(): Promise<FfmpegResolution | null> {
  if (resolvedFfmpeg) return Promise.resolve(resolvedFfmpeg);
  if (!resolvePromise) {
    resolvePromise = doResolveFfmpeg().then((res) => {
      resolvedFfmpeg = res;
      if (res) {
        ffmpeg.setFfmpegPath(res.path);
        console.log(`[video] ffmpeg resolved via ${res.source}: ${res.path}`);
      } else {
        console.warn('[video] No ffmpeg binary available — video features degrade gracefully.');
      }
      return res;
    });
    // If resolution failed, allow a later retry (transient network issues).
    resolvePromise.finally(() => {
      if (!resolvedFfmpeg) resolvePromise = null;
    });
  }
  return resolvePromise;
}

/** Convenience wrapper: just the path (or null). */
export async function resolveFfmpegPath(): Promise<string | null> {
  return (await resolveFfmpeg())?.path ?? null;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function ensureTmpDir(): string {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
  return TMP_DIR;
}

/** Remove a file/section of files, ignoring errors. */
export function cleanupFiles(files: string[]): void {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // Best effort only.
    }
  }
}

// ---------------------------------------------------------------------------
// Video utilities
// ---------------------------------------------------------------------------

export interface VideoMetadata {
  duration: number | null; // seconds
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  sizeBytes: number | null;
}

/**
 * Download a video URL to a temp file.
 * Returns the local file path, or null on failure.
 */
export async function downloadVideoToFile(url: string): Promise<string | null> {
  const tmpDir = ensureTmpDir();
  const dest = path.join(tmpDir, `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RealBites/1.0)' },
    });
    clearTimeout(timeout);

    if (!response.ok || !response.body) {
      console.warn(`[video] Download failed: HTTP ${response.status}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      console.warn('[video] Downloaded video is empty.');
      return null;
    }

    fs.writeFileSync(dest, buffer);
    console.log(`[video] Downloaded ${Math.round(buffer.length / 1024)}KB to ${dest}`);
    return dest;
  } catch (err) {
    console.warn('[video] Download failed:', (err as Error).message);
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch {}
    return null;
  }
}

/**
 * Get video metadata by parsing `ffmpeg -i` stderr — this deliberately avoids
 * ffprobe (which is NOT shipped with most static ffmpeg builds).
 * Returns null if the video can't be read (or ffmpeg is unavailable).
 */
export async function getVideoMetadata(filePath: string): Promise<VideoMetadata | null> {
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) return null;

  return new Promise((resolve) => {
    try {
      // `ffmpeg -i` without an output file exits non-zero, but prints all the
      // information we need to stderr.
      execFile(
        ffmpegPath,
        ['-hide_banner', '-i', filePath],
        { timeout: 30000 },
        (_err, _stdout, stderr) => {
          try {
            const out = stderr || '';
            const lines = out.split('\n');
            const videoLine = lines.find((l) => l.includes(': Video:'));
            const audioLine = lines.find((l) => l.includes(': Audio:'));
            const durationMatch = out.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
            const dimMatch = videoLine?.match(/(\d{2,5})x(\d{2,5})/);

            const duration = durationMatch
              ? parseInt(durationMatch[1], 10) * 3600 +
                parseInt(durationMatch[2], 10) * 60 +
                parseFloat(durationMatch[3])
              : null;

            if (duration === null && !videoLine && !audioLine) {
              resolve(null);
              return;
            }

            let sizeBytes: number | null = null;
            try {
              sizeBytes = fs.statSync(filePath).size;
            } catch {}

            resolve({
              duration,
              width: dimMatch ? parseInt(dimMatch[1], 10) : null,
              height: dimMatch ? parseInt(dimMatch[2], 10) : null,
              hasAudio: !!audioLine,
              sizeBytes,
            });
          } catch {
            resolve(null);
          }
        },
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Extract the audio track from a local video file as MP3.
 * Returns the output file path, or null when the video has no audio track
 * (or extraction fails for any reason) — no-audio reels are NOT an error.
 */
export async function extractAudio(
  filePath: string,
  outputExtension = 'mp3',
): Promise<string | null> {
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) {
    console.warn('[video] ffmpeg unavailable — skipping audio extraction.');
    return null;
  }

  return new Promise((resolve) => {
    try {
      const tmpDir = ensureTmpDir();
      const output = path.join(tmpDir, `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${outputExtension}`);

      ffmpeg(filePath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioFrequency(16000)
        .audioChannels(1)
        .output(output)
        .on('end', () => {
          console.log(`[video] Audio extracted to ${output}`);
          resolve(output);
        })
        .on('error', (err) => {
          // No audio track is the most common "error" — log and return null.
          console.warn('[video] Audio extraction failed (no-audio reel?):', err.message);
          try {
            if (fs.existsSync(output)) fs.unlinkSync(output);
          } catch {}
          resolve(null);
        })
        .run();
    } catch (err) {
      console.warn('[video] extractAudio threw:', (err as Error).message);
      resolve(null);
    }
  });
}

/**
 * Extract an audio CLIP (a time range) from a local video file.
 * Returns the output file path, or null on failure.
 */
export async function extractAudioClip(
  filePath: string,
  startTime: number,
  durationSeconds: number,
  outputExtension = 'mp3',
): Promise<string | null> {
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) {
    console.warn('[video] ffmpeg unavailable — skipping audio clip extraction.');
    return null;
  }

  return new Promise((resolve) => {
    try {
      const tmpDir = ensureTmpDir();
      const output = path.join(tmpDir, `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${outputExtension}`);

      ffmpeg(filePath)
        .seekInput(Math.max(0, startTime))
        .duration(Math.max(0.1, durationSeconds))
        .noVideo()
        .audioCodec('libmp3lame')
        .audioFrequency(16000)
        .audioChannels(1)
        .output(output)
        .on('end', () => resolve(output))
        .on('error', (err) => {
          console.warn('[video] Audio clip extraction failed:', err.message);
          try {
            if (fs.existsSync(output)) fs.unlinkSync(output);
          } catch {}
          resolve(null);
        })
        .run();
    } catch (err) {
      console.warn('[video] extractAudioClip threw:', (err as Error).message);
      resolve(null);
    }
  });
}

/**
 * Extract frames from a local video file at a fixed interval, for OCR.
 * Returns JPEG file paths (empty array on failure — never throws).
 */
export async function extractFrames(
  filePath: string,
  intervalSeconds = 2,
  maxFrames = 30,
): Promise<string[]> {
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) {
    console.warn('[video] ffmpeg unavailable — skipping frame extraction.');
    return [];
  }

  return new Promise((resolve) => {
    try {
      const tmpDir = ensureTmpDir();
      const framePattern = path.join(tmpDir, `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-%03d.jpg`);

      ffmpeg(filePath)
        .noAudio()
        .outputOptions([
          `-vf fps=1/${Math.max(0.5, intervalSeconds)}`,
          '-frames:v ' + Math.max(1, maxFrames),
          '-q:v 3',
        ])
        .output(framePattern)
        .on('end', () => {
          try {
            const prefix = path.basename(framePattern).replace('%03d.jpg', '');
            const frames = fs
              .readdirSync(tmpDir)
              .filter((f) => f.startsWith(prefix) && f.endsWith('.jpg'))
              .sort()
              .map((f) => path.join(tmpDir, f));
            console.log(`[video] Extracted ${frames.length} frames.`);
            resolve(frames);
          } catch (err) {
            console.warn('[video] Could not list extracted frames:', (err as Error).message);
            resolve([]);
          }
        })
        .on('error', (err) => {
          console.warn('[video] Frame extraction failed:', err.message);
          resolve([]);
        })
        .run();
    } catch (err) {
      console.warn('[video] extractFrames threw:', (err as Error).message);
      resolve([]);
    }
  });
}

// ---------------------------------------------------------------------------
// Diagnostics (used by /api/debug/ffmpeg)
// ---------------------------------------------------------------------------

/**
 * Run `ffmpeg -version` to check the binary works (used by /api/debug/ffmpeg).
 * Returns the first line of output, or null if no binary can be resolved.
 */
export async function checkFfmpegWorks(): Promise<string | null> {
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) return null;

  return new Promise((resolve) => {
    try {
      execFile(ffmpegPath, ['-version'], { timeout: 10000 }, (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve(stdout.split('\n')[0] || null);
      });
    } catch {
      resolve(null);
    }
  });
}

export interface FfmpegDiagnostics {
  sourcesTried: Array<{ source: string; path: string | null }>;
  resolvedPath: string | null;
  resolvedSource: string | null;
  platform: string;
  arch: string;
  tmpDir: string;
  tmpBinaryExists: boolean;
  lambdaRuntime: string | null;
}

/**
 * Resolve ffmpeg (triggering the runtime download if needed) and report the
 * full resolution chain — used by /api/debug/ffmpeg.
 */
export async function getFfmpegDiagnostics(): Promise<FfmpegDiagnostics> {
  const resolution = await resolveFfmpeg();

  let systemFfmpeg: string | null = null;
  if (await execWorks('ffmpeg')) systemFfmpeg = 'ffmpeg';

  return {
    sourcesTried: [
      { source: 'FFMPEG_PATH env', path: process.env.FFMPEG_PATH || null },
      { source: 'FFMPEG_BIN env', path: process.env.FFMPEG_BIN || null },
      { source: 'system PATH (ffmpeg)', path: systemFfmpeg },
      { source: '/tmp cached binary', path: fs.existsSync(FFMPEG_BIN) ? FFMPEG_BIN : null },
    ],
    resolvedPath: resolution?.path ?? null,
    resolvedSource: resolution?.source ?? null,
    platform: process.platform,
    arch: process.arch,
    tmpDir: os.tmpdir(),
    tmpBinaryExists: fs.existsSync(FFMPEG_BIN),
    lambdaRuntime: process.env.AWS_EXECUTION_ENV || null,
  };
}
