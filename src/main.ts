import { MarkdownView, Notice, Plugin } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { ElevenLabsProvider } from "./provider/elevenlabs";
import { AudioCache, CachedTTSProvider } from "./provider/cache";
import { markdownToSegments } from "./segmenter";
import type { Segment } from "./segmenter";
import { SegmentPlayer } from "./audio/player";
import type { PlayerState } from "./audio/player";
import {
  murmurHighlightField,
  setMurmurHighlight,
} from "./ui/highlighter";
import {
  setWidgetActions,
  setWidgetState,
  widgetField,
  WidgetState,
} from "./ui/player-widget";
import { DEFAULT_SETTINGS, MurmurSettings, MurmurSettingTab } from "./settings";
import type { CharAlignment } from "./provider/types";

export default class MurmurPlugin extends Plugin {
  settings!: MurmurSettings;
  cache!: AudioCache;
  private player: SegmentPlayer | null = null;
  private currentPlayerState: WidgetState | null = null;
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
        this.player?.setSpeed(rate);
      },
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.refreshWidget()),
    );

    this.addRibbonIcon("audio-lines", "Murmur: read note aloud", () =>
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  refreshWidget(): void {
    const view = this.getActiveEditorView();
    if (!view) return;
    let state: WidgetState | null;
    if (this.currentPlayerState) {
      state = this.currentPlayerState;
    } else if (this.settings.alwaysShowWidget) {
      state = {
        status: "idle",
        segmentIndex: 0,
        totalSegments: 0,
        playbackRate: this.lastPlaybackRate,
      };
    } else {
      state = null;
    }
    view.dispatch({ effects: setWidgetState.of(state) });
  }

  private getActiveEditorView(): EditorView | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    return (view.editor as unknown as { cm?: EditorView }).cm ?? null;
  }

  private readSmart() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Murmur: open a markdown note first.");
      return;
    }
    const selection = view.editor.getSelection();
    const text = selection.trim() ? selection : view.editor.getValue();
    this.readText(text);
  }

  private readText(text: string) {
    const { apiKey, voiceId, modelId } = this.settings;
    if (!apiKey) {
      new Notice("Murmur: enter your ElevenLabs API key in settings.");
      return;
    }

    const segments = markdownToSegments(text);
    if (segments.length === 0) {
      new Notice("Murmur: nothing to read.");
      return;
    }

    this.stopPlayback();
    this.lastHighlight = null;

    const provider = new CachedTTSProvider(
      new ElevenLabsProvider(apiKey),
      this.cache,
    );
    this.player = new SegmentPlayer(provider, voiceId, modelId, {
      onError: (msg) => new Notice(`Murmur: ${msg}`),
      onProgress: (segment, alignment, timeSec) =>
        this.updateHighlight(segment, alignment, timeSec),
      onComplete: () => this.handlePlaybackEnd(),
      onStateChange: (state) => this.updatePlayerState(state),
    });
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
    this.currentPlayerState = null;
    this.player = null;
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
      };
    }
    this.refreshWidget();
  }

  private updateHighlight(
    segment: Segment,
    alignment: CharAlignment,
    timeSec: number,
  ) {
    const view = this.getActiveEditorView();
    if (!view) return;
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
    view.dispatch({ effects: setMurmurHighlight.of(range) });
  }

  private clearHighlight() {
    const view = this.getActiveEditorView();
    if (view) {
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
