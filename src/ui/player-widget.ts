import { setIcon } from "obsidian";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export type WidgetTheme = "inline-chip" | "tape-deck";

export interface WidgetState {
  status: "idle" | "loading" | "playing" | "paused";
  segmentIndex: number;
  totalSegments: number;
  playbackRate: number;
  currentTimeSec: number;
  durationSec: number;
  idleEstimateMin: number;
  otherNoteName?: string;
  theme: WidgetTheme;
}

export interface WidgetActions {
  togglePlayPause: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  setSpeed: (rate: number) => void;
  seekFraction: (fraction: number) => void;
  openPlayingNote: () => void;
}

let actions: WidgetActions | null = null;

export function setWidgetActions(a: WidgetActions | null): void {
  actions = a;
}

type TickListener = (currentTimeSec: number, durationSec: number) => void;
const tickListeners = new Set<TickListener>();
const tickListenersByDom = new WeakMap<HTMLElement, TickListener>();
let lastTick = { currentTimeSec: 0, durationSec: 0 };

export function emitWidgetTick(currentTimeSec: number, durationSec: number): void {
  lastTick = { currentTimeSec, durationSec };
  for (const fn of tickListeners) fn(currentTimeSec, durationSec);
}

export function resetWidgetTick(): void {
  lastTick = { currentTimeSec: 0, durationSec: 0 };
  for (const fn of tickListeners) fn(0, 0);
}

export const setWidgetState = StateEffect.define<WidgetState | null>();

interface FieldValue {
  state: WidgetState | null;
  decorations: DecorationSet;
}

export const widgetField = StateField.define<FieldValue>({
  create() {
    return { state: null, decorations: Decoration.none };
  },
  update(value, tr) {
    let state = value.state;
    let stateChanged = false;
    for (const e of tr.effects) {
      if (e.is(setWidgetState)) {
        state = e.value;
        stateChanged = true;
      }
    }
    if (!stateChanged && !tr.docChanged) return value;
    return {
      state,
      decorations: state ? buildDecorations(tr.state, state) : Decoration.none,
    };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

function buildDecorations(
  state: EditorState,
  widget: WidgetState,
): DecorationSet {
  const pos = findInsertPosition(state.doc.toString());
  return Decoration.set([
    Decoration.widget({
      widget: new PlayerWidget(widget),
      side: -1,
      block: true,
    }).range(pos),
  ]);
}

function findInsertPosition(doc: string): number {
  const fmMatch = doc.match(/^---\n[\s\S]*?\n---\n?/);
  return fmMatch ? fmMatch[0].length : 0;
}

class PlayerWidget extends WidgetType {
  constructor(private state: WidgetState) {
    super();
  }

  eq(other: PlayerWidget): boolean {
    return (
      this.state.theme === other.state.theme &&
      this.state.status === other.state.status &&
      this.state.segmentIndex === other.state.segmentIndex &&
      this.state.totalSegments === other.state.totalSegments &&
      this.state.playbackRate === other.state.playbackRate &&
      this.state.idleEstimateMin === other.state.idleEstimateMin &&
      this.state.otherNoteName === other.state.otherNoteName
    );
  }

  toDOM(): HTMLElement {
    const dom =
      this.state.theme === "tape-deck"
        ? createDeckSkeleton()
        : createChipSkeleton();
    renderForTheme(dom, this.state);
    attachTickListener(dom);
    applyTickToDom(dom, lastTick.currentTimeSec, lastTick.durationSec);
    return dom;
  }

  updateDOM(dom: HTMLElement): boolean {
    const expectsDeck = this.state.theme === "tape-deck";
    const hasDeck = !!dom.querySelector(".murmur-deck");
    if (expectsDeck !== hasDeck) return false;
    renderForTheme(dom, this.state);
    applyTickToDom(dom, lastTick.currentTimeSec, lastTick.durationSec);
    return true;
  }

  destroy(dom: HTMLElement): void {
    detachTickListener(dom);
  }
}

function renderForTheme(outer: HTMLElement, state: WidgetState): void {
  if (state.theme === "tape-deck") {
    renderDeckState(outer, state);
  } else {
    renderChipState(outer, state);
  }
}

// =============================================================================
// Floating-widget API — used by the plugin to render the same chip/deck DOM
// outside the CodeMirror editor (in a fixed-position container).
// =============================================================================

export function createFloatingWidget(state: WidgetState): HTMLElement {
  const dom =
    state.theme === "tape-deck" ? createDeckSkeleton() : createChipSkeleton();
  dom.classList.add("murmur-floating");
  renderForTheme(dom, state);
  attachTickListener(dom);
  applyTickToDom(dom, lastTick.currentTimeSec, lastTick.durationSec);
  return dom;
}

/**
 * Update an existing floating widget. Returns false if the theme changed and
 * the DOM needs to be rebuilt (caller should destroy + create).
 */
export function updateFloatingWidget(
  dom: HTMLElement,
  state: WidgetState,
): boolean {
  const expectsDeck = state.theme === "tape-deck";
  const hasDeck = !!dom.querySelector(".murmur-deck");
  if (expectsDeck !== hasDeck) return false;
  renderForTheme(dom, state);
  applyTickToDom(dom, lastTick.currentTimeSec, lastTick.durationSec);
  return true;
}

export function destroyFloatingWidget(dom: HTMLElement): void {
  detachTickListener(dom);
  dom.remove();
}

function attachTickListener(dom: HTMLElement): void {
  const fn: TickListener = (cur, dur) => applyTickToDom(dom, cur, dur);
  tickListenersByDom.set(dom, fn);
  tickListeners.add(fn);
}

function detachTickListener(dom: HTMLElement): void {
  const fn = tickListenersByDom.get(dom);
  if (fn) {
    tickListeners.delete(fn);
    tickListenersByDom.delete(dom);
  }
}

function applyTickToDom(
  dom: HTMLElement,
  currentTimeSec: number,
  durationSec: number,
): void {
  const fill = dom.querySelector<HTMLElement>(
    ".murmur-chip-track-fill, .murmur-deck-track-fill",
  );
  const cur = dom.querySelector<HTMLElement>(
    ".murmur-chip-time-current, .murmur-deck-time-current",
  );
  const dur = dom.querySelector<HTMLElement>(
    ".murmur-chip-time-duration, .murmur-deck-time-duration",
  );
  if (fill) {
    const pct =
      durationSec > 0
        ? Math.max(0, Math.min(100, (currentTimeSec / durationSec) * 100))
        : 0;
    fill.style.width = `${pct}%`;
  }
  if (cur) cur.textContent = formatTime(currentTimeSec);
  if (dur) dur.textContent = formatTime(durationSec);
}

function createChipSkeleton(): HTMLElement {
  const outer = document.createElement("div");
  outer.className = "murmur-widget-outer";

  const chip = document.createElement("div");
  chip.className = "murmur-chip";

  const idleFace = document.createElement("div");
  idleFace.className = "murmur-chip-face murmur-chip-face-idle";
  const idleIcon = document.createElement("span");
  idleIcon.className = "murmur-chip-idle-icon";
  setIcon(idleIcon, "play");
  const idleLabel = document.createElement("span");
  idleLabel.className = "murmur-chip-idle-label";
  idleLabel.textContent = "Read aloud";
  const idleDuration = document.createElement("span");
  idleDuration.className = "murmur-chip-idle-duration";
  idleFace.append(idleIcon, idleLabel, idleDuration);

  const playingFace = document.createElement("div");
  playingFace.className = "murmur-chip-face murmur-chip-face-playing";

  const primary = document.createElement("button");
  primary.type = "button";
  primary.className = "murmur-chip-primary";
  setIcon(primary, "pause");

  const skipCluster = document.createElement("div");
  skipCluster.className = "murmur-chip-skip-cluster";
  const skipBack = createIconButton(
    "skip-back",
    "murmur-chip-icon-btn murmur-chip-skip-back",
  );
  const skipFwd = createIconButton(
    "skip-forward",
    "murmur-chip-icon-btn murmur-chip-skip-forward",
  );
  skipCluster.append(skipBack, skipFwd);

  const timeGroup = document.createElement("div");
  timeGroup.className = "murmur-chip-time-group";
  const timeCurrent = document.createElement("span");
  timeCurrent.className = "murmur-chip-time-current";
  timeCurrent.textContent = "0:00";
  const track = document.createElement("div");
  track.className = "murmur-chip-track";
  const fill = document.createElement("div");
  fill.className = "murmur-chip-track-fill";
  track.appendChild(fill);
  const timeDuration = document.createElement("span");
  timeDuration.className = "murmur-chip-time-duration";
  timeDuration.textContent = "0:00";
  timeGroup.append(timeCurrent, track, timeDuration);

  const speed = document.createElement("button");
  speed.type = "button";
  speed.className = "murmur-chip-speed";
  speed.textContent = "1×";

  const close = createIconButton("x", "murmur-chip-icon-btn murmur-chip-close");

  playingFace.append(primary, skipCluster, timeGroup, speed, close);

  const otherFace = document.createElement("div");
  otherFace.className = "murmur-chip-face murmur-chip-face-other";
  const otherArrow = document.createElement("span");
  otherArrow.className = "murmur-chip-other-arrow";
  otherArrow.textContent = "↗";
  const otherLabel = document.createElement("span");
  otherLabel.className = "murmur-chip-other-label";
  const otherStop = document.createElement("button");
  otherStop.type = "button";
  otherStop.className = "murmur-chip-icon-btn murmur-chip-other-stop";
  otherStop.setAttribute("aria-label", "Stop narration");
  setIcon(otherStop, "x");
  otherFace.append(otherArrow, otherLabel, otherStop);

  chip.append(idleFace, playingFace, otherFace);
  outer.appendChild(chip);

  chip.addEventListener("mousedown", (e) => e.stopPropagation());
  chip.addEventListener("click", (e) => {
    if (chip.classList.contains("is-playing")) return;
    e.preventDefault();
    e.stopPropagation();
    if (chip.classList.contains("is-other-note")) {
      actions?.openPlayingNote();
    } else {
      actions?.togglePlayPause();
    }
  });

  primary.addEventListener("mousedown", (e) => e.stopPropagation());
  primary.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    actions?.togglePlayPause();
  });

  skipBack.addEventListener("mousedown", (e) => e.stopPropagation());
  skipBack.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    actions?.prev();
  });

  skipFwd.addEventListener("mousedown", (e) => e.stopPropagation());
  skipFwd.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    actions?.next();
  });

  speed.addEventListener("mousedown", (e) => e.stopPropagation());
  speed.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = parseFloat(speed.dataset.rate ?? "1");
    const idx = SPEED_OPTIONS.indexOf(cur);
    const nextIdx = idx < 0 ? 1 : (idx + 1) % SPEED_OPTIONS.length;
    actions?.setSpeed(SPEED_OPTIONS[nextIdx]);
  });

  close.addEventListener("mousedown", (e) => e.stopPropagation());
  close.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    actions?.stop();
  });

  // Stop button in the other-note face — lets the user halt narration of a
  // different note without first navigating to it.
  otherStop.addEventListener("mousedown", (e) => e.stopPropagation());
  otherStop.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    actions?.stop();
  });

  track.addEventListener("mousedown", (e) => e.stopPropagation());
  track.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = (e.clientX - rect.left) / rect.width;
    actions?.seekFraction(Math.max(0, Math.min(1, fraction)));
  });

  return outer;
}

function createIconButton(iconName: string, className: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  setIcon(btn, iconName);
  return btn;
}

function renderChipState(outer: HTMLElement, state: WidgetState): void {
  const chip = outer.querySelector<HTMLElement>(".murmur-chip");
  if (!chip) return;

  const isOther = !!state.otherNoteName;
  const isLoading = state.status === "loading";
  const isPaused = state.status === "paused";
  const isPlayingState =
    state.status === "playing" || isPaused || isLoading;

  chip.classList.toggle("is-other-note", isOther);
  chip.classList.toggle("is-playing", isPlayingState && !isOther);
  chip.classList.toggle("is-paused", isPaused && !isOther);
  chip.classList.toggle("is-loading", isLoading && !isOther);

  const idleDuration = chip.querySelector<HTMLElement>(
    ".murmur-chip-idle-duration",
  );
  if (idleDuration) {
    idleDuration.textContent =
      state.idleEstimateMin >= 1
        ? `· ${state.idleEstimateMin} min`
        : "· < 1 min";
  }

  const primary = chip.querySelector<HTMLButtonElement>(
    ".murmur-chip-primary",
  );
  if (primary) {
    if (isLoading) {
      while (primary.firstChild) primary.removeChild(primary.firstChild);
    } else {
      setIcon(primary, state.status === "playing" ? "pause" : "play");
    }
  }

  const speed = chip.querySelector<HTMLButtonElement>(
    ".murmur-chip-speed",
  );
  if (speed) {
    speed.textContent = `${state.playbackRate}×`;
    speed.dataset.rate = String(state.playbackRate);
  }

  const skipBack = chip.querySelector<HTMLButtonElement>(
    ".murmur-chip-skip-back",
  );
  const skipFwd = chip.querySelector<HTMLButtonElement>(
    ".murmur-chip-skip-forward",
  );
  if (skipBack) {
    skipBack.disabled =
      !isPlayingState || isLoading || state.segmentIndex <= 0;
  }
  if (skipFwd) {
    skipFwd.disabled =
      !isPlayingState ||
      isLoading ||
      state.segmentIndex >= state.totalSegments - 1;
  }

  const otherLabel = chip.querySelector<HTMLElement>(
    ".murmur-chip-other-label",
  );
  if (otherLabel) {
    otherLabel.textContent = isOther
      ? `Listening to ${state.otherNoteName}`
      : "";
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds - m * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// =============================================================================
// Tape-deck theme
// =============================================================================

function createDeckSkeleton(): HTMLElement {
  const outer = document.createElement("div");
  outer.className = "murmur-widget-outer";

  const deck = document.createElement("div");
  deck.className = "murmur-deck";

  const disc = document.createElement("button");
  disc.type = "button";
  disc.className = "murmur-deck-disc";
  disc.setAttribute("aria-label", "Play");
  setDeckIcon(disc, "play");
  disc.dataset.icon = "play";

  const skipCluster = document.createElement("div");
  skipCluster.className = "murmur-deck-skip";
  const skipBack = createDeckIconBtn(
    "skip-back",
    "murmur-deck-icon-btn murmur-deck-skip-back",
  );
  const skipFwd = createDeckIconBtn(
    "skip-forward",
    "murmur-deck-icon-btn murmur-deck-skip-forward",
  );
  skipCluster.append(skipBack, skipFwd);

  const timeBlock = document.createElement("div");
  timeBlock.className = "murmur-deck-time";
  const timeCurrent = document.createElement("span");
  timeCurrent.className = "murmur-deck-time-current";
  timeCurrent.textContent = "0:00";
  const track = document.createElement("div");
  track.className = "murmur-deck-track";
  const fill = document.createElement("div");
  fill.className = "murmur-deck-track-fill";
  track.appendChild(fill);
  const timeDuration = document.createElement("span");
  timeDuration.className = "murmur-deck-time-duration";
  timeDuration.textContent = "0:00";
  timeBlock.append(timeCurrent, track, timeDuration);

  const speed = document.createElement("button");
  speed.type = "button";
  speed.className = "murmur-deck-speed";
  const speedWindow = document.createElement("span");
  speedWindow.className = "murmur-deck-speed-window";
  const speedStack = document.createElement("span");
  speedStack.className = "murmur-deck-speed-stack";
  const speedLabel = document.createElement("span");
  speedLabel.className = "murmur-deck-speed-label";
  speedLabel.textContent = "1.00×";
  speedStack.appendChild(speedLabel);
  speedWindow.appendChild(speedStack);
  speed.appendChild(speedWindow);

  const close = createDeckIconBtn(
    "x",
    "murmur-deck-icon-btn murmur-deck-close",
  );

  const otherLabel = document.createElement("span");
  otherLabel.className = "murmur-deck-other-label";

  // otherLabel goes before close so when both are visible (other-note state),
  // the visual order is [disc] [↗ Listening to X] [✕] — close at the right edge.
  deck.append(disc, skipCluster, timeBlock, speed, otherLabel, close);
  outer.appendChild(deck);

  // --- Event wiring ---
  deck.addEventListener("mousedown", (e) => e.stopPropagation());

  disc.addEventListener("mousedown", (e) => e.stopPropagation());
  disc.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (deck.dataset.state === "other") {
      actions?.openPlayingNote();
    } else {
      actions?.togglePlayPause();
    }
  });

  skipBack.addEventListener("mousedown", (e) => e.stopPropagation());
  skipBack.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    actions?.prev();
  });

  skipFwd.addEventListener("mousedown", (e) => e.stopPropagation());
  skipFwd.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    actions?.next();
  });

  speed.addEventListener("mousedown", (e) => e.stopPropagation());
  speed.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = parseFloat(speed.dataset.rate ?? "1");
    const idx = SPEED_OPTIONS.indexOf(cur);
    const nextIdx = idx < 0 ? 1 : (idx + 1) % SPEED_OPTIONS.length;
    actions?.setSpeed(SPEED_OPTIONS[nextIdx]);
  });

  close.addEventListener("mousedown", (e) => e.stopPropagation());
  close.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    actions?.stop();
  });

  track.addEventListener("mousedown", (e) => e.stopPropagation());
  track.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = (e.clientX - rect.left) / rect.width;
    actions?.seekFraction(Math.max(0, Math.min(1, fraction)));
  });

  otherLabel.addEventListener("mousedown", (e) => e.stopPropagation());
  otherLabel.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    actions?.openPlayingNote();
  });

  return outer;
}

function createDeckIconBtn(
  iconName: string,
  className: string,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  if (iconName in DECK_PIXEL_ICONS) {
    setDeckIcon(btn, iconName as keyof typeof DECK_PIXEL_ICONS);
  } else {
    setIcon(btn, iconName);
  }
  return btn;
}

// Pixel-grid icons for the tape-deck theme. Drawn with stair-stepped rects on
// integer coordinates, rendered with shape-rendering: crispEdges so they stay
// chunky on retina. All icons sit on a 12x12 viewBox with content centered
// around (6, 6) plus a small optical adjustment for the play triangle (its
// visual mass leans left, so the geometric center is nudged right of viewBox
// center). Stored as rect coordinates rather than SVG strings so we can
// construct the DOM with createElementNS — Obsidian's marketplace review
// rejects innerHTML on principle.
const DECK_PIXEL_ICONS = {
  play: [
    [3, 2, 2, 8],
    [5, 3, 2, 6],
    [7, 4, 2, 4],
    [9, 5, 2, 2],
  ],
  pause: [
    [3, 2, 2, 8],
    [8, 2, 2, 8],
  ],
  "skip-back": [
    [1, 2, 2, 8],
    [4, 5, 2, 2],
    [6, 4, 2, 4],
    [8, 3, 2, 6],
    [10, 2, 2, 8],
  ],
  "skip-forward": [
    [1, 2, 2, 8],
    [3, 3, 2, 6],
    [5, 4, 2, 4],
    [7, 5, 2, 2],
    [10, 2, 2, 8],
  ],
} as const;

const SVG_NS = "http://www.w3.org/2000/svg";

function setDeckIcon(
  el: HTMLElement,
  name: keyof typeof DECK_PIXEL_ICONS,
): void {
  el.empty();
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("shape-rendering", "crispEdges");
  for (const [x, y, w, h] of DECK_PIXEL_ICONS[name]) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    svg.appendChild(rect);
  }
  el.appendChild(svg);
}

function renderDeckState(outer: HTMLElement, state: WidgetState): void {
  const deck = outer.querySelector<HTMLElement>(".murmur-deck");
  if (!deck) return;

  const isOther = !!state.otherNoteName;
  const stateName = isOther ? "other" : state.status;
  deck.dataset.state = stateName;

  const disc = deck.querySelector<HTMLButtonElement>(
    ".murmur-deck-disc",
  );
  if (disc) {
    const isPlaying = state.status === "playing";
    disc.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    const desiredIcon = isPlaying ? "pause" : "play";
    if (disc.dataset.icon !== desiredIcon) {
      setDeckIcon(disc, desiredIcon);
      disc.dataset.icon = desiredIcon;
    }
  }

  const speed = deck.querySelector<HTMLButtonElement>(
    ".murmur-deck-speed",
  );
  if (speed) {
    const prevRate = parseFloat(speed.dataset.rate ?? "");
    const nextRate = state.playbackRate;
    if (Number.isFinite(prevRate) && prevRate !== nextRate) {
      rollSpeedWheel(speed, nextRate);
    } else {
      setSpeedLabel(speed, nextRate);
    }
    speed.dataset.rate = String(nextRate);
  }

  const skipBack = deck.querySelector<HTMLButtonElement>(
    ".murmur-deck-skip-back",
  );
  const skipFwd = deck.querySelector<HTMLButtonElement>(
    ".murmur-deck-skip-forward",
  );
  const isPlayingState =
    state.status === "playing" ||
    state.status === "paused" ||
    state.status === "loading";
  if (skipBack) {
    skipBack.disabled =
      isOther ||
      !isPlayingState ||
      state.status === "loading" ||
      state.segmentIndex <= 0;
  }
  if (skipFwd) {
    skipFwd.disabled =
      isOther ||
      !isPlayingState ||
      state.status === "loading" ||
      state.segmentIndex >= state.totalSegments - 1;
  }

  const otherLabel = deck.querySelector<HTMLElement>(
    ".murmur-deck-other-label",
  );
  if (otherLabel) {
    otherLabel.textContent = isOther
      ? `↗ Listening to ${state.otherNoteName}`
      : "";
  }
}

// --- Speed wheel: tape-deck rotating-number-wheel effect ---

const SPEED_ANIM_KEY = "_murmurSpeedAnim";

function formatSpeedLabel(rate: number): string {
  // Always two decimal places so every label is 5 chars + × — fixed width,
  // no jitter when the wheel rolls between values.
  return `${rate.toFixed(2)}×`;
}

function setSpeedLabel(speedBtn: HTMLButtonElement, rate: number): void {
  const stack = speedBtn.querySelector<HTMLElement>(
    ".murmur-deck-speed-stack",
  );
  if (!stack) return;
  finalizeSpeedAnim(speedBtn);
  while (stack.firstChild) stack.removeChild(stack.firstChild);
  const label = document.createElement("span");
  label.className = "murmur-deck-speed-label";
  label.textContent = formatSpeedLabel(rate);
  stack.appendChild(label);
  stack.setCssProps({ "--murmur-stack-y": "0" });
}

function rollSpeedWheel(speedBtn: HTMLButtonElement, nextRate: number): void {
  const stack = speedBtn.querySelector<HTMLElement>(
    ".murmur-deck-speed-stack",
  );
  if (!stack) return;

  // If a roll is in flight, snap it to its end (current = previous target).
  finalizeSpeedAnim(speedBtn);

  const newLabel = document.createElement("span");
  newLabel.className = "murmur-deck-speed-label";
  newLabel.textContent = formatSpeedLabel(nextRate);
  stack.appendChild(newLabel);

  // Force layout so offsetHeight is accurate, then measure.
  const lineHeight = newLabel.offsetHeight || 18;

  // Respect prefers-reduced-motion: skip the animation, jump to the new label.
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    setSpeedLabel(speedBtn, nextRate);
    return;
  }

  // Two-phase mechanical roll:
  //   Pre-action delay (40ms): the click "engages" the detent before motion.
  //   Phase 1 (0 -> 70% distance over 35% of time, linear): wheel breaks
  //     free and rolls quickly through most of the travel.
  //   Phase 2 (70% -> 100% over remaining 65% of time, strong ease-out):
  //     wheel decelerates and settles into the next detent.
  // The intentional velocity discontinuity at the phase boundary reads as a
  // mechanical "pass-through" — a real detent letting the wheel through, not
  // a smooth easing curve.
  const anim = stack.animate(
    [
      { transform: "translateY(0)", easing: "linear" },
      {
        transform: `translateY(-${lineHeight * 0.7}px)`,
        offset: 0.35,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      { transform: `translateY(-${lineHeight}px)` },
    ],
    {
      duration: 360,
      delay: 40,
      fill: "forwards",
    },
  );
  (speedBtn as unknown as Record<string, unknown>)[SPEED_ANIM_KEY] = anim;

  anim.onfinish = () => finalizeSpeedAnim(speedBtn);
  anim.oncancel = () => finalizeSpeedAnim(speedBtn);
}

function finalizeSpeedAnim(speedBtn: HTMLButtonElement): void {
  const stack = speedBtn.querySelector<HTMLElement>(
    ".murmur-deck-speed-stack",
  );
  if (!stack) return;

  // Cancel the animation to release `fill: forwards` — without this, the
  // animation's end-state transform keeps overriding inline styles, leaving
  // the stack stuck at translateY(-18px) and the label invisible.
  const store = speedBtn as unknown as Record<string, unknown>;
  const anim = store[SPEED_ANIM_KEY] as Animation | undefined;
  if (anim) {
    anim.onfinish = null;
    anim.oncancel = null;
    anim.cancel();
    store[SPEED_ANIM_KEY] = undefined;
  }

  // Keep only the last label (current target); discard everything that rolled out.
  const labels = stack.querySelectorAll(".murmur-deck-speed-label");
  for (let i = 0; i < labels.length - 1; i++) {
    labels[i].remove();
  }
  stack.setCssProps({ "--murmur-stack-y": "0" });
}
