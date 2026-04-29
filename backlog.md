# Backlog

Out-of-scope-for-v1 ideas worth keeping. Not committed work — pulled in only when v1 is stable.

---

## 1. Agent-triggered TTS — ambient narration from long-running agents

**The vision.** The agent gets a voice. Not for reading whole responses aloud — for occasional, terse status updates while you're doing something else. You're reading on your Kindle. A Claude Code session has been working on a refactor for eight minutes. It finishes, and a calm voice from your laptop says: *"Auth refactor done. Two tests fail; rerunning."* That's it. You decide whether to look. The agent doesn't ask permission to speak, and doesn't ramble — it just tells you what a colleague poking their head in would tell you.

Multiply: three or four agents running in parallel, each occasionally checking in. You stay in flow on the Kindle. The agents stay productive in the editor.

This is the long-term north star for Murmur. It reframes the plugin from "read my notes aloud" to "a voice channel for the things working on your behalf." Read-aloud is one customer; agents are another. The same TTS infrastructure serves both.

**Why it's distinct.** No mainstream TTS plugin treats the agent as a first-class caller. The closest analogues are Mac OS `say` (no integration into anything), or one-off Slack notifications (visual, interrupting). A scoped, voice-only side-channel keyed to the user's existing Obsidian setup is a real gap.

---

### Two things this needs

**(a) The mechanism — easy.** Register an `obsidian://murmur/speak?text=...` URI handler in `onload()` via `registerObsidianProtocolHandler`. Any agent that can shell out (`open`, `xdg-open`, `start`) can trigger speech. No special CLI integration required. Optional query params:
- `voice=alloy` — pick which voice speaks. Defaults to a separate "agent voice" setting so the user can audibly tell agents from their own reads.
- `agent=auth-refactor` — tag for the source. Lets the user route different agents to different voices via settings, or filter (e.g. mute one).
- `priority=low|normal|high` — see queueing below.

This part is small — maybe a day of work once v1 is stable. The plugin's existing player + cache + provider stack already do the heavy lifting.

**(b) The speakability discipline — the actually-hard part.** Agents are verbose by default. A raw "I have completed the refactor of the authentication service. The changes involve modifying three files: ..." spoken aloud is exactly the kind of babble the user is trying to escape. The vision only works if what gets spoken is *terse, factual, and earned* — like a one-sentence Slack message from a competent colleague.

Two approaches, ordered by ambition:

1. **Convention.** Murmur ships a recommended slash-command / agent prompt fragment that documents the voice contract: *"When invoking murmur, send at most one sentence. Prefer noun phrases. State result, not process. No filler."* The agent engineers the spoken output themselves; Murmur just speaks what it gets. Easy to ship, depends on user discipline.

2. **Synthesis layer.** Murmur exposes a second URI: `obsidian://murmur/announce?text=...` where the input is the *full* agent response and Murmur runs it through a small LLM call to produce a one-sentence speakable form before TTS-ing it. Costs more (an extra inference) but removes the discipline burden from the caller. Optional model choice; defaults to something cheap (Claude Haiku, GPT-4o-mini).

Approach 1 ships first. Approach 2 is a power-user add-on for users who don't want to think about it.

---

### Concerns to settle before building

**Queueing.** If three agents speak-aloud within five seconds, what happens?
- Default: FIFO queue, no interrupts. Each utterance plays in full.
- Priority param can bump to front (rare; "build broke" kind of urgency).
- Hard cap on queue depth — if more than ~5 utterances queue up, drop the oldest non-priority ones. Agents might run wild; user shouldn't get drowned.

**Per-agent voice routing.** Settings table mapping `agent=` tag → voice ID. So the user trains their ear: "alloy is the auth task, nova is the docs task." Without this, several concurrent agents sound identical and lose the channel-distinction value.

**On/off switch.** A single global mute, ribbon-accessible. Nobody wants their laptop suddenly speaking during a meeting. Probably also a "quiet hours" schedule — speech respects it, queues silently.

**Notification fallback.** If TTS fails (no network, no API key), drop to an Obsidian Notice. The agent shouldn't be silently dropped on the floor.

**Length cap.** Reject `text=` longer than ~500 chars at the URI layer with an explanatory Notice — encourages discipline, prevents the "agent dumps full response into TTS" failure mode.

**Privacy.** Agent text passes through whatever TTS provider the user has configured. ElevenLabs / OpenAI both keep submitted text per their data policies. Document this clearly. Local-only providers (e.g. macOS `say`, Web Speech API) become more attractive for sensitive workflows — see backlog #11.

**Caching collision.** Cache-by-text means two agents speaking the same sentence get one billing event. Good. But the cache key must include the voice, which it already does after the multi-provider work.

---

### Phasing

- **v1.x (after read-aloud stable).** URI handler. Single voice. FIFO queue. Global mute. Documented prompt-fragment for "speakable" output. This is the MVP — enough to validate the workflow.
- **v1.y.** Per-agent voice routing. Quiet hours.
- **v2.** Synthesis layer (the LLM-condensation announce endpoint). Probably also a small companion CLI (`murmur-say "..."`) so agents don't need to construct URIs themselves.

**Prereqs.** Stable v1 of the core read-aloud flow. Multi-provider support (done — agents will want a cheap provider so they can be chatty without bankrupting the user).

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

## 11. More TTS providers

ElevenLabs, OpenAI, and Cartesia are now supported (see `src/provider/`). The TTS landscape has shifted as of April 2026 — ElevenLabs is no longer the undisputed quality leader. Updated picture:

**Worth integrating next:**
- **Fish Audio S2 Pro** — currently top of EmergentTTS-Eval blind tests. ~$15/1M chars, ~10× cheaper than ElevenLabs at top tier. Most compelling quality/cost ratio. Same adapter pattern as OpenAI; ~30 min of work.
- **Inworld TTS-1.5 MAX** — #1 on Artificial Analysis Speech Arena (ELO ~1236 vs ElevenLabs v3 at 1179). Verify pricing transparency before committing.
- **Cartesia Sonic 3** — already integrated with sonic-2; bumping to sonic-3 if it's GA is a one-line model-list update.

**Worth skipping:**
- PlayHT (we don't need voice library variety for note narration).
- Speechmatics (cheap at $11/1M but quality reviews are lukewarm).
- Big-cloud TTS (Google, Azure, AWS Polly) — reliable but nobody picks them on quality.

**Local-only fallback** — see #15 below.

The `TTSProvider` interface + multi-provider settings shape is already in place — adding a cloud provider is roughly the size of [src/provider/openai.ts](src/provider/openai.ts) plus a settings render method.

---

## 15. Kokoro local TTS as the free default tier

**Idea.** Bundle Kokoro-82M (Apache-licensed, ~82M params, ~4.5 MOS, runs on a MacBook Air via ONNX/WASM) as the plugin's free local tier. Default for new users. No API key, no network, zero cost per character.

**Why it matters strategically.** "I want to hear my notes aloud" is a request that should not require setting up an API key and a payment method. Every cloud-only TTS plugin loses users at the API-key step. A free local default removes that entire friction class — the plugin becomes useful in 30 seconds instead of 10 minutes.

It's also the privacy story: agent narration (#1) of potentially-sensitive note content shouldn't pass through OpenAI/ElevenLabs servers. Local TTS solves that by construction.

**What it costs us.**
- Bundle size: Kokoro ONNX is ~80MB quantized, ~300MB full. Probably download-on-first-use rather than ship in the .zip. Use `app.vault.adapter` to cache.
- Engineering: ONNX Runtime Web in a CodeMirror plugin. WASM init, model loading, inference. ~2-3 days to get working.
- Performance: 82M params is small for a transformer but inference on a MacBook Air at acceptable latency requires care. Probably ~2-5x realtime — fine for whole-file narration, marginal for streaming.
- Quality: ~90% of cloud quality for prose narration. No voice cloning, limited voice packs (a handful of presets), flat emotional range. None of those matter for note narration.

**Phasing.**
1. Ship cloud-only v1 (current state).
2. Add Kokoro as an opt-in provider. Validate the inference path, model download UX, performance on real machines.
3. Once stable, make Kokoro the default for new installs. Existing cloud users stay on their current provider.

**References.**
- [Kokoro on GitHub](https://github.com/hexgrad/kokoro)
- [Kokoro TTS Review 2026 — ReviewNexa](https://reviewnexa.com/kokoro-tts-review/)

**Prereqs.** Stable v1 across cloud providers. ONNX Runtime Web evaluation pass to confirm it actually loads inside an Obsidian plugin's environment without breaking electron sandbox rules.

---

## 12b. Widget visual polish

User feedback: the karaoke highlight works but UI deserves polish — outline definition, spacing around words, possibly transitions. Areas to investigate:
- Smooth fade-in when active range changes (CSS transition on background-color may fight with CM6 decoration replacement; might need RAF-driven CSS variable approach)
- Subtle border or ring around the highlight for definition (v1 has a faint box-shadow ring)
- Customizable color via setting (light/dark/pastel)
- Optional underline-only style for users who find background highlights distracting

**Why backlog.** v1 highlight is functional. Polish iteration deserves real listening sessions to tune.

---

## 14. Widget theme switcher

**Idea.** A setting that picks the visual style of the player widget. Two themes to start:

- **Inline chip** (current). Compact pill, idle ↔ playing morph, conventional play/pause icon. The current implementation in `src/ui/player-widget.ts` and the chip CSS — preserved as-is.
- **Tape-deck** (new). Per [design-decisions.md](design-decisions.md). Larger footprint, pixel-grid timer (Departure Mono), rotating disc with `m` mark, single-block speed wheel, retro-mechanical character.

**Why both.** The inline chip is small and unobtrusive — appropriate for users who want a TTS plugin to fade into Obsidian's chrome. The tape-deck is bold and characterful — appropriate for users who want the player to be a *thing*. Forcing one philosophy is a choice we don't have to make.

The only competing TTS plugin (Microsoft Edge TTS, reportedly buggy) doesn't address this dimension at all. Shipping two visual modes is a real differentiator without doubling the surface area meaningfully — most code (player, segmenter, cache, settings) is shared.

**Sizing note.** The inline chip is fine at its current ~32px height. The tape-deck theme should be ~50–100% taller to give the disc and timer room. Actual pixel values to be set during tape-deck implementation, but the size difference between themes is intentional — small-and-quiet vs. tall-and-mechanical.

**Implementation sketch.**
- `MurmurSettings.widgetTheme: "inline-chip" | "tape-deck"` with default `"inline-chip"` (so existing users don't get a surprise visual change on update).
- Settings tab: dropdown to pick.
- `player-widget.ts` becomes a dispatcher that picks one of two `WidgetType` implementations based on the current setting. Or two separate WidgetType classes registered conditionally.
- Each theme has its own CSS namespace (`.murmur-chip-*` for inline, e.g. `.murmur-deck-*` for tape-deck) — no shared rules, no leak between themes.
- Switching themes at runtime should update visible widgets without a reload — straightforward via `refreshWidget()`.

**Prereqs.** Tape-deck implementation. Until then, this is one theme with no switcher.
