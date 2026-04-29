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
  const fill = dom.querySelector(
    ".murmur-chip-track-fill, .murmur-deck-track-fill",
  ) as HTMLElement | null;
  const cur = dom.querySelector(
    ".murmur-chip-time-current, .murmur-deck-time-current",
  ) as HTMLElement | null;
  const dur = dom.querySelector(
    ".murmur-chip-time-duration, .murmur-deck-time-duration",
  ) as HTMLElement | null;
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
  otherFace.append(otherArrow, otherLabel);

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
  const chip = outer.querySelector(".murmur-chip") as HTMLElement | null;
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

  const idleDuration = chip.querySelector(
    ".murmur-chip-idle-duration",
  ) as HTMLElement | null;
  if (idleDuration) {
    idleDuration.textContent =
      state.idleEstimateMin >= 1
        ? `· ${state.idleEstimateMin} min`
        : "· < 1 min";
  }

  const primary = chip.querySelector(
    ".murmur-chip-primary",
  ) as HTMLButtonElement | null;
  if (primary) {
    if (isLoading) {
      while (primary.firstChild) primary.removeChild(primary.firstChild);
    } else {
      setIcon(primary, state.status === "playing" ? "pause" : "play");
    }
  }

  const speed = chip.querySelector(
    ".murmur-chip-speed",
  ) as HTMLButtonElement | null;
  if (speed) {
    speed.textContent = `${state.playbackRate}×`;
    speed.dataset.rate = String(state.playbackRate);
  }

  const skipBack = chip.querySelector(
    ".murmur-chip-skip-back",
  ) as HTMLButtonElement | null;
  const skipFwd = chip.querySelector(
    ".murmur-chip-skip-forward",
  ) as HTMLButtonElement | null;
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

  const otherLabel = chip.querySelector(
    ".murmur-chip-other-label",
  ) as HTMLElement | null;
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
  const mark = document.createElement("span");
  mark.className = "murmur-deck-disc-mark";
  mark.textContent = "m";
  disc.appendChild(mark);

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
  speedLabel.textContent = "1×";
  speedStack.appendChild(speedLabel);
  speedWindow.appendChild(speedStack);
  speed.appendChild(speedWindow);

  const close = createDeckIconBtn(
    "x",
    "murmur-deck-icon-btn murmur-deck-close",
  );

  const otherLabel = document.createElement("span");
  otherLabel.className = "murmur-deck-other-label";

  deck.append(disc, skipCluster, timeBlock, speed, close, otherLabel);
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
  setIcon(btn, iconName);
  return btn;
}

function renderDeckState(outer: HTMLElement, state: WidgetState): void {
  const deck = outer.querySelector(".murmur-deck") as HTMLElement | null;
  if (!deck) return;

  const isOther = !!state.otherNoteName;
  const stateName = isOther ? "other" : state.status;
  deck.dataset.state = stateName;

  const disc = deck.querySelector(
    ".murmur-deck-disc",
  ) as HTMLButtonElement | null;
  if (disc) {
    disc.setAttribute(
      "aria-label",
      state.status === "playing" ? "Pause" : "Play",
    );
  }

  const speed = deck.querySelector(
    ".murmur-deck-speed",
  ) as HTMLButtonElement | null;
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

  const skipBack = deck.querySelector(
    ".murmur-deck-skip-back",
  ) as HTMLButtonElement | null;
  const skipFwd = deck.querySelector(
    ".murmur-deck-skip-forward",
  ) as HTMLButtonElement | null;
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

  const otherLabel = deck.querySelector(
    ".murmur-deck-other-label",
  ) as HTMLElement | null;
  if (otherLabel) {
    otherLabel.textContent = isOther
      ? `↗ Listening to ${state.otherNoteName}`
      : "";
  }
}

// --- Speed wheel: tape-deck rotating-number-wheel effect ---

const SPEED_ANIM_KEY = "_murmurSpeedAnim";

function setSpeedLabel(speedBtn: HTMLButtonElement, rate: number): void {
  const stack = speedBtn.querySelector(
    ".murmur-deck-speed-stack",
  ) as HTMLElement | null;
  if (!stack) return;
  finalizeSpeedAnim(speedBtn);
  while (stack.firstChild) stack.removeChild(stack.firstChild);
  const label = document.createElement("span");
  label.className = "murmur-deck-speed-label";
  label.textContent = `${rate}×`;
  stack.appendChild(label);
  stack.style.transform = "translateY(0)";
}

function rollSpeedWheel(speedBtn: HTMLButtonElement, nextRate: number): void {
  const stack = speedBtn.querySelector(
    ".murmur-deck-speed-stack",
  ) as HTMLElement | null;
  if (!stack) return;

  // If a roll is in flight, snap it to its end (current = previous target).
  finalizeSpeedAnim(speedBtn);

  const newLabel = document.createElement("span");
  newLabel.className = "murmur-deck-speed-label";
  newLabel.textContent = `${nextRate}×`;
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

  const anim = stack.animate(
    [
      { transform: "translateY(0)" },
      { transform: `translateY(-${lineHeight}px)` },
    ],
    {
      duration: 220,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "forwards",
    },
  );
  (speedBtn as unknown as Record<string, unknown>)[SPEED_ANIM_KEY] = anim;

  anim.onfinish = () => finalizeSpeedAnim(speedBtn);
  anim.oncancel = () => finalizeSpeedAnim(speedBtn);
}

function finalizeSpeedAnim(speedBtn: HTMLButtonElement): void {
  const stack = speedBtn.querySelector(
    ".murmur-deck-speed-stack",
  ) as HTMLElement | null;
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
  stack.style.transform = "translateY(0)";
}
