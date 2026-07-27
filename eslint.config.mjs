import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";

export default [
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Declarative settings are an optional Obsidian 1.13+ API that is still
      // limited to insider builds. Murmur keeps its 1.11-compatible imperative
      // tab until 1.13 becomes the stable minimum.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      // Sentence case rule needs to know our domain-specific proper nouns
      // and acronyms. Without this, brand names like "ElevenLabs" get flagged
      // as needing lowercase ("Elevenlabs"), which would actively misrepresent
      // the brand. Same for unit/protocol acronyms like "MB", "TTS".
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          brands: [
            ...DEFAULT_BRANDS,
            // TTS providers integrated by this plugin
            "ElevenLabs",
            "Inworld",
            "Cartesia",
            "Fish Audio",
            // Model identifiers — these are product names from the providers
            "S2 Pro",
            "Sonic",
            "Flash",
            // The plugin's own name
            "Murmur",
          ],
          acronyms: [
            ...DEFAULT_ACRONYMS,
            "TTS", // Text-to-speech — central to this plugin
            "MB",  // Megabyte — used in cache size setting
          ],
          ignoreRegex: [
            // Hex/UUID example value in a Fish Audio voice-ID placeholder.
            "^e\\.g\\. [a-f0-9]+$",
          ],
        },
      ],
    },
  },
];
