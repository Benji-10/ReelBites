/**
 * Video processing utilities using ffmpeg.
 *
 * - Downloads the Instagram video to a temp file.
 * - Extracts the audio track (for Whisper STT).
 * - Extracts frames at a fixed interval (for OCR).
 *
 * Uses ffmpeg-static for the ffmpeg binary so it works in serverless
 * environments (Netlify Functions) without needing a system ffmpeg install.
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

// Point fluent-ffmpeg at the static binary.
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
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
