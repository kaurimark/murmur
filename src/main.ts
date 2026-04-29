import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { ElevenLabsProvider } from "./provider/elevenlabs";
import { OpenAIProvider } from "./provider/openai";
import { AudioCache, CachedTTSProvider } from "./provider/cache";
import type { TTSProvider } from "./provider/types";
import { markdownToSegments } from "./segmenter";
import type { Segment } from "./segmenter";
import { SegmentPlayer } from "./audio/player";
import type { PlayerState } from "./audio/player";
import {
  murmurHighlightField,
  setMurmurHighlight,
} from "./ui/highlighter";
import {
  emitWidgetTick,
  resetWidgetTick,
  setWidgetActions,
  setWidgetState,
  widgetField,
  WidgetState,
} from "./ui/player-widget";
import {
  DEFAULT_SETTINGS,
  MurmurSettings,
  MurmurSettingTab,
  mergeWithDefaults,
  migrateSettings,
} from "./settings";
import type { CharAlignment } from "./provider/types";

export default class MurmurPlugin extends Plugin {
  settings!: MurmurSettings;
  cache!: AudioCache;
  private player: SegmentPlayer | null = null;
  private currentPlayerState: WidgetState | null = null;
  private playingNotePath: string | null = null;
  private lastPlaybackRate = 1;
  private lastHighlight: { from: number; to: number } | null = null;

  async onload() {
    await this.loadSettings();

    this.cache = new AudioCache(
      this.app,
      this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`,
      this.settings.cacheSizeMB,
    );
    await this.cache.init();

    this.addSettingTab(new MurmurSettingTab(this.app, this));
    this.registerEditorExtension([murmurHighlightField, widgetField]);

    setWidgetActions({
      togglePlayPause: () => {
        if (this.player) this.player.togglePlayPause();
        else this.readSmart();
      },
      stop: () => this.stopPlayback(),
      next: () => this.player?.next(),
      prev: () => this.player?.prev(),
      setSpeed: (rate) => {
        this.lastPlaybackRate = rate;
        if (this.player) {
          this.player.setSpeed(rate);
        } else {
          this.refreshWidget();
        }
      },
      seekFraction: (fraction) => this.player?.seekFraction(fraction),
      openPlayingNote: () => this.openPlayingNote(),
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.refreshWidget()),
    );

    this.addRibbonIcon("audio-lines", "murmur: read note aloud", () =>
      this.readSmart(),
    );

    this.addCommand({
      id: "read-current-note",
      name: "Read note (or selection)",
      callback: () => this.readSmart(),
    });

    this.addCommand({
      id: "toggle-play-pause",
      name: "Toggle play/pause",
      callback: () => {
        if (this.player) this.player.togglePlayPause();
        else this.readSmart();
      },
    });

    this.addCommand({
      id: "stop-playback",
      name: "Stop playback",
      callback: () => this.stopPlayback(),
    });

    this.app.workspace.onLayoutReady(() => this.refreshWidget());
  }

  async onunload() {
    setWidgetActions(null);
    this.stopPlayback();
  }

  async loadSettings() {
    const raw = (await this.loadData()) as
      | Record<string, unknown>
      | null
      | undefined;
    this.settings = mergeWithDefaults(migrateSettings(raw));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  refreshWidget(): void {
    const view = this.getActiveEditorView();
    if (!view) return;
    const theme = this.settings.widgetTheme;
    let state: WidgetState | null;
    if (this.currentPlayerState) {
      state = {
        ...this.currentPlayerState,
        otherNoteName: this.computeOtherNoteName(),
        theme,
      };
    } else if (this.settings.alwaysShowWidget) {
      const minutes = this.computeIdleEstimateMinutes(view);
      state = {
        status: "idle",
        segmentIndex: 0,
        totalSegments: 0,
        playbackRate: this.lastPlaybackRate,
        currentTimeSec: 0,
        durationSec: minutes * 60,
        idleEstimateMin: minutes,
        theme,
      };
    } else {
      state = null;
    }
    view.dispatch({ effects: setWidgetState.of(state) });
  }

  private computeIdleEstimateMinutes(view: EditorView): number {
    const segments = markdownToSegments(view.state.doc.toString());
    let chars = 0;
    for (const s of segments) chars += s.text.length;
    const seconds = chars / 14;
    return Math.round(seconds / 60);
  }

  private computeOtherNoteName(): string | undefined {
    if (!this.playingNotePath) return undefined;
    const activePath = this.app.workspace.getActiveFile()?.path;
    if (!activePath || activePath === this.playingNotePath) return undefined;
    return basename(this.playingNotePath);
  }

  private openPlayingNote(): void {
    if (!this.playingNotePath) return;
    const file = this.app.vault.getAbstractFileByPath(this.playingNotePath);
    if (file instanceof TFile) {
      void this.app.workspace.getLeaf(false).openFile(file);
    }
  }

  private getActiveEditorView(): EditorView | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    return (view.editor as unknown as { cm?: EditorView }).cm ?? null;
  }

  private getPlayingEditorViews(): EditorView[] {
    if (!this.playingNotePath) return [];
    const views: EditorView[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      if (view.file?.path !== this.playingNotePath) continue;
      const cm = (view.editor as unknown as { cm?: EditorView }).cm;
      if (cm) views.push(cm);
    }
    return views;
  }

  private readSmart() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("murmur: open a markdown note first.");
      return;
    }
    const selection = view.editor.getSelection();
    const text = selection.trim() ? selection : view.editor.getValue();
    this.readText(text, view.file?.path ?? null);
  }

  private activeProviderConfig() {
    return this.settings.provider === "openai"
      ? this.settings.openai
      : this.settings.elevenlabs;
  }

  private buildProvider(): TTSProvider | null {
    const cfg = this.activeProviderConfig();
    if (!cfg.apiKey) return null;
    if (this.settings.provider === "openai") {
      return new OpenAIProvider(cfg.apiKey);
    }
    return new ElevenLabsProvider(cfg.apiKey);
  }

  async previewVoice(): Promise<void> {
    const provider = this.buildProvider();
    if (!provider) {
      const name =
        this.settings.provider === "openai" ? "OpenAI" : "ElevenLabs";
      new Notice(`murmur: enter your ${name} API key first.`);
      return;
    }
    const cfg = this.activeProviderConfig();
    const sample =
      "Hello. This is a preview of the selected voice and model.";
    let result;
    try {
      result = await provider.generate({
        text: sample,
        voiceId: cfg.voiceId,
        modelId: cfg.modelId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`murmur: ${msg}`);
      return;
    }
    const blob = new Blob([result.audio], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), {
      once: true,
    });
    audio.addEventListener("error", () => URL.revokeObjectURL(url), {
      once: true,
    });
    try {
      await audio.play();
    } catch (err) {
      URL.revokeObjectURL(url);
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`murmur: preview playback failed — ${msg}`);
    }
  }

  private readText(text: string, notePath: string | null) {
    const providerConfig = this.activeProviderConfig();
    if (!providerConfig.apiKey) {
      const name = this.settings.provider === "openai" ? "OpenAI" : "ElevenLabs";
      new Notice(`murmur: enter your ${name} API key in settings.`);
      return;
    }

    const segments = markdownToSegments(text);
    if (segments.length === 0) {
      new Notice("murmur: nothing to read.");
      return;
    }

    this.stopPlayback();
    this.playingNotePath = notePath;
    this.lastHighlight = null;

    const baseProvider = this.buildProvider();
    if (!baseProvider) return;
    const provider = new CachedTTSProvider(
      baseProvider,
      this.cache,
      this.settings.provider,
    );
    this.player = new SegmentPlayer(
      provider,
      providerConfig.voiceId,
      providerConfig.modelId,
      {
        onError: (msg) => new Notice(`murmur: ${msg}`),
        onProgress: (segment, alignment, timeSec) =>
          this.updateHighlight(segment, alignment, timeSec),
        onTick: (cur, dur) => emitWidgetTick(cur, dur),
        onComplete: () => this.handlePlaybackEnd(),
        onStateChange: (state) => this.updatePlayerState(state),
      },
    );
    this.player.setSpeed(this.lastPlaybackRate);
    void this.player.play(segments);
  }

  private stopPlayback() {
    if (this.player) {
      this.player.stop();
      this.player = null;
    }
    this.handlePlaybackEnd();
  }

  private handlePlaybackEnd() {
    this.clearHighlight();
    resetWidgetTick();
    this.currentPlayerState = null;
    this.player = null;
    this.playingNotePath = null;
    this.refreshWidget();
  }

  private updatePlayerState(state: PlayerState) {
    if (state.status === "idle") {
      this.currentPlayerState = null;
    } else {
      this.currentPlayerState = {
        status: state.status,
        segmentIndex: state.segmentIndex,
        totalSegments: state.totalSegments,
        playbackRate: state.playbackRate,
        currentTimeSec: state.currentTimeSec,
        durationSec: state.durationSec,
        idleEstimateMin: 0,
        theme: this.settings.widgetTheme,
      };
    }
    this.refreshWidget();
  }

  private updateHighlight(
    segment: Segment,
    alignment: CharAlignment,
    timeSec: number,
  ) {
    const range = computeWordRange(segment, alignment, timeSec);
    if (!range) return;
    if (
      this.lastHighlight &&
      this.lastHighlight.from === range.from &&
      this.lastHighlight.to === range.to
    ) {
      return;
    }
    this.lastHighlight = range;
    for (const view of this.getPlayingEditorViews()) {
      view.dispatch({ effects: setMurmurHighlight.of(range) });
    }
  }

  private clearHighlight() {
    for (const view of this.getPlayingEditorViews()) {
      view.dispatch({ effects: setMurmurHighlight.of(null) });
    }
    this.lastHighlight = null;
  }
}

function computeWordRange(
  segment: Segment,
  alignment: CharAlignment,
  timeSec: number,
): { from: number; to: number } | null {
  const idx = findActiveSpokenIndex(timeSec, alignment.charStartTimesSeconds);
  if (idx < 0) return null;

  const word = findCurrentWord(idx, alignment.characters);
  const map = segment.sourceMap;
  if (map.length === 0) return null;

  const fromIdx = Math.max(0, Math.min(word.from, map.length - 1));
  const toIdx = Math.max(0, Math.min(word.to - 1, map.length - 1));
  const from = map[fromIdx];
  const to = map[toIdx] + 1;

  if (to <= from) return null;
  return { from, to };
}

function findActiveSpokenIndex(timeSec: number, startTimes: number[]): number {
  if (startTimes.length === 0 || timeSec < startTimes[0]) return -1;
  let lo = 0;
  let hi = startTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (startTimes[mid] <= timeSec) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function findCurrentWord(
  idx: number,
  characters: string[],
): { from: number; to: number } {
  let from = idx;
  while (from > 0 && !isWordBoundary(characters[from - 1])) {
    from--;
  }
  let to = idx + 1;
  while (to < characters.length && !isWordBoundary(characters[to])) {
    to++;
  }
  return { from, to };
}

function isWordBoundary(char: string): boolean {
  return /[\s.,;:!?()[\]{}—–-]/.test(char);
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  return file.replace(/\.md$/i, "");
}
