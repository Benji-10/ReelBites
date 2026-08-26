/**
 * Speech-to-text using Groq's Whisper API.
 *
 * Groq offers a free, reliable Whisper API that's OpenAI-compatible.
 * The free tier allows 14,400 requests/day and 200 requests/hour.
 *
 * Groq is used instead of HuggingFace because HuggingFace's
 * api-inference.huggingface.co hostname has DNS resolution issues
 * (ENOTFOUND) from Netlify Lambda functions.
 *
 * Get a free API key at: https://console.groq.com/keys
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
 * Transcribe an audio buffer using Whisper via Groq's API.
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

  const token = process.env.GROQ_API_KEY || process.env.HF_API_TOKEN;
  if (!token) {
    log('error', 'No API token set');
    throw new Error(
      'GROQ_API_KEY is not set. Get a free key at https://console.groq.com/keys ' +
        'and add it to your Netlify environment variables.',
    );
  }
  log('init', 'API token is set', {
    tokenLength: token.length,
    tokenPrefix: token.slice(0, 6) + '...',
    provider: process.env.GROQ_API_KEY ? 'groq' : 'huggingface-fallback',
  });

  const model = process.env.WHISPER_MODEL || 'whisper-large-v3';
  const url = 'https://api.groq.com/openai/v1/audio/transcriptions';
  log('init', 'Using Groq Whisper API', { model, url });

  // Validate the audio buffer.
  if (!audioBuffer || audioBuffer.length === 0) {
    log('error', 'Audio buffer is empty');
    throw new Error('Audio buffer is empty — the client sent no audio data.');
  }

  log('init', 'Audio buffer validated', {
    sizeBytes: audioBuffer.length,
    sizeKB: Math.round(audioBuffer.length / 1024),
    firstBytes: Array.from(audioBuffer.subarray(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' '),
  });

  // Build multipart/form-data manually (avoids FormData+Blob issues in Lambda).
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const filename = mimeType === 'audio/wav' ? 'audio.wav' : 'audio.mp3';

  const parts: Buffer[] = [];

  // Part: model
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`,
    ),
  );

  // Part: response_format
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`,
    ),
  );

  // Part: temperature — set to 0 to reduce hallucination on silent audio.
  // Whisper sometimes hallucinates "thank you for watching" in random languages
  // when there's no speech. Low temperature helps reduce this.
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="temperature"\r\n\r\n0\r\n`,
    ),
  );

  // Part: language — set to null (auto-detect) but we'll filter common
  // hallucinations after transcription.
  // No language parameter = auto-detect.

  // Part: file (the audio)
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
  );
  parts.push(audioBuffer);
  parts.push(Buffer.from('\r\n'));

  // Closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);
  log('init', 'Built multipart request', {
    bodySize: body.length,
    bodyKB: Math.round(body.length / 1024),
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    log(`attempt-${attempt + 1}`, 'Starting attempt', { attempt: attempt + 1, url });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        log(`attempt-${attempt + 1}`, 'Request timed out after 90s, aborting...');
        controller.abort();
      }, 90000);

      log(`attempt-${attempt + 1}`, 'Sending fetch request to Groq', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer gsk_...(hidden)',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        bodySize: body.length,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      log(`attempt-${attempt + 1}`, 'Received response', {
        status: response.status,
        statusText: response.statusText,
      });

      if (response.status === 429) {
        // Rate limited.
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 10000;
        log(`attempt-${attempt + 1}`, 'Rate limited, waiting before retry', { waitMs });
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
          `Groq API error: ${response.status} ${response.statusText} - ${errorText.slice(0, 200)}`,
        );
      }

      log(`attempt-${attempt + 1}`, 'Parsing JSON response');
      const result = (await response.json()) as { text?: string };
      log(`attempt-${attempt + 1}`, 'Parsed response', {
        hasText: !!result.text,
        textLength: result.text?.length || 0,
        textPreview: result.text?.slice(0, 100),
      });

      let text = result.text?.trim() || '';

      // Filter common Whisper hallucinations on silent audio.
      // Whisper often returns these phrases when there's no actual speech.
      const HALLUCINATIONS = [
        'thank you for watching',
        'terima kasih telah menonton',    // Malay
        '感谢您的观看',                     // Chinese
        'ご視聴ありがとうございました',       // Japanese
        '시청해주셔서 감사합니다',           // Korean
        'gracias por ver',                // Spanish
        'obrigado por assistir',          // Portuguese
        'merci de regarder',              // French
        'danke fürs zuschauen',           // German
        'धन्यवाद देखने के लिए',           // Hindi
        'شكرا للمشاهدة',                   // Arabic
      ];

      const lowerText = text.toLowerCase();
      const isHallucination = HALLUCINATIONS.some((h) =>
        lowerText.includes(h.toLowerCase()),
      );

      // If the ENTIRE transcript is just a hallucination phrase (very short),
      // treat it as no speech.
      if (isHallucination && text.length < 80) {
        log(`attempt-${attempt + 1}`, 'Filtered hallucination', {
          original: text,
          reason: 'Likely silent audio — Whisper hallucinated a "thank you" phrase',
        });
        text = '';
      }

      log('success', 'Transcription complete', {
        textLength: text.length,
        textPreview: text.slice(0, 200),
        wasFiltered: text.length === 0 && !!result.text,
      });

      return text;
    } catch (err) {
      const error = err as Error;
      log(`attempt-${attempt + 1}`, 'Attempt failed', {
        name: error.name,
        message: error.message,
        cause: (err as { cause?: { code?: string; message?: string } }).cause,
      });
      lastError = error;

      // Don't retry on auth errors.
      if (error.message.includes('401') || error.message.includes('403')) {
        log('error', 'Authentication error — not retrying');
        break;
      }

      if (attempt < 2) {
        const waitMs = 3000 * (attempt + 1);
        log(`attempt-${attempt + 1}`, 'Waiting before retry', { waitMs });
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  log('error', 'All attempts failed', {
    lastErrorName: lastError?.name,
    lastErrorMessage: lastError?.message,
  });

  throw new Error(
    `Whisper transcription failed after 3 attempts. ` +
      `Last error: ${lastError?.message}. ` +
      `If the error is "fetch failed" with ENOTFOUND, this is a DNS issue. ` +
      `Groq's API should be reachable from Netlify. Verify your GROQ_API_KEY ` +
      `at https://console.groq.com/keys and check the model name.`,
  );
}
