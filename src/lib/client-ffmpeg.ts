/**
 * Client-side video processing using ffmpeg.wasm.
 *
 * Runs entirely in the browser using WebAssembly. This avoids bundling
 * a 76MB ffmpeg binary into the Netlify function (which would exceed the
 * 250MB function size limit).
 *
 * - Downloads the video from the Apify-provided URL
 * - Extracts the audio track (for Whisper STT)
 * - Extracts frames at a fixed interval (for OCR)
 *
 * CRITICAL: ffmpeg.wasm's writeFile() TRANSFERS the underlying ArrayBuffer
 * of any Uint8Array passed to it (via postMessage to the worker). This means
 * the SAME videoData CANNOT be used for both extractAudio AND extractFrames —
 * the second call will fail with "ArrayBuffer is detached". We must copy
 * the video data before each writeFile call.
 *
 * The ffmpeg.wasm core is loaded from a CDN on first use (~30MB, cached
 * by the browser for subsequent runs).
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
 *
 * This is necessary because ffmpeg.wasm's writeFile() transfers (detaches)
 * the underlying ArrayBuffer of any Uint8Array passed to it. If we want to
 * use the same data for multiple ffmpeg operations, we must pass a copy
 * each time.
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
    onProgress?.('ffmpeg.wasm already loaded.');
    return ffmpegInstance;
  }

  if (loadPromise) {
    onProgress?.('ffmpeg.wasm is loading...');
    return loadPromise;
  }

  loadPromise = (async () => {
    onProgress?.('Creating ffmpeg.wasm instance...');
    const ffmpeg = new FFmpeg();

    // Listen for progress events.
    ffmpeg.on('progress', ({ progress }) => {
      const percent = Math.round(progress * 100);
      console.log(`[ffmpeg.wasm] Processing: ${percent}%`);
    });

    ffmpeg.on('log', ({ message }) => {
      console.log(`[ffmpeg.wasm] ${message}`);
    });

    onProgress?.('Downloading ffmpeg.wasm core from CDN (~30MB, cached after)...');
    const coreURL = await toBlobURL(FFMPEG_CORE_URL, 'text/javascript');
    onProgress?.('Downloading ffmpeg.wasm WASM binary...');
    const wasmURL = await toBlobURL(FFMPEG_WASM_URL, 'application/wasm');

    onProgress?.('Loading ffmpeg.wasm...');
    await ffmpeg.load({ coreURL, wasmURL });

    ffmpegInstance = ffmpeg;
    onProgress?.('ffmpeg.wasm loaded successfully.');
    return ffmpeg;
  })();

  return loadPromise;
}

/**
 * Download a video URL and return it as a Uint8Array.
 */
export async function downloadVideo(
  videoUrl: string,
  onProgress?: (message: string) => void,
): Promise<Uint8Array> {
  onProgress?.(`Downloading video from ${new URL(videoUrl).hostname}...`);

  const response = await fetch(videoUrl);

  if (!response.ok) {
    throw new Error(`Failed to download video: HTTP ${response.status}`);
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

  // Merge all chunks into a single Uint8Array.
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  onProgress?.(`Video downloaded: ${(totalLength / 1024 / 1024).toFixed(1)} MB (${totalLength} bytes)`);
  return result;
}

/**
 * Extract the audio track from a video using ffmpeg.wasm.
 *
 * @param videoData - The video file as a Uint8Array (will be copied internally)
 * @returns The audio as a base64-encoded MP3 string (for upload to server)
 */
export async function extractAudio(
  videoData: Uint8Array,
  onProgress?: (message: string) => void,
): Promise<{ audioBase64: string; audioSize: number }> {
  console.log('[extractAudio] Starting', {
    videoDataLength: videoData.length,
    isDetached: isDetached(videoData),
  });

  onProgress?.('Loading ffmpeg.wasm (first run downloads ~30MB, cached after)...');
  const ffmpeg = await getFfmpeg(onProgress);

  // CRITICAL: Copy the video data before passing to ffmpeg.writeFile.
  // ffmpeg.writeFile transfers the ArrayBuffer to the worker, detaching it.
  // The original videoData must remain usable for extractFrames.
  const videoCopy = copyForFfmpeg(videoData);
  console.log('[extractAudio] Copied video data for ffmpeg', {
    originalDetached: isDetached(videoData),
    copyDetached: isDetached(videoCopy),
    copyLength: videoCopy.length,
  });

  onProgress?.('Writing video file to ffmpeg virtual FS...');
  try {
    await ffmpeg.writeFile('input.mp4', videoCopy);
    console.log('[extractAudio] writeFile succeeded');
  } catch (err) {
    console.error('[extractAudio] writeFile failed:', err);
    throw new Error(`ffmpeg.writeFile failed: ${(err as Error).message}`);
  }

  onProgress?.('Extracting audio track (16kHz mono MP3)...');
  try {
    await ffmpeg.exec([
      '-i', 'input.mp4',
      '-vn', // no video
      '-acodec', 'libmp3lame',
      '-ar', '16000', // 16kHz sample rate (Whisper)
      '-ac', '1', // mono
      '-b:a', '32k',
      'output.mp3',
    ]);
    console.log('[extractAudio] exec succeeded');
  } catch (err) {
    console.error('[extractAudio] exec failed:', err);
    throw new Error(`ffmpeg.exec (audio) failed: ${(err as Error).message}`);
  }

  onProgress?.('Reading extracted audio...');
  const audioData = await ffmpeg.readFile('output.mp3');
  console.log('[extractAudio] readFile succeeded', {
    audioLength: (audioData as Uint8Array).length,
  });

  // Clean up virtual FS.
  try {
    await ffmpeg.deleteFile('input.mp4');
    await ffmpeg.deleteFile('output.mp3');
  } catch {
    // Best-effort cleanup.
  }

  // Copy the audio data out of the WASM heap.
  const rawAudio = audioData as Uint8Array;
  const audioBytes = new Uint8Array(rawAudio.length);
  audioBytes.set(rawAudio);

  // Convert to base64 for upload.
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < audioBytes.length; i += chunkSize) {
    const chunk = audioBytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const audioBase64 = btoa(binary);

  onProgress?.(`Audio extracted: ${(audioBytes.length / 1024).toFixed(1)} KB`);
  console.log('[extractAudio] Complete', {
    audioSize: audioBytes.length,
    base64Length: audioBase64.length,
  });

  return { audioBase64, audioSize: audioBytes.length };
}

/**
 * Extract frames from a video at a fixed interval using ffmpeg.wasm.
 *
 * @param videoData - The video file as a Uint8Array (will be copied internally)
 * @param intervalSeconds - Seconds between frames (default: 2)
 * @param maxFrames - Maximum number of frames to extract (default: 30)
 * @returns Array of { data: Uint8Array, timestamp: number }
 */
export async function extractFrames(
  videoData: Uint8Array,
  intervalSeconds: number = 2,
  maxFrames: number = 30,
  onProgress?: (message: string) => void,
): Promise<{ data: Uint8Array; timestamp: number }[]> {
  console.log('[extractFrames] Starting', {
    videoDataLength: videoData.length,
    isDetached: isDetached(videoData),
    intervalSeconds,
    maxFrames,
  });

  // CRITICAL CHECK: If the video data is already detached, we can't proceed.
  if (isDetached(videoData)) {
    const error = new Error(
      'videoData buffer is detached — it was already transferred to a worker. ' +
        'This means extractAudio() consumed the buffer before extractFrames() was called. ' +
        'The pipeline must copy the video data before each use.',
    );
    console.error('[extractFrames]', error.message);
    throw error;
  }

  onProgress?.('Loading ffmpeg.wasm...');
  const ffmpeg = await getFfmpeg(onProgress);

  // CRITICAL: Copy the video data before passing to ffmpeg.writeFile.
  // The original videoData was already used by extractAudio, which may have
  // detached its buffer. Even if not, writeFile will detach it.
  const videoCopy = copyForFfmpeg(videoData);
  console.log('[extractFrames] Copied video data for ffmpeg', {
    copyLength: videoCopy.length,
    copyDetached: isDetached(videoCopy),
  });

  onProgress?.('Writing video file to ffmpeg virtual FS...');
  try {
    await ffmpeg.writeFile('input.mp4', videoCopy);
    console.log('[extractFrames] writeFile succeeded');
  } catch (err) {
    console.error('[extractFrames] writeFile failed:', err);
    throw new Error(`ffmpeg.writeFile failed: ${(err as Error).message}`);
  }

  onProgress?.(`Extracting frames every ${intervalSeconds}s...`);

  try {
    await ffmpeg.exec([
      '-i', 'input.mp4',
      '-vf', `fps=1/${intervalSeconds}`,
      '-frames:v', String(maxFrames),
      '-q:v', '2',
      'frame_%04d.jpg',
    ]);
    console.log('[extractFrames] exec succeeded');
  } catch (err) {
    console.error('[extractFrames] exec failed:', err);
    throw new Error(`ffmpeg.exec (frames) failed: ${(err as Error).message}`);
  }

  // Read all generated frames.
  const frames: { data: Uint8Array; timestamp: number }[] = [];
  for (let i = 1; i <= maxFrames; i++) {
    const filename = `frame_${String(i).padStart(4, '0')}.jpg`;
    try {
      const data = await ffmpeg.readFile(filename);
      if (data && (data as Uint8Array).length > 0) {
        const rawData = data as Uint8Array;
        // Copy the data out of the WASM heap into a fresh ArrayBuffer.
        const copy = new Uint8Array(rawData.length);
        copy.set(rawData);
        frames.push({
          data: copy,
          timestamp: (i - 1) * intervalSeconds,
        });
        console.log(`[extractFrames] Read frame ${i}: ${rawData.length} bytes`);
      }
      // Clean up.
      await ffmpeg.deleteFile(filename);
    } catch {
      console.log(`[extractFrames] Frame ${i} not found (video may be shorter)`);
      break;
    }
  }

  // Clean up.
  try {
    await ffmpeg.deleteFile('input.mp4');
  } catch {
    // Best-effort.
  }

  onProgress?.(`Extracted ${frames.length} frames.`);
  console.log('[extractFrames] Complete', { frameCount: frames.length });

  return frames;
}
