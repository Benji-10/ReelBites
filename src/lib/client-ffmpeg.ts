/**
 * Client-side video processing utilities.
 *
 * - downloadVideo: Downloads video via server proxy (avoids CORS)
 * - extractAudio: Uses ffmpeg.wasm to extract audio track for Whisper
 * - extractFrames: Uses native HTML5 <video> + <canvas> (hardware-accelerated, fast)
 *
 * Frame extraction uses native browser APIs instead of ffmpeg.wasm for speed.
 * Audio extraction still uses ffmpeg.wasm (no native alternative for MP3 encoding).
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js';
const FFMPEG_WASM_URL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm';

function isDetached(data: Uint8Array): boolean {
  return data.buffer.byteLength === 0;
}

function copyForFfmpeg(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}

async function getFfmpeg(onProgress?: (message: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    onProgress?.('Loading ffmpeg.wasm...');
    const ffmpeg = new FFmpeg();

    ffmpeg.on('progress', ({ progress }) => {
      const percent = Math.round(progress * 100);
      console.log(`[ffmpeg.wasm] Processing: ${percent}%`);
    });

    ffmpeg.on('log', ({ message }) => {
      console.log(`[ffmpeg.wasm] ${message}`);
    });

    const coreURL = await toBlobURL(FFMPEG_CORE_URL, 'text/javascript');
    const wasmURL = await toBlobURL(FFMPEG_WASM_URL, 'application/wasm');

    await ffmpeg.load({ coreURL, wasmURL });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadPromise;
}

async function resetFfmpeg(): Promise<void> {
  if (ffmpegInstance) {
    try {
      ffmpegInstance.terminate();
    } catch {}
    ffmpegInstance = null;
    loadPromise = null;
  }
}

/**
 * Download a video URL and return it as a Uint8Array.
 * Uses the server-side proxy to avoid CORS issues with Instagram's CDN.
 */
export async function downloadVideo(
  videoUrl: string,
  onProgress?: (message: string) => void,
): Promise<Uint8Array> {
  onProgress?.('Downloading video via proxy...');

  const proxyUrl = `/api/video-proxy?videoUrl=${encodeURIComponent(videoUrl)}`;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      if (attempt > 1) {
        const waitMs = 2000 * attempt;
        onProgress?.(`Retry ${attempt}/5 in ${waitMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
      }

      const response = await fetch(proxyUrl, { redirect: 'follow' });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      if (!response.body) {
        throw new Error('Video download returned no body.');
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;
      let lastProgressUpdate = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
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

      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (totalLength === 0) {
        throw new Error('Downloaded video is empty.');
      }

      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      onProgress?.(`Video downloaded: ${(totalLength / 1024 / 1024).toFixed(1)} MB`);
      return result;
    } catch (err) {
      lastError = err as Error;
      console.error(`[downloadVideo] Attempt ${attempt} failed:`, lastError.message);
    }
  }

  const error = new Error(
    `Video download failed after 5 attempts. Last error: ${lastError?.message}.`,
  ) as Error & { shouldRescrape?: boolean };
  error.shouldRescrape = true;
  throw error;
}

/**
 * Extract the audio track from a video using ffmpeg.wasm.
 * After extraction, the ffmpeg instance is terminated to free WASM memory.
 *
 * Returns null if the video has no audio stream (some Instagram reels
 * are video-only with no sound). The caller should handle this by
 * proceeding without a transcript.
 */
export async function extractAudio(
  videoData: Uint8Array,
  onProgress?: (message: string) => void,
): Promise<{ audioBase64: string; audioSize: number } | null> {
  console.log('[extractAudio] Starting', {
    videoDataLength: videoData.length,
    isDetached: isDetached(videoData),
  });

  onProgress?.('Loading ffmpeg.wasm (first run downloads ~30MB)...');
  const ffmpeg = await getFfmpeg(onProgress);

  const videoCopy = copyForFfmpeg(videoData);

  onProgress?.('Writing video to ffmpeg...');
  await ffmpeg.writeFile('input.mp4', videoCopy);

  // ---- Probe: check if the video has an audio stream ----
  // ffmpeg.wasm doesn't have a direct "probe" API, but we can capture
  // the log output during exec and look for stream info.
  const ffmpegLogs: string[] = [];
  const logHandler = ({ message }: { message: string }) => {
    ffmpegLogs.push(message);
  };
  ffmpeg.on('log', logHandler);

  onProgress?.('Extracting audio (16kHz mono MP3)...');
  let execSucceeded = false;
  try {
    await ffmpeg.exec([
      '-i', 'input.mp4',
      '-vn',
      '-acodec', 'libmp3lame',
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '32k',
      'output.mp3',
    ]);
    execSucceeded = true;
  } catch (err) {
    console.error('[extractAudio] exec failed:', err);
    console.error('[extractAudio] ffmpeg logs:', ffmpegLogs.join('\n'));
  }

  ffmpeg.off('log', logHandler);

  // ---- Check for "no audio stream" in the logs ----
  // ffmpeg outputs "Output file #0 does not contain any stream" when the
  // input video has no audio track. This is not an error — we just skip
  // transcription and proceed with caption + comments + OCR.
  const logsText = ffmpegLogs.join('\n');
  const hasNoAudioStream =
    logsText.includes('Output file #0 does not contain any stream') ||
    logsText.includes('does not contain any stream');

  if (hasNoAudioStream) {
    console.log('[extractAudio] Video has no audio stream — proceeding without transcript.');
    onProgress?.('No audio track in this video — skipping transcription.');

    // Clean up.
    try {
      await ffmpeg.deleteFile('input.mp4');
      await ffmpeg.deleteFile('output.mp3');
    } catch {}

    await resetFfmpeg();
    return null;
  }

  // ---- If exec failed for another reason, check if output exists anyway ----
  if (!execSucceeded) {
    try {
      const data = await ffmpeg.readFile('output.mp3');
      if (!data || (data as Uint8Array).length === 0) {
        // Real failure — provide a detailed error with logs.
        const lastLogs = ffmpegLogs.slice(-10).join('\n');
        throw new Error(
          `ffmpeg audio extraction failed. Last ffmpeg logs:\n${lastLogs}`,
        );
      }
      console.log('[extractAudio] Output exists despite exec error');
    } catch (err) {
      await resetFfmpeg();
      throw err;
    }
  }

  onProgress?.('Reading extracted audio...');
  const audioData = await ffmpeg.readFile('output.mp3');

  try {
    await ffmpeg.deleteFile('input.mp4');
    await ffmpeg.deleteFile('output.mp3');
  } catch {}

  const rawAudio = audioData as Uint8Array;

  if (rawAudio.length === 0) {
    await resetFfmpeg();
    throw new Error(
      'ffmpeg produced an empty audio file. The video may have no audio stream. ' +
      'Last ffmpeg logs:\n' + ffmpegLogs.slice(-10).join('\n'),
    );
  }

  const audioBytes = new Uint8Array(rawAudio.length);
  audioBytes.set(rawAudio);

  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < audioBytes.length; i += chunkSize) {
    const chunk = audioBytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const audioBase64 = btoa(binary);

  onProgress?.(`Audio extracted: ${(audioBytes.length / 1024).toFixed(1)} KB`);

  await resetFfmpeg();

  return { audioBase64, audioSize: audioBytes.length };
}

/**
 * Extract frames from a video at a fixed interval using native HTML5 video + canvas.
 * This is ~100x faster than ffmpeg.wasm for frame extraction.
 *
 * @param videoData - The video file as a Uint8Array
 * @param intervalSeconds - Seconds between frames (default: 1)
 * @param maxFrames - Maximum number of frames to extract (default: 30)
 */
export async function extractFrames(
  videoData: Uint8Array,
  intervalSeconds: number = 1,
  maxFrames: number = 30,
  onProgress?: (message: string) => void,
): Promise<{ data: Uint8Array; timestamp: number }[]> {
  console.log('[extractFrames] Starting native video extraction', {
    videoDataLength: videoData.length,
    intervalSeconds,
    maxFrames,
  });

  // Create a blob URL from the video data.
  const blob = new Blob([videoData], { type: 'video/mp4' });
  const videoUrl = URL.createObjectURL(blob);

  // Create a hidden video element.
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = videoUrl;

  // Wait for the video to load its metadata.
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video metadata'));
    setTimeout(() => reject(new Error('Video load timed out after 15s')), 15000);
  });

  const duration = video.duration;
  console.log('[extractFrames] Video duration:', duration, 'seconds');

  const totalFrames = Math.min(maxFrames, Math.floor(duration / intervalSeconds));
  const timestamps: number[] = [];
  for (let i = 0; i < totalFrames; i++) {
    timestamps.push(Math.min(i * intervalSeconds, duration - 0.1));
  }

  onProgress?.(`Extracting ${timestamps.length} frames from ${duration.toFixed(1)}s video (native)...`);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    URL.revokeObjectURL(videoUrl);
    throw new Error('Could not create canvas context');
  }

  const frames: { data: Uint8Array; timestamp: number }[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];

    try {
      await seekTo(video, timestamp);

      const targetWidth = 480;
      const scale = targetWidth / video.videoWidth;
      canvas.width = targetWidth;
      canvas.height = Math.round(video.videoHeight * scale);

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const frameBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.7);
      });

      if (frameBlob) {
        const arrayBuffer = await frameBlob.arrayBuffer();
        frames.push({
          data: new Uint8Array(arrayBuffer),
          timestamp,
        });
      }

      if (i % 5 === 0 || i === timestamps.length - 1) {
        const pct = Math.round(((i + 1) / timestamps.length) * 100);
        onProgress?.(`Extracting frames: ${pct}% (${i + 1}/${timestamps.length})`);
      }
    } catch (err) {
      console.warn(`[extractFrames] Frame at ${timestamp}s failed:`, err);
    }
  }

  URL.revokeObjectURL(videoUrl);
  video.src = '';

  onProgress?.(`Extracted ${frames.length} frames.`);
  console.log('[extractFrames] Complete:', frames.length, 'frames');

  return frames;
}

function seekTo(video: HTMLVideoElement, timestamp: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      requestAnimationFrame(() => resolve());
    };
    const onError = () => {
      video.removeEventListener('error', onError);
      reject(new Error(`Seek to ${timestamp}s failed`));
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);

    video.currentTime = timestamp;

    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    }, 3000);
  });
}
