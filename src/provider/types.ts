export interface CharAlignment {
  characters: string[];
  charStartTimesSeconds: number[];
  charEndTimesSeconds: number[];
}

export interface TTSResult {
  audio: ArrayBuffer;
  // Optional: providers like ElevenLabs return character-level timing data.
  // When omitted (e.g., OpenAI TTS), the player synthesizes a uniform
  // alignment from audio duration so karaoke highlighting still works,
  // just at coarser precision.
  alignment?: CharAlignment;
}

export interface TTSGenerateOptions {
  text: string;
  voiceId: string;
  modelId: string;
}

export interface TTSProvider {
  generate(opts: TTSGenerateOptions): Promise<TTSResult>;
}
