/**
 * Speech-to-text using HuggingFace's Inference API with OpenAI's Whisper model.
 *
 * The client extracts audio client-side (using ffmpeg.wasm) and uploads it
 * to the /api/transcribe endpoint, which calls this function.
 *
 * DEBUG: This version includes detailed logging to diagnose "fetch failed"
 * errors. Once the issue is resolved, the console.log statements can be
 * removed (or left in — they don't affect functionality).
 */

interface DebugLog {
  timestamp: string;
  step: string;
  message: string;
  data?: unknown;
}

const debugLogs: DebugLog[] = [];

function log(step: string, message: string, data?: unknown) {
  const entry: DebugLog = {
    timestamp: new Date().toISOString(),
    step,
    message,
  };
  if (data !== undefined) {
    entry.data = data;
  }
  debugLogs.push(entry);
  console.log(`[whisper:${step}] ${message}`, data !== undefined ? data : '');
}

export function getDebugLogs(): DebugLog[] {
  return [...debugLogs];
}

export function clearDebugLogs(): void {
  debugLogs.length = 0;
}

/**
 * Transcribe an audio buffer using Whisper via HuggingFace Inference API.
 *
 * @param audioBuffer - The audio file as a Buffer (MP3, WAV, etc.)
 * @param mimeType - The MIME type of the audio (e.g. "audio/mpeg")
 * @returns The transcribed text.
 */
export async function transcribeAudioFromBuffer(
  audioBuffer: Buffer,
  mimeType: string = 'audio/mpeg',
): Promise<string> {
  log('init', 'Starting transcription', {
    bufferSize: audioBuffer.length,
    bufferKB: Math.round(audioBuffer.length / 1024),
    mimeType,
  });

  const token = process.env.HF_API_TOKEN;
  if (!token) {
    log('error', 'HF_API_TOKEN is not set');
    throw new Error(
      'HF_API_TOKEN is not set. Add it to your .env file or Netlify environment variables.',
    );
  }
  log('init', 'HF_API_TOKEN is set', { tokenLength: token.length, tokenPrefix: token.slice(0, 6) + '...' });

  const model = process.env.WHISPER_MODEL || 'openai/whisper-large-v3';
  const url = `https://api-inference.huggingface.co/models/${model}`;
  log('init', 'Using model', { model, url });

  // Validate the audio buffer.
  if (!audioBuffer || audioBuffer.length === 0) {
    log('error', 'Audio buffer is empty');
    throw new Error('Audio buffer is empty — the client sent no audio data.');
  }

  if (audioBuffer.length < 100) {
    log('error', 'Audio buffer is suspiciously small', { size: audioBuffer.length });
    throw new Error(`Audio buffer is only ${audioBuffer.length} bytes — the audio extraction may have failed.`);
  }

  log('init', 'Audio buffer validated', {
    sizeBytes: audioBuffer.length,
    sizeKB: Math.round(audioBuffer.length / 1024),
    firstBytes: Array.from(audioBuffer.subarray(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' '),
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    log(`attempt-${attempt + 1}`, 'Starting attempt', { attempt: attempt + 1, url });

    try {
      // Set a timeout to detect hung connections.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        log(`attempt-${attempt + 1}`, 'Request timed out after 60s, aborting...');
        controller.abort();
      }, 60000);

      log(`attempt-${attempt + 1}`, 'Sending fetch request to HuggingFace', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer hf_...(hidden)',
          'Content-Type': mimeType,
        },
        bodySize: audioBuffer.length,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mimeType,
        },
        body: audioBuffer,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      log(`attempt-${attempt + 1}`, 'Received response', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      });

      if (response.status === 503) {
        // Model is loading. Wait and retry.
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 15000;
        log(`attempt-${attempt + 1}`, 'Model is loading, waiting before retry', {
          retryAfterHeader: retryAfter,
          waitMs,
        });
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        log(`attempt-${attempt + 1}`, 'API returned error', {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText.slice(0, 500),
        });
        throw new Error(
          `HuggingFace API error: ${response.status} ${response.statusText} - ${errorText.slice(0, 200)}`,
        );
      }

      log(`attempt-${attempt + 1}`, 'Parsing JSON response');
      const result = (await response.json()) as { text?: string; error?: string };
      log(`attempt-${attempt + 1}`, 'Parsed response', {
        hasText: !!result.text,
        hasError: !!result.error,
        textLength: result.text?.length || 0,
        textPreview: result.text?.slice(0, 100),
      });

      if (result.error) {
        throw new Error(`HuggingFace returned an error in the response body: ${result.error}`);
      }

      const text = result.text?.trim() || '';
      log('success', 'Transcription complete', {
        textLength: text.length,
        textPreview: text.slice(0, 200),
      });

      return text;
    } catch (err) {
      const error = err as Error;
      log(`attempt-${attempt + 1}`, 'Attempt failed', {
        name: error.name,
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        cause: (err as { cause?: { code?: string; message?: string } }).cause,
      });
      lastError = error;

      // Don't retry on auth errors or client errors (4xx).
      if (error.message.includes('401') || error.message.includes('403')) {
        log('error', 'Authentication error — not retrying');
        break;
      }

      if (attempt < 2) {
        const waitMs = 5000 * (attempt + 1);
        log(`attempt-${attempt + 1}`, 'Waiting before retry', { waitMs });
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  log('error', 'All attempts failed', {
    lastErrorName: lastError?.name,
    lastErrorMessage: lastError?.message,
    allLogs: getDebugLogs().map((l) => `${l.step}: ${l.message}`),
  });

  // Build a detailed error message.
  const errorDetails = {
    error: lastError?.message || 'Unknown error',
    model,
    url,
    audioSizeBytes: audioBuffer.length,
    attempts: 3,
    debugLogs: getDebugLogs().map((l) => ({
      step: l.step,
      message: l.message,
    })),
  };

  throw new Error(
    `Whisper transcription failed after 3 attempts. ` +
      `Last error: ${lastError?.message}. ` +
      `This could be caused by: ` +
      `(1) HuggingFace API rate limiting or downtime, ` +
      `(2) Invalid HF_API_TOKEN, ` +
      `(3) Network connectivity issues from the Netlify function to HuggingFace, ` +
      `(4) The audio format being unsupported. ` +
      `Debug details: ${JSON.stringify(errorDetails, null, 2)}`,
  );
}
