/**
 * Speech-to-text using HuggingFace's Inference API with OpenAI's Whisper model.
 *
 * HuggingFace's free tier supports inference on whisper-large-v3 (and similar).
 * The user provides their HF_API_TOKEN in env vars.
 *
 * Alternative: if you prefer, you can swap this for OpenAI's Whisper API
 * (paid) or a local whisper.cpp server — just replace the function body.
 */

import { promises as fs } from 'fs';

const HF_INFERENCE_URL = (model: string) =>
  `https://api-inference.huggingface.co/models/${model}`;

/**
 * Transcribe an audio file using Whisper via HuggingFace Inference API.
 *
 * @param audioPath - Path to the audio file (mp3, wav, etc.).
 * @returns The transcribed text.
 */
export async function transcribeAudio(
  audioPath: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const token = process.env.HF_API_TOKEN;
  if (!token) {
    throw new Error(
      'HF_API_TOKEN is not set. Add it to your .env file or Netlify environment variables.',
    );
  }

  const model = process.env.WHISPER_MODEL || 'openai/whisper-large-v3';
  onProgress?.(`Sending audio to Whisper (${model}) via HuggingFace...`);

  const audioBuffer = await fs.readFile(audioPath);

  // HuggingFace's whisper models accept the raw audio bytes and return JSON
  // with a "text" field. The first call may trigger model loading (~20s).
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(HF_INFERENCE_URL(model), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'audio/mpeg',
        },
        body: audioBuffer,
      });

      if (response.status === 503) {
        // Model is loading. Wait and retry.
        onProgress?.('Whisper model is loading on HuggingFace, retrying in 15s...');
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
      const text = result.text?.trim() || '';

      onProgress?.(
        text
          ? `Transcription complete (${text.length} chars).`
          : 'Transcription complete (no speech detected).',
      );

      return text;
    } catch (err) {
      lastError = err as Error;
      onProgress?.(`Whisper attempt ${attempt + 1} failed: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  throw new Error(
    `Whisper transcription failed after 3 attempts. Last error: ${lastError?.message}`,
  );
}
