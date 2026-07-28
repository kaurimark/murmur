import { requestUrl } from "obsidian";
import type { TTSGenerateOptions, TTSProvider, TTSResult } from "./types";

const OPENAI_BASE = "https://api.openai.com/v1";

export const OPENAI_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

export const OPENAI_MODELS = [
  { id: "tts-1", label: "tts-1" },
  { id: "tts-1-hd", label: "tts-1-hd" },
] as const;

export class OpenAIProvider implements TTSProvider {
  constructor(private apiKey: string) {}

  async generate(opts: TTSGenerateOptions): Promise<TTSResult> {
    const response = await requestUrl({
      url: `${OPENAI_BASE}/audio/speech`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.modelId,
        input: opts.text,
        voice: opts.voiceId,
        response_format: "mp3",
      }),
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(`OpenAI ${response.status}: ${describeError(response.text)}`);
    }

    // OpenAI returns no alignment data. The player synthesizes a uniform
    // alignment from the actual audio duration when loadedmetadata fires.
    return { audio: response.arrayBuffer };
  }
}

function describeError(text: string): string {
  try {
    const json = JSON.parse(text) as { error?: { message?: string } };
    if (json.error?.message) return json.error.message;
  } catch {
    // not JSON
  }
  return text.slice(0, 200);
}
