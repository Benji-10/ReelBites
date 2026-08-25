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
 * The ffmpeg.wasm core is loaded from a CDN on first use (~30MB, cached
 * by the browser for subsequent runs).
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js';
const FFMPEG_WASM_URL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm';

/**
 * Load the ffmpeg.wasm instance (singleton — only loads once per session).
 */
async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();

    // Listen for progress events.
    ffmpeg.on('progress', ({ progress }) => {
      const percent = Math.round(progress * 100);
      console.log(`[ffmpeg.wasm] Processing: ${percent}%`);
    });

    ffmpeg.on('log', ({ message }) => {
      console.log(`[ffmpeg.wasm] ${message}`);
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(FFMPEG_CORE_URL, 'text/javascript'),
      wasmURL: await toBlobURL(FFMPEG_WASM_URL, 'application/wasm'),
    });

    ffmpegInstance = ffmpeg;
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

  const response = await fetch(videoUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

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

  onProgress?.(`Video downloaded: ${(totalLength / 1024 / 1024).toFixed(1)} MB`);
  return result;
}

/**
 * Extract the audio track from a video using ffmpeg.wasm.
 *
 * @param videoData - The video file as a Uint8Array
 * @returns The audio as a base64-encoded MP3 string (for upload to server)
 */
export async function extractAudio(
  videoData: Uint8Array,
  onProgress?: (message: string) => void,
): Promise<{ audioBase64: string; audioSize: number }> {
  onProgress?.('Loading ffmpeg.wasm (first run downloads ~30MB, cached after)...');
  const ffmpeg = await getFfmpeg();

  onProgress?.('Writing video file to ffmpeg virtual FS...');
  await ffmpeg.writeFile('input.mp4', videoData);

  onProgress?.('Extracting audio track (16kHz mono MP3)...');
  await ffmpeg.exec([
    '-i', 'input.mp4',
    '-vn', // no video
    '-acodec', 'libmp3lame',
    '-ar', '16000', // 16kHz sample rate (Whisper)
    '-ac', '1', // mono
    '-b:a', '32k',
    'output.mp3',
  ]);

  onProgress?.('Reading extracted audio...');
  const audioData = await ffmpeg.readFile('output.mp3');

  // Clean up virtual FS.
  try {
    await ffmpeg.deleteFile('input.mp4');
    await ffmpeg.deleteFile('output.mp3');
  } catch {
    // Best-effort cleanup.
  }

  // Convert to base64 for upload.
  const audioBytes = audioData as Uint8Array;
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < audioBytes.length; i += chunkSize) {
    const chunk = audioBytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const audioBase64 = btoa(binary);

  onProgress?.(`Audio extracted: ${(audioBytes.length / 1024).toFixed(1)} KB`);
  return { audioBase64, audioSize: audioBytes.length };
}

/**
 * Extract frames from a video at a fixed interval using ffmpeg.wasm.
 *
 * @param videoData - The video file as a Uint8Array
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
  onProgress?.('Loading ffmpeg.wasm...');
  const ffmpeg = await getFfmpeg();

  onProgress?.('Writing video file to ffmpeg virtual FS...');
  await ffmpeg.writeFile('input.mp4', videoData);

  onProgress?.(`Extracting frames every ${intervalSeconds}s...`);

  // Extract frames at 1/intervalSeconds fps.
  await ffmpeg.exec([
    '-i', 'input.mp4',
    '-vf', `fps=1/${intervalSeconds}`,
    '-frames:v', String(maxFrames),
    '-q:v', '2',
    'frame_%04d.jpg',
  ]);

  // Read all generated frames.
  const frames: { data: Uint8Array; timestamp: number }[] = [];
  for (let i = 1; i <= maxFrames; i++) {
    const filename = `frame_${String(i).padStart(4, '0')}.jpg`;
    try {
      const data = await ffmpeg.readFile(filename);
      if (data && (data as Uint8Array).length > 0) {
        frames.push({
          data: data as Uint8Array,
          timestamp: (i - 1) * intervalSeconds,
        });
      }
      // Clean up.
      await ffmpeg.deleteFile(filename);
    } catch {
      // Frame doesn't exist (video may be shorter than expected).
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
  return frames;
}
