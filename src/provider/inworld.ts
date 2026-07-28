import { requestUrl } from "obsidian";
import type { TTSGenerateOptions, TTSProvider, TTSResult } from "./types";

const INWORLD_BASE = "https://api.inworld.ai/tts/v1";

// Model IDs currently exposed by Murmur. Keep these stable until newer API
// models are tested end-to-end.
export const INWORLD_MODELS = [
  { id: "inworld-tts-1.5-max", label: "TTS 1.5 Max" },
  { id: "inworld-tts-1.5-mini", label: "TTS 1.5 Mini" },
] as const;

// The 22 named voices Inworld ships out of the box. Cloned voices have their
// own IDs but require additional API calls to set up; for v1 we expose the
// stock list.
export const INWORLD_VOICES = [
  "Alex",
  "Ashley",
  "Craig",
  "Deborah",
  "Dennis",
  "Dominus",
  "Edward",
  "Elizabeth",
  "Hades",
  "Heitor",
  "Julia",
  "Maitê",
  "Mark",
  "Olivia",
  "Pixie",
  "Priya",
  "Ronald",
  "Sarah",
  "Shaun",
  "Theodore",
  "Timothy",
  "Wendy",
] as const;

export class InworldProvider implements TTSProvider {
  constructor(private apiKey: string) {}

  async generate(opts: TTSGenerateOptions): Promise<TTSResult> {
    // Inworld uses HTTP Basic auth with the API key as the username and an
    // empty password — `Authorization: Basic base64(apiKey:)`.
    const auth = btoa(`${this.apiKey}:`);

    const response = await requestUrl({
      url: `${INWORLD_BASE}/voice`,
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: opts.text,
        voiceId: opts.voiceId,
        modelId: opts.modelId,
        audioConfig: { audioEncoding: "MP3" },
      }),
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(
        `Inworld ${response.status}: ${describeError(response.text)}`,
      );
    }

    // Inworld returns audio as base64 inside a JSON envelope, unlike the
    // other providers which stream raw bytes.
    const json = response.json as { audioContent?: string };
    if (typeof json.audioContent !== "string" || !json.audioContent) {
      throw new Error("Inworld: response missing audioContent");
    }

    // Word/character timestamps are available via `timestampType` on this
    // endpoint, but the response shape isn't documented well enough to map
    // safely yet — fall back to the synthesized-from-duration alignment that
    // Cartesia / Fish Audio / OpenAI use.
    return { audio: base64ToArrayBuffer(json.audioContent) };
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
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
