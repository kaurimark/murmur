# Backlog

Out-of-scope-for-v1 ideas worth keeping. Not committed work — pulled in only when v1 is stable.

---

## 1. Agent-triggered TTS via Obsidian URI

**Idea.** Register an `obsidian://murmur/speak?text=...` URI handler so an LLM agent (running via Obsidian CLI, Agent Client, or just shelling out to `open`) can speak text to the user. Effectively, the agent gets a voice.

**Why it's interesting.** Pairs naturally with how the user already works (Obsidian + LLMs). Turns the plugin from a passive read-aloud tool into an output channel for agents. Differentiator on the marketplace.

**Mechanism (verified).** Obsidian CLI as of Feb 2026 focuses on note CRUD; it does not expose generic plugin-command invocation. The clean path is the URI handler, which Obsidian has supported for years. The agent shells out: `open "obsidian://murmur/speak?text=Hello"` on macOS (or `xdg-open` / `start`).

**Open questions.**
- Queueing: if the agent fires three speak-aloud calls in a row, do we interleave, queue, or interrupt?
- Should agent-triggered speech use a distinct voice from user-initiated reads, so the user can audibly tell them apart?
- URI text length cap? Long texts may need a paste-via-clipboard fallback.

**Prereqs.** Stable v1 of the core read-aloud flow.

---

## 2. Markdown tables sound coherent when spoken

**Problem.** Speechify (Mac and mobile) garbles markdown tables — it reads pipes, dashes, and column alignment markers as if they were words, and loses all sense of row/column structure. Result is unintelligible.

**Current state.** v1 announces "Table with N rows, skipped." That's safe but a regression on user value if they actually want the table read.

**Approach to investigate.**
- Pre-process tables in our markdown segmenter: detect GFM table syntax, rewrite into spoken form before sending to TTS.
- Possible spoken renderings to try:
  - *"Table with columns Name, Age, City. Row 1: Name Alice, Age 30, City Paris. Row 2: ..."*
  - Header-once-then-values: *"Alice, 30, Paris. Bob, 25, Berlin."* (faster, less robotic, but loses column context)
  - Setting: skip / brief / full.

**Related.** Same class of fix as math (`$x^2$` should not be read as "dollar x caret two dollar") and footnote markers.

---

## 3. General markdown-to-speech naturalness pass

**Problem.** Plain markdown stripped of formatting still sounds robotic when read by TTS — list items run together, link URLs get spoken as gibberish if not stripped, sentence boundaries get lost.

**Things worth trying.**
- Split list items into separate segments so each gets its own pause beat.
- For long links, prefer the visible label and skip the URL entirely (already done in v1, refine for edge cases like raw URLs `<https://...>`).
- Footnote handling: defer footnote bodies to the end, or skip entirely with a configurable setting.
- Convert headings into prosodic markers — e.g. announce *"Section: ..."* before a level-2 heading on first occurrence, or just rely on a longer pause (v1 does the longer-pause approach).
- Sentence-boundary detection for cleaner pause timing inside long paragraphs.

**Project north-star.** Per the user: *"a lot of the value here is in making normal Obsidian markdown syntax sound very natural in speech."* This category is the differentiator vs. Speechify and raw ElevenLabs.

---

## 4. Obsidian-specific markdown syntax — full coverage

**Problem.** Beyond CommonMark, Obsidian has its own syntax that's invisible to standard markdown parsers.

**Cases to handle (v1 has partial coverage marked ✓):**
- ✓ Wikilinks: `[[Note]]`, `[[Note|Label]]` → speak label/target
- ✓ Embeds: `![[Note]]`, `![[Image.png]]` → speak target only (no "exclamation point")
- ✓ Highlights: `==text==` → speak as plain
- ✓ Comments: `%% private %%` → drop entirely
- ✓ Task checkboxes: `- [ ]`, `- [x]` → drop the bracket marker
- ✓ Callout markers: `> [!note]` first line → drop the `[!type]` part
- ☐ Math inline: `$x^2$` → drop or read as "x squared" (TeX-aware?)
- ☐ Math block: `$$...$$` → "math block, skipped" announcement
- ☐ Tags: `#tag` → speak as "tag" or skip entirely
- ☐ Mentions: `@user` (some plugins use this) → speak as name
- ☐ Footnotes: `[^1]` and definitions — defer or skip
- ☐ Block references: `[[Note#^block-id]]` → speak the visible link only
- ☐ Dataview queries: ```dataview ... ``` → "dataview query, skipped"
- ☐ Mermaid / charts: ` ```mermaid ` → "diagram, skipped"
- ☐ Frontmatter values: currently dropped; should an option speak title/aliases?

---

## 5. Voice previews in plugin settings

**Idea.** A "Test voice" button next to the voice ID field that plays a 5-second sample with the configured voice + model. Removes the friction of: save settings → open a note → run command → listen → realize voice is wrong → repeat.

**Why now.** Picking voices from ElevenLabs' library is the highest-friction part of the current setup loop — the user hit this on first use. A button removes a 30-second round trip to a 1-second one.

**Implementation.** Settings tab gets a button that calls the existing provider with a hardcoded sample sentence. Reuse `SegmentPlayer` or a stripped-down one-shot player. ~30 LOC.

---

## 6. Bold/italic affect speech delivery

**Problem.** ElevenLabs strips/ignores `*`/`**`/`_` markdown by default. The model has no way to know the user emphasized "really" in "I really meant it."

**Hacks worth trying.**
- Capitalize bolded words before sending. ElevenLabs models often interpret all-caps as stress. Risk: comes across as shouting.
- Surround bolded words with punctuation or hyphens to slow delivery.
- For Eleven v3 specifically: try "audio tags" like `[emphasis]` or `[stress]` — Eleven v3 supports inline tags for tone control.
- Model-specific behavior: a setting to toggle the strategy depending on which model the user picked.

**Why backlog.** Needs A/B listening sessions with real notes. Easy to make it worse than no emphasis.

---

## 7. Configurable pause durations

v1 hardcodes pause-after-heading (600ms), pause-after-paragraph (250ms), pause-after-announcement (400ms). If users have strong preferences, expose as settings. Trivial to do, deferred until someone asks.

---

## 8. Accurate source-to-spoken character mapping for highlighting

Phase 4 v1 will use approximate (proportional) mapping from spoken-character-index to source-character-offset. That mapping drifts on heavily-formatted lines (lots of markdown stripped). For pixel-accurate karaoke highlighting, the segmenter should emit a per-segment `spokenToSourceMap: number[]` during rendering — each spoken char index points to its origin source offset.

**Approach.** Replace the regex-based renderer with a small token-walker that emits both the speech string and a position map. ~100 LOC. Defer until v1 ships and we see whether the approximate version is acceptable.

---

## 9. Split oversized paragraphs before sending to ElevenLabs

ElevenLabs has a per-request character limit (~5K on most plans). A single paragraph longer than that fails today; v1 surfaces the error and skips the segment, but the user loses the content. A pre-segmenter pass could split long paragraphs at sentence boundaries.

---

## 10. Configurable pre-narration delay

User feedback: TTS that starts within 500ms of the trigger feels mechanical. Humans pause a beat before responding aloud. A configurable delay (default ~1s, range 0–5s) before the first segment plays would make the interaction feel more natural.

**Implementation.** Setting `preNarrationDelayMs`. In `readCurrentNote`, schedule the first `play()` via `setTimeout`. Trivial.

---

## 11. Alternative TTS providers

ElevenLabs is the v1 default and works well, but at scale it's expensive. Cheaper alternatives matter for power users.

**Candidates** (already evaluated in plan.md research pass):
- **Cartesia Sonic** — closest to ElevenLabs in quality, native word timestamps, streaming. Strongest substitute.
- **Microsoft Azure Neural TTS** — most mature word-boundary support, generous free tier, very reliable but less expressive.
- **OpenAI TTS** — quality good; word timestamps were historically the weak spot. Verify current state before integrating.
- **Play.HT, LMNT, Deepgram Aura** — second-tier options.

**Prereqs.** Stable v1 of read-aloud + widget UI. The `TTSProvider` interface is already in place, so adding a provider is mostly adapter work — implement the same `with-timestamps` shape over the new API.

---

## 12a. Always-show widget click bug

When "Always show player" is on and the user navigates to a fresh note, clicking the play button on the idle widget doesn't trigger playback — only the hotkey works. Multiple fix attempts (mousedown handling, preventDefault tweaks, try/catch with logging) haven't reproduced or fully resolved it. Console error logging is now in place; next time it happens, capture DevTools console output to see whether the click handler fires at all, whether `actions` is null, or whether `readSmart` errors out.

Possible causes still to investigate: CM6 block-widget event interception, focus-stealing on first interaction, stale `getActiveViewOfType` reference in a not-fully-mounted view.

---

## 12b. Widget visual polish

User feedback: the karaoke highlight works but UI deserves polish — outline definition, spacing around words, possibly transitions. Areas to investigate:
- Smooth fade-in when active range changes (CSS transition on background-color may fight with CM6 decoration replacement; might need RAF-driven CSS variable approach)
- Subtle border or ring around the highlight for definition (v1 has a faint box-shadow ring)
- Customizable color via setting (light/dark/pastel)
- Optional underline-only style for users who find background highlights distracting

**Why backlog.** v1 highlight is functional. Polish iteration deserves real listening sessions to tune.
