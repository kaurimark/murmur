import { requestUrl } from "obsidian";
import type { TTSGenerateOptions, TTSProvider, TTSResult } from "./types";

const FISHAUDIO_BASE = "https://api.fish.audio/v1";

export const FISHAUDIO_MODELS = [
  { id: "s1", label: "S1 (current state of the art)" },
  { id: "s1-mini", label: "S1 Mini (faster, cheaper)" },
  { id: "speech-1.6", label: "Speech 1.6 (older)" },
] as const;

export class FishAudioProvider implements TTSProvider {
  constructor(private apiKey: string) {}

  async generate(opts: TTSGenerateOptions): Promise<TTSResult> {
    // Fish Audio takes the model in a header; voice via reference_id in body.
    const response = await requestUrl({
      url: `${FISHAUDIO_BASE}/tts`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        model: opts.modelId,
      },
      body: JSON.stringify({
        text: opts.text,
        reference_id: opts.voiceId,
        format: "mp3",
        chunk_length: 200,
        normalize: true,
      }),
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(
        `Fish Audio ${response.status}: ${describeError(response.text)}`,
      );
    }

    // Fish Audio's bytes endpoint returns audio only. Word timestamps live
    // on the streaming endpoint; we'll synthesize alignment from the audio's
    // duration in the player, same as OpenAI / Cartesia.
    return { audio: response.arrayBuffer };
  }
}

function describeError(text: string): string {
  try {
    const json = JSON.parse(text) as {
      error?: string | { message?: string };
      message?: string;
      detail?: string;
    };
    if (typeof json.error === "string") return json.error;
    if (json.error?.message) return json.error.message;
    if (json.message) return json.message;
    if (json.detail) return json.detail;
  } catch {
    // not JSON
  }
  return text.slice(0, 200);
}
