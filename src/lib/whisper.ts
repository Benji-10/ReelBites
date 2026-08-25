/**
 * Speech-to-text using HuggingFace's Inference API with OpenAI's Whisper model.
 *
 * The client extracts audio client-side (using ffmpeg.wasm) and uploads it
 * to the /api/transcribe endpoint, which calls this function.
 *
 * HuggingFace's free tier supports inference on whisper-large-v3 (and similar).
 */

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
  const token = process.env.HF_API_TOKEN;
  if (!token) {
    throw new Error(
      'HF_API_TOKEN is not set. Add it to your .env file or Netlify environment variables.',
    );
  }

  const model = process.env.WHISPER_MODEL || 'openai/whisper-large-v3';
  const url = `https://api-inference.huggingface.co/models/${model}`;

  // HuggingFace's whisper models accept the raw audio bytes and return JSON
  // with a "text" field. The first call may trigger model loading (~20s).
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mimeType,
        },
        body: audioBuffer,
      });

      if (response.status === 503) {
        // Model is loading. Wait and retry.
        await new Promise((r) => setTimeout(r, 15000));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HuggingFace API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const result = (await response.json()) as { text?: string };
      return result.text?.trim() || '';
    } catch (err) {
      lastError = err as Error;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  throw new Error(
    `Whisper transcription failed after 3 attempts. Last error: ${lastError?.message}`,
  );
}
