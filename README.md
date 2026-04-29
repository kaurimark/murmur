# Murmur

A read-aloud plugin for Obsidian. Sends your note text to [ElevenLabs](https://elevenlabs.io) for high-quality text-to-speech with karaoke-style highlighting that follows the spoken word in your editor.

Built because Speechify mangles markdown — tables, code, lists, callouts — and runs paragraphs together with no pauses. Murmur understands Obsidian's markdown shape and renders it for the ear.

## Features

- Read whole note or just selected text
- Karaoke-style highlight tracking the spoken word in source mode and Live Preview
- Top-of-file player with play/pause, segment skip, stop, and 0.75×–2× speed
- Disk cache so re-reading a note is instant and free
- Pauses around headings, between paragraphs, between list items
- Strips Obsidian-specific syntax (wikilinks, embeds, callouts, highlights, comments, task checkboxes) so it sounds like prose, not code

## Install

### Manual install (until on community plugins)

1. Clone this repo into your vault: `<vault>/.obsidian/plugins/murmur/`
2. `npm install && npm run build`
3. In Obsidian: Settings → Community plugins → Reload, then enable "Murmur"

## Setup

1. Get an API key from [elevenlabs.io](https://elevenlabs.io). The Starter plan ($5/mo) is plenty for personal use.
2. In Obsidian, open Settings → Murmur and paste the key.
3. Pick a voice ID. Default is Rachel (`21m00Tcm4TlvDq8ikWAM`). Browse [elevenlabs.io/app/voice-library](https://elevenlabs.io/app/voice-library), click "Add to my voices", copy the ID, paste it.
4. Pick a model. **Flash v2.5** is fast and cheap (~$0.05 per 1K characters). **Multilingual v2** is higher quality (~$0.10 per 1K characters).
5. Optional: set a max cache size (default 500 MB) and toggle "Always show player".

## Use

- Click the audio-lines icon in the ribbon, or
- Run "Read note (or selection)" from the command palette (`Cmd+P`), or
- Assign a hotkey to that command in Settings → Hotkeys

If text is selected, it reads the selection. Otherwise it reads the whole note.

The widget appears at the top of the file (after frontmatter, if any) with playback controls.

## Privacy

Murmur sends your note text — or just the selected portion — to ElevenLabs over HTTPS in order to generate audio. **Your API key is stored as plain text** in `<vault>/.obsidian/plugins/murmur/data.json`. If your vault is shared or synced, treat that file as sensitive.

No analytics, no other network calls. The only outbound traffic is to `api.elevenlabs.io`.

## Limitations

- **Desktop only** for now (`isDesktopOnly: true`). Mobile audio streaming inside Obsidian's WebView is too fragile.
- **Reading view** (pure preview) has no highlight or widget — those need a CodeMirror editor. Audio still plays.
- **Tables and code blocks** are announced ("Table with N rows, skipped") rather than read. Tunable in a future release.
- **Highlight position** is accurate within typical formatting but may drift on heavily-edited or non-standard markdown.

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
