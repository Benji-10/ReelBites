/**
 * Fast frame extraction using native HTML5 <video> + <canvas>.
 *
 * Instead of ffmpeg.wasm (which is extremely slow), this uses the browser's
 * built-in hardware-accelerated video decoder to seek to specific timestamps
 * and capture frames via canvas. This is ~100x faster than ffmpeg.wasm.
 *
 * The video data (Uint8Array) is converted to a blob URL, loaded into a
 * hidden <video> element, and we seek to each timestamp to capture frames.
 */

/**
 * Extract frames from a video at a fixed interval using HTML5 video + canvas.
 *
 * @param videoData - The video file as a Uint8Array
 * @param intervalSeconds - Seconds between frames (default: 1)
 * @param maxFrames - Maximum number of frames to extract (default: 30)
 * @returns Array of { data: Uint8Array, timestamp: number }
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

  // Wait for the video to load its metadata (to get duration).
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video metadata'));
    // Timeout in case the video doesn't load.
    setTimeout(() => reject(new Error('Video load timed out after 15s')), 15000);
  });

  const duration = video.duration;
  console.log('[extractFrames] Video duration:', duration, 'seconds');

  // Calculate frame timestamps.
  const totalFrames = Math.min(maxFrames, Math.floor(duration / intervalSeconds));
  const timestamps: number[] = [];
  for (let i = 0; i < totalFrames; i++) {
    timestamps.push(Math.min(i * intervalSeconds, duration - 0.1));
  }

  onProgress?.(`Extracting ${timestamps.length} frames from ${duration.toFixed(1)}s video (native)...`);

  // Create a canvas for capturing frames.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    URL.revokeObjectURL(videoUrl);
    throw new Error('Could not create canvas context');
  }

  const frames: { data: Uint8Array; timestamp: number }[] = [];

  // Seek to each timestamp and capture a frame.
  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];

    try {
      // Seek the video to the timestamp.
      await seekTo(video, timestamp);

      // Set canvas size to match video (scaled down for speed).
      const targetWidth = 480;
      const scale = targetWidth / video.videoWidth;
      canvas.width = targetWidth;
      canvas.height = Math.round(video.videoHeight * scale);

      // Draw the current video frame to the canvas.
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Get the image data as JPEG.
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.7);
      });

      if (blob) {
        const arrayBuffer = await blob.arrayBuffer();
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

  // Clean up.
  URL.revokeObjectURL(videoUrl);
  video.src = '';

  onProgress?.(`Extracted ${frames.length} frames.`);
  console.log('[extractFrames] Complete:', frames.length, 'frames');

  return frames;
}

/**
 * Seek a video element to a specific timestamp and wait for the frame to be ready.
 */
function seekTo(video: HTMLVideoElement, timestamp: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      // Small delay to ensure the frame is fully rendered.
      requestAnimationFrame(() => resolve());
    };
    const onError = () => {
      video.removeEventListener('error', onError);
      reject(new Error(`Seek to ${timestamp}s failed`));
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);

    video.currentTime = timestamp;

    // Timeout in case seek hangs.
    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve(); // Resolve anyway — the frame might be partially ready.
    }, 3000);
  });
}
