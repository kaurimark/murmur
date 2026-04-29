import { requestUrl } from "obsidian";
import type { TTSGenerateOptions, TTSProvider, TTSResult } from "./types";

const CARTESIA_BASE = "https://api.cartesia.ai";
// Cartesia's API is versioned via header. Pin to a known-good version so
// changes on their side don't silently break us.
const CARTESIA_VERSION = "2024-11-13";

export const CARTESIA_MODELS = [
  { id: "sonic-3", label: "Sonic 3 (newest)" },
  { id: "sonic-2", label: "Sonic 2" },
  { id: "sonic", label: "Sonic 1 (older, faster)" },
] as const;

export class CartesiaProvider implements TTSProvider {
  constructor(private apiKey: string) {}

  async generate(opts: TTSGenerateOptions): Promise<TTSResult> {
    const response = await requestUrl({
      url: `${CARTESIA_BASE}/tts/bytes`,
      method: "POST",
      headers: {
        "X-API-Key": this.apiKey,
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: opts.modelId,
        transcript: opts.text,
        voice: { mode: "id", id: opts.voiceId },
        output_format: {
          container: "mp3",
          encoding: "mp3",
          sample_rate: 44100,
        },
        language: "en",
      }),
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(
        `Cartesia ${response.status}: ${describeError(response.text)}`,
      );
    }

    // Cartesia's word-level timestamps live on a separate streaming endpoint
    // (tts/sse). The bytes endpoint we use here returns audio only, so the
    // player synthesizes a uniform alignment from audio duration.
    return { audio: response.arrayBuffer };
  }
}

function describeError(text: string): string {
  try {
    const json = JSON.parse(text) as {
      error?: string | { message?: string };
      message?: string;
    };
    if (typeof json.error === "string") return json.error;
    if (json.error?.message) return json.error.message;
    if (json.message) return json.message;
  } catch {
    // not JSON
  }
  return text.slice(0, 200);
}
