import { setIcon } from "obsidian";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

export interface WidgetState {
  status: "idle" | "loading" | "playing" | "paused";
  segmentIndex: number;
  totalSegments: number;
  playbackRate: number;
}

export interface WidgetActions {
  togglePlayPause: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  setSpeed: (rate: number) => void;
}

let actions: WidgetActions | null = null;

export function setWidgetActions(a: WidgetActions | null): void {
  actions = a;
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

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];

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
      this.state.status === other.state.status &&
      this.state.segmentIndex === other.state.segmentIndex &&
      this.state.totalSegments === other.state.totalSegments &&
      this.state.playbackRate === other.state.playbackRate
    );
  }

  toDOM(): HTMLElement {
    const dom = createSkeleton();
    renderState(dom, this.state);
    return dom;
  }

  updateDOM(dom: HTMLElement): boolean {
    renderState(dom, this.state);
    return true;
  }
}

function createSkeleton(): HTMLElement {
  const outer = document.createElement("div");
  outer.className = "murmur-widget-outer";

  const dom = document.createElement("div");
  dom.className = "murmur-widget";

  const prevBtn = button("skip-back", "murmur-widget-prev", () =>
    actions?.prev(),
  );
  const playPauseBtn = button("play", "murmur-widget-play-pause", () =>
    actions?.togglePlayPause(),
  );
  const nextBtn = button("skip-forward", "murmur-widget-next", () =>
    actions?.next(),
  );
  const stopBtn = button("square", "murmur-widget-stop", () =>
    actions?.stop(),
  );

  const counter = document.createElement("span");
  counter.className = "murmur-widget-counter";

  const speedSelect = document.createElement("select");
  speedSelect.className = "murmur-widget-speed";
  for (const s of SPEED_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = `${s}×`;
    speedSelect.appendChild(opt);
  }
  speedSelect.addEventListener("mousedown", (e) => e.stopPropagation());
  speedSelect.onchange = (e) => {
    e.stopPropagation();
    const rate = parseFloat(speedSelect.value);
    if (Number.isFinite(rate)) actions?.setSpeed(rate);
  };

  dom.append(prevBtn, playPauseBtn, nextBtn, stopBtn, counter, speedSelect);
  outer.appendChild(dom);
  return outer;
}

function renderState(outer: HTMLElement, state: WidgetState): void {
  const dom = outer.querySelector(".murmur-widget") ?? outer;
  const playPauseBtn = dom.querySelector(
    ".murmur-widget-play-pause",
  ) as HTMLButtonElement | null;
  const prevBtn = dom.querySelector(
    ".murmur-widget-prev",
  ) as HTMLButtonElement | null;
  const nextBtn = dom.querySelector(
    ".murmur-widget-next",
  ) as HTMLButtonElement | null;
  const stopBtn = dom.querySelector(
    ".murmur-widget-stop",
  ) as HTMLButtonElement | null;
  const counter = dom.querySelector(
    ".murmur-widget-counter",
  ) as HTMLSpanElement | null;
  const speedSelect = dom.querySelector(
    ".murmur-widget-speed",
  ) as HTMLSelectElement | null;

  if (!playPauseBtn || !prevBtn || !nextBtn || !stopBtn || !counter || !speedSelect) {
    return;
  }

  if (state.totalSegments > 0) {
    counter.textContent = `${state.segmentIndex + 1} / ${state.totalSegments}`;
  } else {
    counter.textContent = "";
  }

  if (speedSelect.value !== String(state.playbackRate)) {
    speedSelect.value = String(state.playbackRate);
  }

  setIcon(playPauseBtn, state.status === "playing" ? "pause" : "play");

  const idle = state.status === "idle";
  const loading = state.status === "loading";

  prevBtn.disabled = idle || loading || state.segmentIndex <= 0;
  nextBtn.disabled =
    idle || loading || state.segmentIndex >= state.totalSegments - 1;
  stopBtn.disabled = idle;
  speedSelect.disabled = loading;
}

function button(
  icon: string,
  className: string,
  onclick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `murmur-widget-btn ${className}`;
  btn.type = "button";
  setIcon(btn, icon);
  btn.addEventListener("mousedown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("Murmur: click", className, "actions=", actions !== null);
    try {
      onclick();
    } catch (err) {
      console.error("Murmur widget click error:", err);
    }
  });
  return btn;
}
