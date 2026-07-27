import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { ElevenLabsProvider } from "./provider/elevenlabs";
import { OpenAIProvider } from "./provider/openai";
import { CartesiaProvider } from "./provider/cartesia";
import { FishAudioProvider } from "./provider/fishaudio";
import { InworldProvider } from "./provider/inworld";
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
  createFloatingWidget,
  destroyFloatingWidget,
  emitWidgetTick,
  resetWidgetTick,
  setWidgetActions,
  setWidgetState,
  updateFloatingWidget,
  widgetField,
  WidgetState,
} from "./ui/player-widget";
import {
  MurmurSettings,
  MurmurSettingTab,
  extractLegacyApiKeys,
  importLegacyApiKeys,
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
  private floatingWidget: HTMLElement | null = null;
  // Set true at the very start of onunload. Prevents late-firing event
  // handlers (e.g. active-leaf-change triggered by settings-tab removal)
  // from racing past unload and re-creating widgets we just swept.
  private unloaded = false;

  async onload() {
    // Defensive: sweep any orphaned widget DOM from prior plugin lifecycles
    // (esbuild hot reload, partial unloads, dev iteration, or plugin disable
    // that didn't fully clean up). We sweep `.murmur-widget-outer` — the base
    // class on every widget instance — rather than `.murmur-floating`,
    // because inline widgets rendered via CodeMirror decorations carry the
    // base class but not the floating class, and CM extension teardown
    // doesn't always force a re-render. Each module reload also creates a
    // fresh `actions` variable; widgets from the old module reference its
    // now-null `actions` and become dead. Cleaning at load time guarantees
    // the user only sees the live widget.
    this.sweepWidgetDom();

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

    this.addRibbonIcon("audio-lines", "Read note aloud", () =>
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

  onunload() {
    // Mark unloaded FIRST. Any late-firing event handlers that slip past
    // Obsidian's listener cleanup (e.g. active-leaf-change triggered by the
    // settings-tab removal that happens during plugin disable) will see this
    // flag in refreshWidget / mountFloating and bail without re-creating DOM.
    this.unloaded = true;

    // Sweep DOM. Best-effort — we wrap in try/catch so a sweep failure
    // doesn't prevent the rest of teardown.
    try {
      this.sweepWidgetDom();
    } catch (err) {
      console.error("[Murmur] DOM sweep threw:", err);
    }

    try {
      setWidgetActions(null);
      this.unmountFloating();
      this.stopPlayback();
    } catch (err) {
      console.error("[Murmur] onunload teardown threw:", err);
    }
  }

  async loadSettings() {
    const raw = (await this.loadData()) as
      | Record<string, unknown>
      | null
      | undefined;
    const legacyApiKeys = extractLegacyApiKeys(raw);
    this.settings = mergeWithDefaults(migrateSettings(raw));

    if (Object.keys(legacyApiKeys).length > 0) {
      importLegacyApiKeys(
        this.settings,
        this.app.secretStorage,
        legacyApiKeys,
      );
      // migrateSettings removed the plaintext values. Persist only after all
      // keys have been imported successfully so a failed import cannot lose a
      // user's credentials.
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private sweepWidgetDom(): void {
    const docs = new Set<Document>([activeDocument]);
    for (const view of this.getAllEditorViews()) docs.add(view.dom.doc);
    for (const doc of docs) {
      for (const el of Array.from(
        doc.querySelectorAll(".murmur-widget-outer"),
      )) {
        el.remove();
      }
    }
  }

  refreshWidget(): void {
    // Guard against late-firing events that race past onunload. Without
    // this, removing the settings tab on plugin-disable triggers
    // active-leaf-change AFTER our DOM sweep — observed twice per disable
    // in practice — and the handler closure re-mounts the floating widget
    // on a now-disabled plugin.
    if (this.unloaded) return;

    const activeView = this.getActiveEditorView();
    const state = this.buildWidgetState(activeView);

    if (this.settings.widgetPlacement === "floating") {
      // Suppress the inline widget on EVERY open editor — split views would
      // otherwise leave a stale inline widget alongside the floating one.
      for (const view of this.getAllEditorViews()) {
        view.dispatch({ effects: setWidgetState.of(null) });
      }
      this.refreshFloating(state);
    } else {
      this.unmountFloating();
      if (activeView) {
        activeView.dispatch({ effects: setWidgetState.of(state) });
      }
    }
  }

  private buildWidgetState(view: EditorView | null): WidgetState | null {
    const theme = this.settings.widgetTheme;
    if (this.currentPlayerState) {
      // Floating mode is a global controller — show full transport regardless
      // of which note is active. Inline mode shows the "↗ Listening to X"
      // affordance on non-playing notes.
      const otherNoteName =
        this.settings.widgetPlacement === "floating"
          ? undefined
          : this.computeOtherNoteName();
      return {
        ...this.currentPlayerState,
        otherNoteName,
        theme,
      };
    }
    if (this.settings.alwaysShowWidget && view) {
      const minutes = this.computeIdleEstimateMinutes(view);
      return {
        status: "idle",
        segmentIndex: 0,
        totalSegments: 0,
        playbackRate: this.lastPlaybackRate,
        currentTimeSec: 0,
        durationSec: minutes * 60,
        idleEstimateMin: minutes,
        theme,
      };
    }
    return null;
  }

  private computeIdleEstimateMinutes(view: EditorView): number {
    const segments = markdownToSegments(view.state.doc.toString());
    let chars = 0;
    for (const s of segments) chars += s.text.length;
    const seconds = chars / 14;
    return Math.round(seconds / 60);
  }

  // --- Floating widget ---

  private refreshFloating(state: WidgetState | null): void {
    if (!state) {
      this.unmountFloating();
      return;
    }
    const targetDoc = this.getFloatingTargetDocument();
    if (!this.floatingWidget || this.floatingWidget.doc !== targetDoc) {
      this.unmountFloating();
      this.mountFloating(state);
      return;
    }
    const ok = updateFloatingWidget(this.floatingWidget, state);
    if (!ok) {
      // Theme changed — rebuild the DOM.
      this.unmountFloating();
      this.mountFloating(state);
    }
  }

  private getFloatingTargetDocument(): Document {
    return this.getActiveEditorView()?.dom.doc ?? activeDocument;
  }

  private mountFloating(state: WidgetState): void {
    const doc = this.getFloatingTargetDocument();
    // Defensive: sweep any orphaned floating widgets from prior plugin
    // lifecycles. If the previous instance's onunload didn't fully clean up
    // (plugin reload during dev, etc.), we'd otherwise stack multiple
    // floating widgets on top of each other.
    for (const el of Array.from(doc.querySelectorAll(".murmur-floating"))) {
      el.remove();
    }

    const dom = createFloatingWidget(state, doc);
    // position: fixed, z-index, and the var(--murmur-x/y) consumers live in
    // styles.css on .murmur-floating. We drive the dynamic position via CSS
    // variables — `--`-prefixed property keys are the only ones the
    // no-static-styles eslint rule allows in setCssProps.
    doc.body.appendChild(dom);

    // Measure after mount so we can clamp the saved position to the current
    // viewport (handles the case where the user undocks a laptop and the
    // window shrinks below the saved coordinates).
    const rect = dom.getBoundingClientRect();
    const { x, y } = this.clampFloatingPosition(
      this.settings.floatingPosition,
      rect.width,
      rect.height,
      dom.win,
    );
    dom.setCssProps({ "--murmur-x": `${x}px`, "--murmur-y": `${y}px` });

    this.attachFloatingDrag(dom);
    this.floatingWidget = dom;
  }

  private unmountFloating(): void {
    if (!this.floatingWidget) return;
    destroyFloatingWidget(this.floatingWidget);
    this.floatingWidget = null;
  }

  private clampFloatingPosition(
    pos: { x: number; y: number },
    width: number,
    height: number,
    win: Window,
  ): { x: number; y: number } {
    const maxX = Math.max(0, win.innerWidth - width);
    const maxY = Math.max(0, win.innerHeight - height);
    return {
      x: Math.max(0, Math.min(maxX, pos.x)),
      y: Math.max(0, Math.min(maxY, pos.y)),
    };
  }

  private attachFloatingDrag(outer: HTMLElement): void {
    const doc = outer.doc;
    const win = outer.win;
    // The chip/deck already has a `mousedown → stopPropagation` listener so
    // editor cursor placement doesn't fire when clicking the widget in inline
    // mode. That listener kills the bubble before it reaches `outer`, so a
    // drag handler attached to `outer` would never fire for clicks on the
    // widget body. Attach the drag to the chip/deck directly: multiple
    // listeners on the same element both fire — `stopPropagation` only blocks
    // bubbling to ancestors, not sibling listeners.
    const inner =
      outer.querySelector<HTMLElement>(".murmur-chip, .murmur-deck") ?? outer;

    inner.addEventListener("mousedown", (e) => {
      // Buttons + scrubber call stopPropagation on their own mousedowns, so
      // this listener only fires when the user clicks the widget body itself.
      if (e.button !== 0) return;
      e.preventDefault();

      // Use OUTER's rect for position math — `outer` is what gets moved.
      const rect = outer.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      let lastX = rect.left;
      let lastY = rect.top;

      doc.body.classList.add("murmur-floating-dragging");

      const onMove = (ev: MouseEvent) => {
        const next = this.clampFloatingPosition(
          {
            x: ev.clientX - offsetX,
            y: ev.clientY - offsetY,
          },
          rect.width,
          rect.height,
          win,
        );
        lastX = next.x;
        lastY = next.y;
        outer.setCssProps({
          "--murmur-x": `${lastX}px`,
          "--murmur-y": `${lastY}px`,
        });
      };

      const onUp = () => {
        doc.removeEventListener("mousemove", onMove);
        doc.removeEventListener("mouseup", onUp);
        doc.body.classList.remove("murmur-floating-dragging");
        this.settings.floatingPosition = { x: lastX, y: lastY };
        void this.saveSettings();
      };

      doc.addEventListener("mousemove", onMove);
      doc.addEventListener("mouseup", onUp);
    });
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

  private getAllEditorViews(): EditorView[] {
    const views: EditorView[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const cm = (view.editor as unknown as { cm?: EditorView }).cm;
      if (cm) views.push(cm);
    }
    return views;
  }

  private readSmart() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown note first.");
      return;
    }
    const selection = view.editor.getSelection();
    const text = selection.trim() ? selection : view.editor.getValue();
    this.readText(text, view.file?.path ?? null);
  }

  private activeProviderConfig() {
    switch (this.settings.provider) {
      case "openai":
        return this.settings.openai;
      case "cartesia":
        return this.settings.cartesia;
      case "fishaudio":
        return this.settings.fishaudio;
      case "inworld":
        return this.settings.inworld;
      default:
        return this.settings.elevenlabs;
    }
  }

  private activeApiKey(): string | null {
    const secretId = this.activeProviderConfig().apiKeySecretId;
    if (!secretId) return null;
    return this.app.secretStorage.getSecret(secretId);
  }

  private providerLabel(): string {
    switch (this.settings.provider) {
      case "openai":
        return "OpenAI";
      case "cartesia":
        return "Cartesia";
      case "fishaudio":
        return "Fish Audio";
      case "inworld":
        return "Inworld";
      default:
        return "ElevenLabs";
    }
  }

  private buildProvider(): TTSProvider | null {
    const apiKey = this.activeApiKey();
    if (!apiKey) return null;
    switch (this.settings.provider) {
      case "openai":
        return new OpenAIProvider(apiKey);
      case "cartesia":
        return new CartesiaProvider(apiKey);
      case "fishaudio":
        return new FishAudioProvider(apiKey);
      case "inworld":
        return new InworldProvider(apiKey);
      default:
        return new ElevenLabsProvider(apiKey);
    }
  }

  async previewVoice(): Promise<void> {
    const provider = this.buildProvider();
    if (!provider) {
      new Notice(`Enter your ${this.providerLabel()} API key first.`);
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
      new Notice(msg);
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
      new Notice(`Preview playback failed — ${msg}`);
    }
  }

  private readText(text: string, notePath: string | null) {
    const providerConfig = this.activeProviderConfig();
    if (!this.activeApiKey()) {
      new Notice(`Enter your ${this.providerLabel()} API key in settings.`);
      return;
    }

    const segments = markdownToSegments(text);
    if (segments.length === 0) {
      new Notice("Nothing to read.");
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
        onError: (msg) => new Notice(msg),
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
