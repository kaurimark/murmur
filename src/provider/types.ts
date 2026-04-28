export interface CharAlignment {
  characters: string[];
  charStartTimesSeconds: number[];
  charEndTimesSeconds: number[];
}

export interface TTSResult {
  audio: ArrayBuffer;
  alignment: CharAlignment;
}

export interface TTSGenerateOptions {
  text: string;
  voiceId: string;
  modelId: string;
}

export interface TTSProvider {
  generate(opts: TTSGenerateOptions): Promise<TTSResult>;
}
