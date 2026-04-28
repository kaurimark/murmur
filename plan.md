# Murmur — v1 implementation plan

Working title: **Murmur**. Obsidian community plugin for read-aloud with karaoke-style highlighting, powered by ElevenLabs.

---

## v1 scope (what ships)

- Read whole current note OR selected text via TTS
- Karaoke-style word/character highlight in the editor as audio plays
- Top-of-file player widget (toggleable in settings: always-visible vs on-demand-only)
- Ribbon icon for discoverability
- Hotkey for selection-read (Obsidian-native hotkey, user-configurable)
- Standard playback controls: play/pause, stop, skip back/forward by sentence, speed (1× / 1.25× / 1.5× / 2×)
- Single voice configured in settings (in-player picker is v1.1)
- Default model **Flash v2.5**, with **Multilingual v2** as "higher quality" toggle
- Per-note audio + alignment cache on disk, keyed by `hash(text + voice_id + model_id)`
- Settings tab in standard Obsidian settings: API key, voice ID, model, widget visibility, cache management
- Desktop-only (`isDesktopOnly: true`)
- English-only (the plugin doesn't restrict language, but we don't test or document multilingual until v1.1)

## Out of scope for v1 (deferred)

- True HTTP streaming (using paragraph-chunked non-streaming for v1; swap later if needed)
- In-player voice picker (v1.1)
- Multilingual support (v1.1)
- Multiple providers (interface designed for it, only ElevenLabs implemented in v1)
- Mobile (`isDesktopOnly: true` for v1)
- Everything in [backlog.md](backlog.md): agent-triggered TTS via URI handler, table-aware speaking, naturalness pass

---

## Architecture

### Provider interface (designed for swap, only one impl in v1)

```ts
interface TTSProvider {
  generate(opts: {
    text: string;
    voiceId: string;
    modelId: string;
  }): Promise<{
    audio: ArrayBuffer;          // decoded MP3 bytes
    alignment: CharAlignment;    // per-character start/end seconds
  }>;
}

interface CharAlignment {
  characters: string[];
  charStartTimesSeconds: number[];
  charEndTimesSeconds: number[];
}
```

Implementation: `ElevenLabsProvider` calls `POST /v1/text-to-speech/{voice_id}/with-timestamps` with `xi-api-key` header. Decodes `audio_base64` into `ArrayBuffer`, normalizes the `alignment` field. Use Obsidian's `requestUrl()` (handles CORS, works on mobile if we ever go there).

### Segmenter

Walk the markdown AST (use `remark` — bundles cleanly with esbuild) and emit segments:

```ts
interface Segment {
  text: string;             // plaintext to send to TTS
  sourceStart: number;      // editor offset, for highlighter mapping
  sourceEnd: number;
}
```

Per-segment rules for v1 (everything else → backlog):
- Paragraphs become segments (one segment per paragraph)
- Headings → prefix with a short pause marker (`. ` before sending) and become their own segment
- Code blocks → skipped, replaced with `"code block, N lines"` announcement (emits as a segment)
- Tables → skipped, replaced with `"table with N rows"` announcement (proper handling is in [backlog.md](backlog.md))
- Frontmatter → ignored entirely
- Inline code → backticks stripped, content preserved
- Links → keep label only, drop URL
- Math, footnotes, embeds → skipped with brief announcement

### Audio engine

A single `Player` object owns: a queue of `{segment, audio, alignment}` items, the currently-playing `HTMLAudioElement`, and a high-resolution `currentTime` callback. Behavior:

1. User triggers read → segmenter produces N segments
2. Player kicks off generation for segment 0 immediately
3. As soon as segment 0's audio is back: start playback, kick off generation for segment 1
4. While playing segment N, generate segment N+1 in parallel (one-deep prefetch — don't go wider, ElevenLabs concurrency limits + cost)
5. When segment N's audio ends, advance to segment N+1; if it's not ready, brief loading state
6. Highlighter: subscribe to playing audio's `timeupdate`, look up the active character in the alignment array, map back to `sourceStart + charIndex` in the editor, apply a CodeMirror 6 decoration

Skip-by-sentence: split a segment's alignment by sentence-boundary characters (`.!?` followed by space/newline), `currentTime` jumps to that sentence's start time. Play/pause is `audio.pause()` / `audio.play()`. Speed is `audio.playbackRate`.

### Highlighter

CodeMirror 6 `StateField` holding a single `Decoration.mark` over the active character (or word — tunable via setting). Updated on every `timeupdate` from the player. Cheap because CM6 only re-renders the affected line.

### Cache

```
.obsidian/plugins/murmur/cache/
  <sha256(text + voice_id + model_id)>.mp3
  <sha256(text + voice_id + model_id)>.json   // alignment
  index.json                                  // LRU metadata
```

LRU eviction at a configurable size cap (default 500 MB). Cache is per-segment, not per-note — same paragraph in two notes hits the cache twice.

---

## File layout

```
loud-and-clear-tts/
  manifest.json
  package.json
  tsconfig.json
  esbuild.config.mjs
  versions.json
  styles.css
  README.md
  CLAUDE.md
  plan.md
  backlog.md
  src/
    main.ts                   # Plugin entry, registers everything
    settings.ts               # PluginSettingTab + settings type
    provider/
      types.ts                # TTSProvider interface
      elevenlabs.ts           # ElevenLabsProvider impl
    segmenter/
      index.ts                # markdownToSegments(text): Segment[]
      rules.ts                # per-node rendering rules
    audio/
      player.ts               # Player: queue, prefetch, playback
      cache.ts                # disk cache with LRU
    ui/
      widget.ts               # Top-of-file player widget
      ribbon.ts               # Ribbon icon registration
      highlighter.ts          # CM6 StateField for active-char decoration
    util/
      hash.ts
      mdToPlaintext.ts
```

Total estimate: ~1,500 LOC for v1.

---

## Implementation order (one PR per phase, easier to review)

1. **Scaffold** — `manifest.json`, `package.json`, esbuild config, `tsconfig.json`, empty `main.ts` extending `Plugin`. Commands: dev/build/version. Verify it loads in Obsidian.
2. **Provider + naive playback** — `ElevenLabsProvider`, settings tab with API key + voice ID input, command "Read whole note" that fetches the audio and plays it. No highlight, no widget yet. Smoke test against a real ElevenLabs key.
3. **Segmenter** — `remark`-based segmenter, paragraph chunking, code/table/frontmatter handling. Wire it into the command from step 2 — generate segment-by-segment, play sequentially.
4. **Highlighter** — CM6 StateField, active character decoration tied to `timeupdate`. Tune word vs character granularity.
5. **Cache** — disk cache for audio + alignment, LRU eviction, settings entry to clear cache.
6. **Player widget** — top-of-file widget with full controls (play/pause/stop, skip ±sentence, speed). Settings toggle for always-visible vs on-demand.
7. **Selection read + hotkey** — selection detection, hotkey command, plays the selection.
8. **Polish** — error handling (Notice on 401/429/network), `normalizePath()` audit, theme CSS variables, `innerHTML` audit (use `createEl`/`createDiv` everywhere), README with disclosure of network calls.
9. **Submission** — review checklist below, `versions.json`, GitHub release with `main.js + manifest.json + styles.css`, PR to `obsidianmd/obsidian-releases`.

---

## Submission checklist (community marketplace)

- [ ] `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `authorUrl` in `manifest.json`
- [ ] `isDesktopOnly: true`
- [ ] `versions.json` maps each release to its min Obsidian version
- [ ] Release tag matches `manifest.json` version, **no `v` prefix**
- [ ] Release assets: `main.js`, `manifest.json`, optionally `styles.css`
- [ ] All user-supplied paths run through `normalizePath()` (most cited rejection reason)
- [ ] No `innerHTML` / `outerHTML` / `insertAdjacentHTML` with non-static strings — use `createEl`, `createDiv`, `createSpan`
- [ ] No network call before user has entered a key and explicitly invoked a read action
- [ ] README documents: what data is sent (note text), where (api.elevenlabs.io), how to opt out (don't enter a key)
- [ ] All event listeners registered via `registerDomEvent` / `registerEvent` so cleanup is automatic
- [ ] Styles in `styles.css`, using CSS variables (`--text-normal`, `--background-primary`, etc.) so themes work
- [ ] No sample-plugin boilerplate left in (rename `MyPlugin`, drop placeholder strings)
- [ ] License file (MIT)
- [ ] No hardcoded API key or secret-encryption-with-hardcoded-key shenanigans

---

## Open risks

- **Streaming endpoint exact path** is fuzzy. v1 uses non-streaming with paragraph chunking, so this doesn't block — but if we want to swap later, we'll re-verify the streaming path.
- **CodeMirror 6 decoration performance** for very long notes (10K+ words). Mitigation: only decorate the active line's range, not the whole document.
- **Eleven v3 timestamp support** unverified — does the new flagship model return character alignment? If yes, expose as a premium option in v1.1. If no, stay on Flash v2.5 and Multilingual v2.
- **API key in plaintext** is the unavoidable Obsidian convention. Document it clearly in README; recommend users with shared/synced vaults exclude `data.json`.
- **Markdown segmentation correctness** is where most bugs will live. Start with a small fixture set of pathological notes (heading-heavy, code-heavy, table-heavy, frontmatter-heavy) and lean on those as regression tests.

---

## Out-of-scope reminder

When in doubt, push it to [backlog.md](backlog.md). Three things already there:
1. Agent-triggered TTS via `obsidian://` URI handler (CLI not needed)
2. Markdown tables that sound coherent
3. General markdown→speech naturalness pass
