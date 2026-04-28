import { requestUrl } from "obsidian";
import type {
  CharAlignment,
  TTSGenerateOptions,
  TTSProvider,
  TTSResult,
} from "./types";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsResponse {
  audio_base64: string;
  alignment?: ElevenLabsAlignment;
  normalized_alignment?: ElevenLabsAlignment;
}

export class ElevenLabsProvider implements TTSProvider {
  constructor(private apiKey: string) {}

  async generate(opts: TTSGenerateOptions): Promise<TTSResult> {
    const url = `${ELEVENLABS_BASE}/text-to-speech/${opts.voiceId}/with-timestamps`;
    const response = await requestUrl({
      url,
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: opts.text, model_id: opts.modelId }),
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(`ElevenLabs ${response.status}: ${response.text}`);
    }

    const json = response.json as ElevenLabsResponse;
    const raw = json.alignment ?? json.normalized_alignment;
    if (!raw) {
      throw new Error("ElevenLabs response missing alignment data");
    }

    const alignment: CharAlignment = {
      characters: raw.characters,
      charStartTimesSeconds: raw.character_start_times_seconds,
      charEndTimesSeconds: raw.character_end_times_seconds,
    };

    return { audio: base64ToArrayBuffer(json.audio_base64), alignment };
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
