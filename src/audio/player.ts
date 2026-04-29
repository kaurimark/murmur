import type { CharAlignment, TTSProvider } from "../provider/types";
import type { Segment, SegmentKind } from "../segmenter";

const HEADING_PAUSE_MS = 1440;
const PARAGRAPH_PAUSE_MS = 600;
const ANNOUNCEMENT_PAUSE_MS = 960;
const MAX_CONSECUTIVE_FAILURES = 3;

interface CachedSegment {
  audio: ArrayBuffer;
  alignment?: CharAlignment;
}

export type PlayerStatus = "idle" | "loading" | "playing" | "paused";

export interface PlayerState {
  status: PlayerStatus;
  segmentIndex: number;
  totalSegments: number;
  playbackRate: number;
  currentTimeSec: number;
  durationSec: number;
}

export interface PlayerCallbacks {
  onError: (msg: string) => void;
  onProgress?: (
    segment: Segment,
    alignment: CharAlignment,
    timeSec: number,
  ) => void;
  onTick?: (currentTimeSec: number, durationSec: number) => void;
  onComplete?: () => void;
  onStateChange?: (state: PlayerState) => void;
}

const CHARS_PER_SEC = 14;

export class SegmentPlayer {
  private cache = new Map<number, CachedSegment>();
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private segments: Segment[] = [];
  private segmentEstimates: number[] = [];
  private segmentOffsets: number[] = [];
  private totalEstimateSec = 0;
  private currentIndex = 0;
  private stopped = false;
  private playbackRate = 1;
  private consecutiveFailures = 0;
  private pendingTimeout: number | null = null;

  constructor(
    private provider: TTSProvider,
    private voiceId: string,
    private modelId: string,
    private callbacks: PlayerCallbacks,
  ) {}

  async play(segments: Segment[]): Promise<void> {
    this.stopped = false;
    this.segments = segments;
    this.currentIndex = 0;
    this.consecutiveFailures = 0;
    this.segmentEstimates = segments.map((s) =>
      Math.max(s.text.length / CHARS_PER_SEC, 0.1),
    );
    this.segmentOffsets = [0];
    for (let i = 0; i < segments.length; i++) {
      this.segmentOffsets.push(
        this.segmentOffsets[i] + this.segmentEstimates[i],
      );
    }
    this.totalEstimateSec =
      this.segmentOffsets[this.segmentOffsets.length - 1] ?? 0;
    if (segments.length === 0) {
      this.callbacks.onComplete?.();
      return;
    }
    this.emitState();
    await this.advance(0);
  }

  private virtualCurrentTime(): number {
    const baseOffset = this.segmentOffsets[this.currentIndex] ?? 0;
    if (!this.currentAudio) return baseOffset;
    const segDur = this.currentAudio.duration;
    const segEstimate = this.segmentEstimates[this.currentIndex] ?? 0;
    const progress =
      Number.isFinite(segDur) && segDur > 0
        ? Math.max(0, Math.min(1, this.currentAudio.currentTime / segDur))
        : 0;
    return baseOffset + progress * segEstimate;
  }

  pause(): void {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause();
    }
  }

  resume(): void {
    if (this.currentAudio && this.currentAudio.paused) {
      void this.currentAudio.play();
    }
  }

  togglePlayPause(): void {
    if (!this.currentAudio) return;
    if (this.currentAudio.paused) this.resume();
    else this.pause();
  }

  setSpeed(rate: number): void {
    this.playbackRate = rate;
    if (this.currentAudio) this.currentAudio.playbackRate = rate;
    this.emitState();
  }

  seekFraction(fraction: number): void {
    if (!this.currentAudio) return;
    const dur = this.currentAudio.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const clamped = Math.max(0, Math.min(1, fraction));
    this.currentAudio.currentTime = clamped * dur;
  }

  next(): void {
    if (this.stopped) return;
    this.cancelPending();
    this.cleanupCurrent();
    void this.advance(this.currentIndex + 1);
  }

  prev(): void {
    if (this.stopped) return;
    this.cancelPending();
    this.cleanupCurrent();
    void this.advance(Math.max(0, this.currentIndex - 1));
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelPending();
    if (this.currentAudio) this.currentAudio.pause();
    this.cleanupCurrent();
    this.cache.clear();
    this.emitState();
    this.callbacks.onComplete?.();
  }

  private async advance(i: number): Promise<void> {
    this.cleanupCurrent();
    if (this.stopped) return;
    if (i >= this.segments.length) {
      this.stop();
      return;
    }
    this.currentIndex = i;

    let cached = this.cache.get(i);
    if (!cached) {
      this.emitState();
      try {
        cached = await this.generate(this.segments[i]);
        if (this.stopped) return;
        this.cache.set(i, cached);
      } catch (err) {
        this.callbacks.onError(`Segment ${i + 1}: ${errorMessage(err)}`);
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.callbacks.onError(
            `Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`,
          );
          this.stop();
          return;
        }
        await this.advance(i + 1);
        return;
      }
    }
    this.consecutiveFailures = 0;

    this.playCached(cached, i);
    void this.prefetch(i + 1);
  }

  private async generate(seg: Segment): Promise<CachedSegment> {
    const result = await this.provider.generate({
      text: seg.text,
      voiceId: this.voiceId,
      modelId: this.modelId,
    });
    return { audio: result.audio, alignment: result.alignment };
  }

  private async prefetch(i: number): Promise<void> {
    if (i >= this.segments.length || this.cache.has(i) || this.stopped) return;
    try {
      const cached = await this.generate(this.segments[i]);
      if (!this.stopped) this.cache.set(i, cached);
    } catch {
      // Errors surface when we reach this segment in advance(); silent on prefetch.
    }
  }

  private playCached(cached: CachedSegment, i: number): void {
    const blob = new Blob([cached.audio], { type: "audio/mpeg" });
    this.currentUrl = URL.createObjectURL(blob);
    this.currentAudio = new Audio(this.currentUrl);
    this.currentAudio.playbackRate = this.playbackRate;

    // Providers without character-level alignment (e.g. OpenAI) leave
    // cached.alignment undefined. Synthesize a uniform alignment from the
    // actual audio duration as soon as metadata loads — karaoke highlight
    // still works, just at coarser precision.
    this.currentAudio.addEventListener("loadedmetadata", () => {
      if (cached.alignment || !this.currentAudio) return;
      const dur = this.currentAudio.duration;
      if (Number.isFinite(dur) && dur > 0) {
        cached.alignment = synthesizeAlignment(this.segments[i].text, dur);
      }
    });

    this.currentAudio.addEventListener("timeupdate", () => {
      if (!this.currentAudio || this.stopped) return;
      if (cached.alignment) {
        this.callbacks.onProgress?.(
          this.segments[i],
          cached.alignment,
          this.currentAudio.currentTime,
        );
      }
      this.callbacks.onTick?.(this.virtualCurrentTime(), this.totalEstimateSec);
    });

    this.currentAudio.addEventListener("ended", () => {
      if (this.stopped) return;
      const pause = pauseAfter(this.segments[i].kind);
      this.pendingTimeout = window.setTimeout(() => {
        this.pendingTimeout = null;
        if (!this.stopped) void this.advance(i + 1);
      }, pause);
    });

    this.currentAudio.addEventListener("play", () => this.emitState());
    this.currentAudio.addEventListener("pause", () => {
      if (!this.stopped) this.emitState();
    });

    void this.currentAudio.play().catch((err) => {
      this.callbacks.onError(`Playback: ${errorMessage(err)}`);
      this.stop();
    });
  }

  private cancelPending(): void {
    if (this.pendingTimeout !== null) {
      window.clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  private cleanupCurrent(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
    this.currentAudio = null;
  }

  private emitState(): void {
    this.callbacks.onStateChange?.(this.snapshotState());
  }

  private snapshotState(): PlayerState {
    return {
      status: this.computeStatus(),
      segmentIndex: this.currentIndex,
      totalSegments: this.segments.length,
      playbackRate: this.playbackRate,
      currentTimeSec: this.virtualCurrentTime(),
      durationSec: this.totalEstimateSec,
    };
  }

  private computeStatus(): PlayerStatus {
    if (this.stopped) return "idle";
    if (this.currentAudio) {
      return this.currentAudio.paused ? "paused" : "playing";
    }
    if (this.pendingTimeout !== null) return "playing";
    return "loading";
  }
}

function synthesizeAlignment(
  text: string,
  durationSec: number,
): CharAlignment {
  const characters = Array.from(text);
  const charStartTimesSeconds: number[] = [];
  const charEndTimesSeconds: number[] = [];
  const n = characters.length;
  if (n === 0 || !Number.isFinite(durationSec) || durationSec <= 0) {
    return { characters, charStartTimesSeconds, charEndTimesSeconds };
  }
  const perChar = durationSec / n;
  for (let i = 0; i < n; i++) {
    charStartTimesSeconds.push(i * perChar);
    charEndTimesSeconds.push((i + 1) * perChar);
  }
  return { characters, charStartTimesSeconds, charEndTimesSeconds };
}

function pauseAfter(kind: SegmentKind): number {
  switch (kind) {
    case "heading":
      return HEADING_PAUSE_MS;
    case "paragraph":
      return PARAGRAPH_PAUSE_MS;
    case "code":
    case "table":
      return ANNOUNCEMENT_PAUSE_MS;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
