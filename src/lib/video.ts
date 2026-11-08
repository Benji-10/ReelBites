/**
 * Server-side video utilities using ffmpeg-static + fluent-ffmpeg.
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
import { execFile, execSync } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';

// Prefer ffmpeg-static, fall back to @ffmpeg-installer, then system ffmpeg.
const FFMPEG_PATH: string =
  (ffmpegStatic as unknown as string) ||
  ffmpegInstaller.path ||
  'ffmpeg';

ffmpeg.setFfmpegPath(FFMPEG_PATH);

export { FFMPEG_PATH };

/** Temp directory for video/audio/frame scratch files. */
const TMP_DIR = path.join(os.tmpdir(), 'realbites-video');

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
 * Get video metadata via ffprobe-style inspection (fluent-ffmpeg).
 * Returns null if the video can't be read.
 */
export function getVideoMetadata(filePath: string): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    try {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) {
          console.warn('[video] ffprobe failed:', err.message);
          resolve(null);
          return;
        }

        const format = data.format || {};
        const videoStream = (data.streams || []).find((s) => s.codec_type === 'video');
        const audioStream = (data.streams || []).find((s) => s.codec_type === 'audio');

        resolve({
          duration: typeof format.duration === 'string' ? parseFloat(format.duration) : null,
          width: videoStream?.width ?? null,
          height: videoStream?.height ?? null,
          hasAudio: !!audioStream,
          sizeBytes: typeof format.size === 'string' ? parseInt(format.size, 10) : null,
        });
      });
    } catch (err) {
      console.warn('[video] getVideoMetadata threw:', (err as Error).message);
      resolve(null);
    }
  });
}

/**
 * Extract the audio track from a local video file as MP3.
 * Returns the output file path, or null when the video has no audio track
 * (or extraction fails for any reason) — no-audio reels are NOT an error.
 */
export function extractAudio(
  filePath: string,
  outputExtension = 'mp3',
): Promise<string | null> {
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
export function extractAudioClip(
  filePath: string,
  startTime: number,
  durationSeconds: number,
  outputExtension = 'mp3',
): Promise<string | null> {
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
export function extractFrames(
  filePath: string,
  intervalSeconds = 2,
  maxFrames = 30,
): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      const tmpDir = ensureTmpDir();
      const framePattern = path.join(tmpDir, `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-%03d.jpg`);

      ffmpeg(filePath)
        .screenshots({
          times: undefined as unknown as number[],
          count: undefined as unknown as number,
          folder: tmpDir,
          filename: path.basename(framePattern),
          timemarks: undefined as unknown as string[],
        })
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

/**
 * Run `ffmpeg -version` to check the binary works (used by /api/debug/ffmpeg).
 * Returns the first line of output, or null if the binary can't run.
 */
export function checkFfmpegWorks(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(FFMPEG_PATH, ['-version'], { timeout: 10000 }, (err, stdout) => {
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

/**
 * Resolve the ffmpeg binary path from the various sources (for diagnostics).
 */
export function getFfmpegDiagnostics(): {
  sourcesTried: Array<{ source: string; path: string | null }>;
  resolvedPath: string;
  platform: string;
  arch: string;
  tmpDir: string;
  lambdaRuntime: string | null;
} {
  let systemFfmpeg: string | null = null;
  try {
    // `which ffmpeg` equivalent — cheap sync check on common paths.
    systemFfmpeg = execSync('which ffmpeg 2>/dev/null || where ffmpeg 2>nul', { encoding: 'utf8' }).trim() || null;
  } catch {
    systemFfmpeg = null;
  }

  return {
    sourcesTried: [
      { source: 'ffmpeg-static', path: (ffmpegStatic as unknown as string) || null },
      { source: '@ffmpeg-installer/ffmpeg', path: ffmpegInstaller.path || null },
      { source: 'system (which ffmpeg)', path: systemFfmpeg },
    ],
    resolvedPath: FFMPEG_PATH,
    platform: process.platform,
    arch: process.arch,
    tmpDir: os.tmpdir(),
    lambdaRuntime: process.env.AWS_EXECUTION_ENV || null,
  };
}
