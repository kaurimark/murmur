import type { TTSProvider } from "../provider/types";

const MAX_DEPTH = 5;

export interface AgentVoiceDeps {
  getProvider: () => TTSProvider | null;
  getVoice: () => { voiceId: string; modelId: string };
  isMuted: () => boolean;
  notify: (msg: string) => void;
}

/**
 * FIFO queue for terse agent status utterances. Shares the plugin's TTS
 * provider stack but stays out of the SegmentPlayer path — agent speech is
 * fire-and-forget, no segments, no widget, no highlight. Concurrent enqueues
 * play in order; queue depth is capped so a runaway agent can't drown the
 * user. Mute is checked at play-time, not enqueue-time, so toggling mute
 * during a long queue takes effect immediately for utterances not yet started.
 */
export class AgentVoiceQueue {
  private chain: Promise<void> = Promise.resolve();
  private depth = 0;
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;

  constructor(private deps: AgentVoiceDeps) {}

  enqueue(text: string): void {
    if (this.depth >= MAX_DEPTH) {
      this.deps.notify("agent voice: queue full, utterance dropped");
      return;
    }
    this.depth++;
    this.chain = this.chain
      .then(() => this.play(text))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.deps.notify(`agent voice: ${msg}`);
      })
      .finally(() => {
        this.depth--;
      });
  }

  private async play(text: string): Promise<void> {
    if (this.deps.isMuted()) return;

    const provider = this.deps.getProvider();
    if (!provider) {
      throw new Error("no TTS provider configured");
    }

    const { voiceId, modelId } = this.deps.getVoice();
    const result = await provider.generate({ text, voiceId, modelId });

    if (this.deps.isMuted()) return;

    const blob = new Blob([result.audio], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.currentAudio = audio;
    this.currentUrl = url;

    try {
      await new Promise<void>((resolve, reject) => {
        audio.addEventListener("ended", () => resolve(), { once: true });
        audio.addEventListener(
          "error",
          () => reject(new Error("audio playback failed")),
          { once: true },
        );
        audio.play().catch(reject);
      });
    } finally {
      if (this.currentUrl === url) {
        URL.revokeObjectURL(url);
        this.currentUrl = null;
        this.currentAudio = null;
      }
    }
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
    this.chain = Promise.resolve();
    this.depth = 0;
  }
}
