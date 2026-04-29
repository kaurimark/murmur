# Murmur — Design Decisions

Living document. Last updated: 2026-04-29.

## Intended home

This file should live in the Murmur project at `/Users/user/Projects/murmur/`. Written here because the assistant only has access to the notes workspace. Copy or move it.

---

## Mood

Retro / tape-deck with literary undertones. Mechanical character on a soft page.

The widget is meant to **contrast** with the body text, not blend. A pixel-grid timer floating inside literary serif prose is the design intent — tape-deck-in-a-library. If the timer ever feels like it should "blend in," the design has failed and the call to reopen.

## Theming

The widget must work against **any** user theme via CSS variables. The author's cream palette is a personal preference, not a design assumption. No styling choice may depend on a specific color.

## Placement

Widget lives at the top of the pane, between Obsidian's inline title and the file content. Does not float, does not pin to the bottom.

---

## Typography

### Time counter & speed indicator

**Departure Mono** (free).

Implementation rules:

- Departure Mono is a pixel-grid font designed at 13px (and integer multiples — 26, 39). Off-grid sizes will fuzz on non-retina displays. Pick the timer font-size on the grid.
- Use the real multiplication sign `×` (U+00D7) for speed labels, not lowercase `x`.
- Verify Departure Mono's redistribution license is compatible with shipping inside an MIT-licensed plugin before final release.

### Disc mark

**Fraunces Italic**, lowercase, single letter `m` (Murmur's initial). Cormorant Italic kept as alternative to compare visually before committing.

- Letter is the brand initial. Reads as quiet functional ornament, not as branding stamp.
- Off-center on the disc, at ~40–50% of disc radius from center. Center-positioned marks wouldn't visibly rotate.
- Sized small enough that "upside-down m" reads as ornament rather than legible-but-broken text. At a ~26px disc, font-size around 11–13px.
- Color: contrasts with disc fill. Ideally derived from the theme background variable so the mark reads as "punched out" of the disc.

### Body text

Whatever the user's Obsidian theme provides. Do not override.

---

## Controls

| Control | Behavior |
|---|---|
| **Play / pause** | Solid disc, same size as siblings. Lowercase italic `m` mark, off-center. **No play/pause icon.** State is shown by motion: disc rotates when playing, static when paused. `aria-label` required ("Play" when paused, "Pause" when playing). |
| **Prev / next** | Skip by segment. A segment is a paragraph (most often) or sentence (sometimes). Outline icons. |
| **Speed** | Cycles through `0.75 / 1 / 1.25 / 1.5 / 1.75 / 2`, then wraps to `0.75`. Click-only (no dropdown). Animated on each click — see Animations. |
| **Progress** | Scrubbable. Scrubbing changes audio position. Karaoke highlight in body text follows audio position — so the highlight moves *indirectly* when you scrub (it tracks the currently-narrated word). |
| **Close** | Standard X. Closes the widget for that note. |

### Hover / press

Buttons gain a subtle grey outline on hover (existing behavior — keep). Optional: small inset/pressed feel on click for mechanical-button feedback. Low priority.

### Visual emphasis

Play is the call-to-action and should be the heaviest element, but **subtly**. Solid fill alone is enough. No glow, no scale-up, no color shift.

---

## Animations

### Speed wheel

Tape-deck rotating-number-wheel effect. Displayed digits roll like a physical wheel.

- **Direction:** always rolls up. Old digit goes up off the top; new digit rolls in from the bottom. Including at the `2 → 0.75` wraparound — the wheel wraps. Mechanically truthful.
- **Roll unit:** the entire label rolls as a single block (e.g., `1.25×` rolls up, `1.5×` rolls in from below). Per-digit independent rolls feel mechanical-wrong — a tape-deck wheel is one mechanism, not several dials.
- **Duration:** 180–240ms.
- **Easing:** ease-out.
- **Interruptible:** if the user clicks again mid-animation, abort the current roll and start the next one immediately. Never block input.
- **No sound effects.** Resist this even though it's tempting. Silent decks are correct here.

### Play-disc rotation

The disc (and the `m` mark on it) rotates while playing.

- **Speed:** ~3 seconds per full revolution.
- **Easing:** linear.
- **Start/stop:** clean on/off — no spin-up or spin-down. The transport is binary.
- **The mark rotates WITH the disc.** Do not counter-rotate it to stay upright. The `m` will be upside-down for half of every revolution. That is correct: a real knob's mark rotates with the knob. Counter-rotation breaks the physicality.
- **Disc visibility when paused:** the mark stays visible; rotation stops. "The mechanism is there even when stopped."
- **Loading state:** same disc, stationary. No separate spinner — the mechanism is there even when waiting.

### Time counter

No animation in v1. After the speed wheel ships, decide whether to add an odometer-style roll on the rightmost digit. Risk of busy-ness if every second animates.

---

## State

- **Voice selection** lives in plugin settings only. Currently a pasted ElevenLabs voice ID. Not exposed in the widget. (Decision rationale: voice changes mid-playback are rare, settings is the right home, keeping the widget uncluttered.)

---

## Accessibility

- Play button has no visual icon, so `aria-label` is **required** and must reflect current state ("Play" when paused, "Pause" when playing).
- All controls reachable by keyboard. Focus indicators must be visible against any theme.
- `prefers-reduced-motion`: when set, disable the disc rotation and the speed wheel animation; speed change becomes instant.

---

## Out of scope for v1

- LED / playing-state indicator dot
- Tape-reel motif (rejected — disc rotation alone is enough texture)
- Voice picker in widget (lives in settings)
- Buffering / error / end-of-document states surfaced in the widget
- Sound effects of any kind
- Hours-format timer (`H:MM:SS`) — `M:SS` covers expected note lengths

---

## Open questions

- Disc mark: Fraunces Italic `m` (current pick) vs. Cormorant Italic `m` vs. off-center dot vs. faint groove. Live preview pending side-by-side comparison.
- Mark color: **decision: bg-derived (punched-out)**, pending visual iteration once first pass ships.
- Off-center offset: 40%, 50%, or ~65% of disc radius. To be decided visually.
- Prev / next icon style — keep current Lucide outline icons or switch to something custom. Undecided.
- Final widget size for the tape-deck theme. The inline-chip stays small; tape-deck should be ~50–100% larger to give the timer, disc, and `m` mark room to breathe. Concrete pixel values to be picked alongside first implementation pass.

---

## What's NOT in this doc

Implementation details derivable from the code (file paths, class names, exact CSS values). This is the why-and-what file. The repo at `/Users/user/Projects/murmur/` is the source of truth for code.
