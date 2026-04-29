# Murmur

A read-aloud plugin for Obsidian. Sends your note text to a TTS provider of your choice for high-quality text-to-speech, with karaoke-style highlighting that follows the spoken word in your editor.

Built because Speechify mangles markdown — tables, code, lists, callouts — and runs paragraphs together with no pauses. Murmur understands Obsidian's markdown shape and renders it for the ear.

## Features

- Read whole note or just selected text
- Karaoke-style highlight tracking the spoken word in source mode and Live Preview
- Top-of-file player (or a draggable floating widget) with play/pause, segment skip, stop, and 0.75×–2× speed
- Two widget themes: a minimal inline chip, or a tape-deck with pixel-grid timer and rolling speed wheel
- Disk cache so re-reading a note is instant and free
- Pauses around headings, between paragraphs, between list items
- Strips Obsidian-specific syntax (wikilinks, embeds, callouts, highlights, comments, task checkboxes) so it sounds like prose, not code

## Providers

Pick whichever fits your budget and quality bar. All keys are stored locally in your vault — Murmur never proxies through a server.

| Provider | Strengths | Karaoke precision | Approx. cost |
| --- | --- | --- | --- |
| **ElevenLabs** | Highest karaoke precision (true word-level timestamps from the API). Excellent voices. | Per-character | ~$0.05–0.10 / 1K chars |
| **Inworld** | Currently top of the Artificial Analysis Speech Arena. OpenAI-level pricing. | Synthesized from duration | ~$35 / 1M chars |
| **Fish Audio** | Fast, lots of community voices. | Synthesized from duration | Pay-as-you-go |
| **Cartesia** | Low latency, expressive voices. | Synthesized from duration | Pay-as-you-go |
| **OpenAI** | Cheapest, six built-in voices. | Synthesized from duration | ~$15 / 1M chars |

Karaoke highlighting works on every provider; ElevenLabs is the only one that returns true per-character alignment, so on the others Murmur synthesizes a uniform alignment from audio duration (still very usable, just slightly less precise on long words).

## Install

### From the community plugins browser (once approved)

1. Settings → Community plugins → Browse
2. Search for "Murmur"
3. Install, then Enable

### Manual install

1. Clone this repo into your vault: `<vault>/.obsidian/plugins/murmur/`
2. `npm install && npm run build`
3. In Obsidian: Settings → Community plugins → Reload, then enable "Murmur"

## Setup

1. Get an API key from your provider of choice (see the table above for links).
2. In Obsidian, open Settings → Murmur and pick the provider.
3. Paste the API key. Pick a voice and model (defaults are sensible).
4. Optional: hit "Preview" in settings to taste the voice before committing.
5. Optional: set a max cache size (default 500 MB), pick a widget theme, choose inline vs floating placement.

## Use

- Click the audio-lines icon in the ribbon, or
- Run "Read note (or selection)" from the command palette (`Cmd+P`), or
- Assign a hotkey to that command in Settings → Hotkeys

If text is selected, it reads the selection. Otherwise it reads the whole note.

The widget appears at the top of the file (after frontmatter, if any) with playback controls — or as a draggable floating pane that stays visible everywhere, your choice.

## Privacy

Murmur sends your note text — or just the selected portion — to whichever TTS provider you've configured, over HTTPS, in order to generate audio. **Your API key is stored as plain text** in `<vault>/.obsidian/plugins/murmur/data.json`. If your vault is shared or synced, treat that file as sensitive.

No analytics, no telemetry, no other network calls. The only outbound traffic is to the TTS provider you've selected.

## Limitations

- **Desktop only** for now (`isDesktopOnly: true`). Mobile audio streaming inside Obsidian's WebView is too fragile.
- **Reading view** (pure preview) has no highlight or widget — those need a CodeMirror editor. Audio still plays.
- **Tables and code blocks** are announced ("Table with N rows, skipped") rather than read. Tunable in a future release.
- **Highlight position** is accurate within typical formatting but may drift on heavily-edited or non-standard markdown.
- **Fish Audio** bills API usage from a separate wallet from your Plus/Pro subscription — fund it at fish.audio/go-api or you'll get HTTP 402 errors. Murmur surfaces this in the error message.

## Development

```bash
npm install
npm run build       # production build
npm run dev         # esbuild watch mode
```

Plugin entry: `src/main.ts`. Build output: `main.js` (committed at release tags only).

## License

MIT — see [LICENSE](LICENSE).

## Support

If Murmur has been useful and you'd like to say thanks: [buymeacoffee.com/kaurimarkkanen](https://buymeacoffee.com/kaurimarkkanen). Entirely optional, deeply appreciated.
