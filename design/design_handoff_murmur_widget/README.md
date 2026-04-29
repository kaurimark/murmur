# Handoff: Murmur player widget redesign

## Overview

This is a redesign of the top-of-file player widget for **Murmur**, the Obsidian read-aloud plugin. It replaces the current full-width band of squared-off transport buttons with a compact, expanding **inline chip** that lives in the same position (top of file, after frontmatter).

The redesign goals were:

- Reduce the widget's resting footprint so it stops competing with the prose.
- Add a real progress indicator (was: discrete `N/M` segment counter; now: scrubber + time).
- Reduce idle to a single affordance — full transport only appears once playback starts.
- Replace the dropdown speed control with a tap-to-cycle button.
- Keep all colors flowing through Obsidian theme variables so users can re-skin via themes.

## About the design files

The files in this bundle are **design references created in HTML/JSX** — a prototype showing intended look and behavior, not production code to copy directly. The task is to **recreate this design in Murmur's actual stack**: a CodeMirror 6 `WidgetType` rendered into the editor via `Decoration.widget`, written in plain TypeScript with vanilla DOM (`createDiv`, `createEl`, `setIcon`) and styled via `styles.css` using Obsidian's theme CSS variables. The current implementation lives in `src/ui/player-widget.ts` and `styles.css` — this redesign replaces both.

The React/JSX in this handoff is purely for prototyping the visuals and animation. There is no React in the actual plugin and no React should be added.

## Fidelity

**High-fidelity.** The prototype defines exact dimensions, type sizes, colors (mapped to theme variables), animation curves, and interaction details. Recreate it pixel-for-pixel in vanilla DOM + CSS, but adapt the implementation to the plugin's existing patterns (`setIcon` from Obsidian for lucide icons, `createDiv`/`createEl` instead of `document.createElement`, event listeners registered through the existing `button()` helper or equivalent).

---

## States

The widget has exactly two visual states. There is no separate "loading" or "paused" composition — those are minor variants of the playing composition (see "States and variants" below).

### Idle

Shown when:
- Settings → "Always show player" is on, AND
- No playback session is active

Composition: a single horizontal pill, content reads `▶  Read aloud  · 8 min`.

- **Container**
  - `display: inline-flex; align-items: center;`
  - Height: `32px`
  - Padding: `0 12px 0 10px`
  - Border: `1px solid var(--background-modifier-border)`
  - Border-radius: `999px` (full pill)
  - Background: transparent
  - Cursor: pointer (entire chip is the play affordance)
  - Max-width: `130px` (animates to ~`380px` when expanding — see Animation)
- **Play glyph**
  - Lucide `play`, size `11px`, color `var(--text-muted)`
- **Label** "Read aloud"
  - Font: UI sans (`var(--font-ui-small)` or equivalent system stack)
  - Size: `12px`, weight `400`
  - Color: `var(--text-muted)`
- **Duration** "· 8 min"
  - Same font/size as label
  - Color: `var(--text-faint)`
  - Computed at idle render time from segmenter output (sum of estimated speech duration; for v1, character-count / 14 chars/sec is fine — the UI just needs *some* number).

Hover state (idle): nudge color of label and play glyph to `var(--text-normal)`. No background change.

### Playing

Shown when a playback session is active. Same container morphs in place — the chip *is* the same DOM node, with classes/inline-styles toggled.

- **Container**
  - Height: `32px` (unchanged)
  - Padding: `0 10px 0 4px` (tighter on the left to align the play-button affordance)
  - Background: `var(--background-secondary)` (was transparent in idle)
  - Border: `1px solid var(--background-modifier-border)` (unchanged)
  - Max-width: `380px` (animates from idle's `130px`)
- **Primary action button** (play / pause toggle)
  - `24×24px` circle
  - Background: `var(--text-normal)`, icon color: `var(--background-primary)` (inverted contrast)
  - Icon: lucide `pause` while playing, `play` while paused, size `10px`
- **Skip back / skip forward**
  - `22×22` icon-only buttons, transparent, color `var(--text-muted)`
  - Lucide `skip-back` / `skip-forward`, size `11px`
  - Hover: background `var(--background-modifier-hover)`, color `var(--text-normal)`
  - Disabled (at first / last segment): opacity `0.4`, cursor `not-allowed`
- **Time + scrubber group** (fixed 130px wide block)
  - Layout: `[currentTime] [track flex:1] [duration]`
  - Gap: `8px`
  - Current time / duration: tabular-numerics, `11px`, `var(--text-muted)` for current, `var(--text-faint)` for duration
  - Track: `2px` tall, full-width, `border-radius: 999px`, background `var(--background-modifier-border)`
  - Filled portion: same height, background `var(--text-normal)`, width = `(currentTime / duration) * 100%`, transitions width `200ms linear` so the bar moves smoothly between `timeupdate` events
  - Click on track: scrub to position (compute `clientX` offset → fraction of total duration)
- **Speed button** "1×"
  - Text-only button, padding `0 6px`, height `22px`, border-radius `4px`
  - Font: UI sans `11px`, color `var(--text-muted)`
  - On click, cycles through `[0.75, 1, 1.25, 1.5, 1.75, 2]` and wraps
  - Hover: background `var(--background-modifier-hover)`, color `var(--text-normal)`
- **Close (✕)**
  - `22×22` icon-only button at the right end
  - Lucide `x`, size `11px`, color `var(--text-faint)`
  - Click: stops playback (calls existing `stopPlayback()`)

### States and variants within Playing

- **Paused:** primary button shows `play` icon. No other visual change. Scrubber stops moving but stays at current position.
- **Loading first segment:** primary button shows a 1px spinning border ring (12px diameter) instead of an icon. Scrubber shows a gentle indeterminate shimmer (a `1px` band moving left→right, 1.2s loop). Skip / speed / close stay enabled visually but skip is disabled until ready.
- **"Other note" indicator:** if the playing note differs from the active editor note, the entire chip on the **active** editor turns into a single text affordance: `↗ Listening to <basename>` — same chip dimensions, but the contents are replaced with this single label that opens the playing note on click. This replaces the current `murmur-widget-other-note` link.

---

## Animation (idle → playing transition)

The idle and playing faces share one container. Two child elements ("idle face" and "playing face") are positioned in the same row; only one is visible at a time.

CSS is the entire engine. No JS animation library.

**Container transitions:**

```
transition:
  background     280ms ease,
  border-color   280ms ease,
  padding        280ms cubic-bezier(0.22, 1, 0.36, 1),
  max-width      320ms cubic-bezier(0.22, 1, 0.36, 1);
```

When transitioning idle → playing, the container toggles a class (e.g. `is-playing`). CSS for that class flips `padding` and `max-width` to the playing values; the easing handles the rest.

**Idle face:**

- Idle → playing: `opacity 1 → 0` over `180ms ease`, `transform translateX(0) → translateX(-6px)` over `220ms ease`. After: `width: 0; pointer-events: none;`
- Playing → idle: same transitions reversed.

**Playing face:**

- Idle → playing: `opacity 0 → 1` over `220ms ease` with `60ms` delay, `transform translateX(8px) → translateX(0)` over `280ms cubic-bezier(0.22, 1, 0.36, 1)` with `40ms` delay.
- Playing → idle: reverse, no delays.

The slight delay on the playing face's fade-in lets the chip's chrome (background, padding, width) resolve a beat before the new content appears. This is what makes the morph feel deliberate rather than crossfaded.

**Why max-width and not width:** the playing-state width depends on tabular-numeric content widths and is not exactly known at layout time. `max-width` from `130px` to `380px` overshoots a tiny bit, which is harmless. If you want intrinsic-content sizing, `grid-template-columns: 0fr → 1fr` is the modern alternative; either works.

**Reduced motion:** wrap all transitions in `@media (prefers-reduced-motion: no-preference) { ... }` and have a fallback that sets the end-state instantly otherwise.

---

## Layout in the editor

Same insertion mechanism as today:
- A CM6 `Decoration.widget` with `block: true, side: -1`, positioned right after frontmatter (existing `findInsertPosition` helper is correct).
- The widget's outer wrapper has `padding-bottom: 24px` to separate it from the H1 below.
- **Remove** the existing `border-bottom` rule on `.murmur-widget`. The chip should not have an under-rule — it sits in space, not at the top of a panel.
- The chip is left-aligned inside the wrapper (no `margin-left: auto` etc.) — it sits flush with the prose left margin.

---

## Interactions & event handling

- **Click idle chip body:** start playback. Equivalent to today's "play button click on idle widget" → calls `readSmart()`.
- **Click play/pause primary button (playing state):** toggle play/pause.
- **Click skip-back / skip-forward:** segment-skip (existing behavior).
- **Click track (scrubber):** seek within current segment. Implementation: `const fraction = (e.clientX - track.getBoundingClientRect().left) / track.offsetWidth; player.seekFraction(fraction);` — needs a new `seekFraction()` method on `SegmentPlayer` that sets `audio.currentTime = fraction * audio.duration`.
- **Click 1× button:** cycle speed; persist via `setSpeed(rate)` (existing).
- **Click ✕:** stop playback (`stopPlayback()`).
- **Click "↗ Listening to …" affordance** (other-note variant): `openPlayingNote()` (existing).
- All button-level handlers must call `e.stopPropagation()` so they don't bubble up and re-trigger the chip-body click handler. Today's code already uses this pattern; preserve it.
- All listeners stamped via `registerDomEvent` so cleanup is automatic on widget destroy.

---

## Theme variables (use these, exactly)

Map the prototype's tokens to Obsidian's standard theme vars:

| Prototype token | Obsidian variable |
|---|---|
| `--m-bg` | `var(--background-primary)` |
| `--m-bg-secondary` | `var(--background-secondary)` |
| `--m-text` | `var(--text-normal)` |
| `--m-text-muted` | `var(--text-muted)` |
| `--m-text-faint` | `var(--text-faint)` |
| `--m-border` | `var(--background-modifier-border)` |
| `--m-hover` | `var(--background-modifier-hover)` |
| `--m-accent` | `var(--text-accent)` (only used for the "loading" shimmer; the chip otherwise reads from neutral text vars) |

Do NOT hardcode any colors. The prototype uses literal hex values (`#7c5cff`, `#a78bfa`, etc.) only because it has to render outside Obsidian; the production CSS must use the variables above so themes work.

---

## Typography

- **Label, button text:** UI sans — `var(--font-interface)` if available, otherwise `system-ui, -apple-system, "Segoe UI", sans-serif`.
- **Tabular numerics (current time / duration):** same family with `font-variant-numeric: tabular-nums`.
- All sizes:
  - Label / duration / "1×": `12px`
  - Time numerals: `11px`
  - Lucide icons: `10px` (primary button), `11px` (skip / close / scrubber-adjacent)
- Weights: regular (`400`) throughout.

---

## Spacing

- Chip outer padding: `0 12px 0 10px` (idle), `0 10px 0 4px` (playing)
- Inner gap (top-level chip flex): `10px`
- Skip-button cluster gap: `2px`
- Time-scrubber group internal gap: `8px`
- Wrapper padding-bottom: `24px`

---

## Design tokens (full list)

```
/* radii */
--murmur-radius-pill: 999px
--murmur-radius-button: 4px

/* sizes */
--murmur-chip-height: 32px
--murmur-primary-btn: 24px
--murmur-icon-btn: 22px
--murmur-track-height: 2px

/* widths */
--murmur-chip-idle-max: 130px
--murmur-chip-playing-max: 380px
--murmur-scrubber-group: 130px

/* type */
--murmur-fs-label: 12px
--murmur-fs-time: 11px
--murmur-icon-sm: 10px
--murmur-icon-md: 11px

/* motion */
--murmur-ease-out: cubic-bezier(0.22, 1, 0.36, 1)
--murmur-dur-shape: 320ms
--murmur-dur-color: 280ms
--murmur-dur-fade: 220ms
```

---

## Assets

- All icons are from **lucide** (`play`, `pause`, `skip-back`, `skip-forward`, `x`). Obsidian ships these — use `setIcon(el, 'play')`. No new asset files needed.
- No images, no fonts, no SVGs to bundle.

---

## Implementation notes (for the dev)

- `src/ui/player-widget.ts`: replace the current button-bar layout with the chip layout. The CM6 `WidgetType` interface stays the same — `toDOM()` returns the chip outer, `updateDOM()` updates classes / text content / styles based on `WidgetState`.
- `styles.css`: rewrite from scratch. Old class names (`.murmur-widget`, `.murmur-widget-btn`, `.murmur-widget-counter`, `.murmur-widget-speed`, `.murmur-widget-other-note`) can be retired. The redesign needs roughly:
  - `.murmur-chip` (container)
  - `.murmur-chip.is-playing` (state modifier)
  - `.murmur-chip-face` + `.murmur-chip-face.is-idle` / `.is-playing` (the two stacked faces)
  - `.murmur-chip-primary` (24px circular button)
  - `.murmur-chip-icon-btn` (skip / close)
  - `.murmur-chip-track` / `.murmur-chip-track-fill`
  - `.murmur-chip-speed` (text button)
- `WidgetState` type changes:
  - Add `currentTimeSec: number` and `durationSec: number` (replaces `segmentIndex / totalSegments` for display purposes — the segment counter is gone from the UI; segment skip still uses the underlying values internally).
  - Keep `playbackRate`, `status`, `otherNoteName`.
  - Add `idleEstimateMin: number` for the idle "· N min" label, computed from segmenter output before playback starts.
- `SegmentPlayer`: needs a `seekFraction(fraction: number)` method on the active segment. Trivial — `audio.currentTime = audio.duration * fraction`.
- The `currentTimeSec` value should update on `requestAnimationFrame` while playing (or on `timeupdate`, which fires ~4×/s — fine for the scrubber). Don't dispatch a CM6 effect every frame; instead, mutate the scrubber-fill `width` directly via a ref to the DOM node, so we don't churn the editor's transaction queue.

---

## Files in this handoff

- `Murmur widget — inline chip.html` — the live prototype. Open it to see the design canvas with the live-demo artboards (click the chip to see the expansion). The "Static states" section shows resting compositions.
- `v1-inline-chip-v2.jsx` — the chip's React component. Read this for exact dimensions, colors, transitions, and event wiring.
- `note-frame.jsx` — the Obsidian-note frame the chip sits inside (provides the visual context). Not part of the production widget — only there to give the chip an honest backdrop.
- `design-canvas.jsx` — supporting infrastructure for the prototype's pan/zoom artboard layout. Ignore for production purposes.

## Files to modify in the Murmur repo

- `src/ui/player-widget.ts` — rewrite the DOM construction in `createSkeleton()` and the update logic in `renderState()` per this spec.
- `styles.css` — replace contents.
- `src/audio/player.ts` — add `seekFraction(fraction: number)` and surface `currentTimeSec` / `durationSec` on `PlayerState`.
- `src/main.ts` — adapt `updatePlayerState` to forward the new fields into `WidgetState`. Compute `idleEstimateMin` from segments before kicking off playback (or in `refreshWidget` when in always-show mode for the active note's segments).

The current "Always show player" click bug noted in `backlog.md` (item 12a) is worth re-testing after this rewrite — the new structure may incidentally fix it, since the chip body itself is the click target rather than a nested play button competing with CM6's event handling.
