/**
 * Client-side video processing using ffmpeg.wasm.
 *
 * Runs entirely in the browser using WebAssembly. This avoids bundling
 * a 76MB ffmpeg binary into the Netlify function (which would exceed the
 * 250MB function size limit).
 *
 * CRITICAL: ffmpeg.wasm's writeFile() TRANSFERS the underlying ArrayBuffer
 * of any Uint8Array passed to it. We must copy data before each use.
 *
 * MEMORY FIX: The ffmpeg.wasm instance can hit "memory access out of bounds"
 * errors when processing large videos or doing multiple operations. To fix
 * this, we terminate and reload the ffmpeg instance between major operations
 * (audio extraction vs frame extraction) to reset the WASM heap.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js';
const FFMPEG_WASM_URL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm';

/**
 * Check if a Uint8Array's buffer is detached (transferred to a worker).
 */
function isDetached(data: Uint8Array): boolean {
  return data.buffer.byteLength === 0;
}

/**
 * Copy a Uint8Array into a fresh ArrayBuffer.
 */
function copyForFfmpeg(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}

/**
 * Load the ffmpeg.wasm instance (singleton — only loads once per session).
 */
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

/**
 * Terminate the ffmpeg instance and force a reload on next use.
 *
 * This is the key fix for "memory access out of bounds" errors — by
 * terminating and reloading the WASM instance between operations, we
 * reset the WASM heap and avoid memory fragmentation.
 */
async function resetFfmpeg(): Promise<void> {
  if (ffmpegInstance) {
    try {
      ffmpegInstance.terminate();
    } catch {
      // Best-effort.
    }
    ffmpegInstance = null;
    loadPromise = null;
  }
}

/**
 * Download a video URL and return it as a Uint8Array.
 *
 * Uses the server-side /api/video-proxy to avoid CORS issues with
 * Instagram's CDN (which doesn't send CORS headers).
 *
 * If the download fails (CORS, 302 redirect issues, expired URL),
 * it retries up to 5 times with exponential backoff. If all retries
 * fail, it throws an error that tells the pipeline to re-scrape.
 */
export async function downloadVideo(
  videoUrl: string,
  onProgress?: (message: string) => void,
): Promise<Uint8Array> {
  onProgress?.(`Downloading video via proxy...`);

  // Route through our server proxy to avoid CORS.
  const proxyUrl = `/api/video-proxy?videoUrl=${encodeURIComponent(videoUrl)}`;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      if (attempt > 1) {
        const waitMs = 2000 * attempt;
        onProgress?.(`Retry ${attempt}/5 in ${waitMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
      }

      const response = await fetch(proxyUrl, {
        redirect: 'follow',
      });

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

  // Throw a special error that tells the pipeline to re-scrape.
  const error = new Error(
    `Video download failed after 5 attempts. Last error: ${lastError?.message}. ` +
      'The Instagram CDN URL may have expired or is rate-limiting. ' +
      'The pipeline will re-scrape to get a fresh URL.',
  ) as Error & { shouldRescrape?: boolean };
  error.shouldRescrape = true;
  throw error;
}

/**
 * Extract the audio track from a video using ffmpeg.wasm.
 *
 * After extraction, the ffmpeg instance is terminated to free WASM memory
 * before the frame extraction step.
 */
export async function extractAudio(
  videoData: Uint8Array,
  onProgress?: (message: string) => void,
): Promise<{ audioBase64: string; audioSize: number }> {
  console.log('[extractAudio] Starting', {
    videoDataLength: videoData.length,
    isDetached: isDetached(videoData),
  });

  onProgress?.('Loading ffmpeg.wasm (first run downloads ~30MB)...');
  const ffmpeg = await getFfmpeg(onProgress);

  const videoCopy = copyForFfmpeg(videoData);

  onProgress?.('Writing video to ffmpeg...');
  await ffmpeg.writeFile('input.mp4', videoCopy);

  onProgress?.('Extracting audio (16kHz mono MP3)...');
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
  } catch (err) {
    console.error('[extractAudio] exec failed:', err);
    // Check if output exists despite error.
    try {
      const data = await ffmpeg.readFile('output.mp3');
      if (!data || (data as Uint8Array).length === 0) {
        throw err;
      }
      console.log('[extractAudio] Output exists despite error');
    } catch {
      throw new Error(`ffmpeg audio extraction failed: ${(err as Error).message}`);
    }
  }

  onProgress?.('Reading extracted audio...');
  const audioData = await ffmpeg.readFile('output.mp3');

  // Clean up virtual FS.
  try {
    await ffmpeg.deleteFile('input.mp4');
    await ffmpeg.deleteFile('output.mp3');
  } catch {}

  // Copy data out of WASM heap.
  const rawAudio = audioData as Uint8Array;
  const audioBytes = new Uint8Array(rawAudio.length);
  audioBytes.set(rawAudio);

  // Convert to base64.
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < audioBytes.length; i += chunkSize) {
    const chunk = audioBytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const audioBase64 = btoa(binary);

  onProgress?.(`Audio extracted: ${(audioBytes.length / 1024).toFixed(1)} KB`);

  // CRITICAL: Terminate ffmpeg to free WASM memory before frame extraction.
  // This prevents "memory access out of bounds" errors.
  await resetFfmpeg();

  return { audioBase64, audioSize: audioBytes.length };
}

/**
 * Extract frames from a video at a fixed interval using ffmpeg.wasm.
 *
 * The ffmpeg instance is freshly loaded (the previous one was terminated
 * after audio extraction) to ensure clean WASM memory.
 *
 * @param videoData - The video file as a Uint8Array (will be copied internally)
 * @param intervalSeconds - Seconds between frames (default: 1.5)
 * @param maxFrames - Maximum number of frames to extract (default: 50)
 */
export async function extractFrames(
  videoData: Uint8Array,
  intervalSeconds: number = 1.5,
  maxFrames: number = 50,
  onProgress?: (message: string) => void,
): Promise<{ data: Uint8Array; timestamp: number }[]> {
  console.log('[extractFrames] Starting', {
    videoDataLength: videoData.length,
    isDetached: isDetached(videoData),
    intervalSeconds,
    maxFrames,
  });

  if (isDetached(videoData)) {
    throw new Error('videoData buffer is detached — pipeline error.');
  }

  // Load a fresh ffmpeg instance (previous one was terminated after audio).
  onProgress?.('Loading ffmpeg.wasm for frame extraction...');
  const ffmpeg = await getFfmpeg(onProgress);

  const videoCopy = copyForFfmpeg(videoData);

  onProgress?.('Writing video to ffmpeg...');
  await ffmpeg.writeFile('input.mp4', videoCopy);

  onProgress?.(`Extracting up to ${maxFrames} frames (every ${intervalSeconds}s)...`);

  let lastProgressPercent = -1;
  const progressHandler = ({ progress }: { progress: number }) => {
    const percent = Math.round(progress * 100);
    if (percent !== lastProgressPercent && percent < 100) {
      lastProgressPercent = percent;
      const estimatedFrames = Math.min(maxFrames, Math.ceil((percent / 100) * maxFrames));
      onProgress?.(`Extracting frames... ${percent}% (~${estimatedFrames}/${maxFrames})`);
    }
  };

  ffmpeg.on('progress', progressHandler);

  try {
    await ffmpeg.exec([
      '-i', 'input.mp4',
      '-vf', `fps=1/${intervalSeconds},scale=640:-1`,
      '-frames:v', String(maxFrames),
      '-q:v', '5',
      'frame_%04d.jpg',
    ]);
  } catch (err) {
    console.error('[extractFrames] exec failed:', err);
    onProgress?.('Frame extraction had errors, checking partial results...');
  }

  ffmpeg.off('progress', progressHandler);

  // Read all generated frames (may be partial).
  onProgress?.('Reading extracted frames...');
  const frames: { data: Uint8Array; timestamp: number }[] = [];
  for (let i = 1; i <= maxFrames; i++) {
    const filename = `frame_${String(i).padStart(4, '0')}.jpg`;
    try {
      const data = await ffmpeg.readFile(filename);
      if (data && (data as Uint8Array).length > 0) {
        const rawData = data as Uint8Array;
        const copy = new Uint8Array(rawData.length);
        copy.set(rawData);
        frames.push({
          data: copy,
          timestamp: (i - 1) * intervalSeconds,
        });
      }
      await ffmpeg.deleteFile(filename);
    } catch {
      break;
    }
  }

  try {
    await ffmpeg.deleteFile('input.mp4');
  } catch {}

  onProgress?.(`Extracted ${frames.length} frames.`);

  // Terminate to free memory.
  await resetFfmpeg();

  return frames;
}
