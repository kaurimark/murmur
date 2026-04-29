import { App, PluginSettingTab, Setting } from "obsidian";
import type MurmurPlugin from "./main";
import { OPENAI_MODELS, OPENAI_VOICES } from "./provider/openai";

export type WidgetTheme = "inline-chip" | "tape-deck";

export type ProviderId = "elevenlabs" | "openai";

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export interface OpenAIConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export interface MurmurSettings {
  provider: ProviderId;
  elevenlabs: ElevenLabsConfig;
  openai: OpenAIConfig;
  cacheSizeMB: number;
  alwaysShowWidget: boolean;
  widgetTheme: WidgetTheme;
}

export const DEFAULT_SETTINGS: MurmurSettings = {
  provider: "elevenlabs",
  elevenlabs: {
    apiKey: "",
    voiceId: "21m00Tcm4TlvDq8ikWAM",
    modelId: "eleven_flash_v2_5",
  },
  openai: {
    apiKey: "",
    voiceId: "alloy",
    modelId: "tts-1",
  },
  cacheSizeMB: 500,
  alwaysShowWidget: false,
  widgetTheme: "inline-chip",
};

/**
 * Migrate settings from the v0.1 flat shape (apiKey/voiceId/modelId at the
 * top level, ElevenLabs assumed) to the multi-provider nested shape.
 */
export function migrateSettings(
  raw: Record<string, unknown> | null | undefined,
): Partial<MurmurSettings> {
  if (!raw || typeof raw !== "object") return {};
  const data = { ...raw } as Record<string, unknown>;

  if (
    typeof data.apiKey === "string" &&
    !("elevenlabs" in data)
  ) {
    data.elevenlabs = {
      apiKey: data.apiKey,
      voiceId:
        typeof data.voiceId === "string"
          ? data.voiceId
          : DEFAULT_SETTINGS.elevenlabs.voiceId,
      modelId:
        typeof data.modelId === "string"
          ? data.modelId
          : DEFAULT_SETTINGS.elevenlabs.modelId,
    };
    delete data.apiKey;
    delete data.voiceId;
    delete data.modelId;
  }

  return data as Partial<MurmurSettings>;
}

export function mergeWithDefaults(
  partial: Partial<MurmurSettings>,
): MurmurSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    elevenlabs: {
      ...DEFAULT_SETTINGS.elevenlabs,
      ...(partial.elevenlabs ?? {}),
    },
    openai: {
      ...DEFAULT_SETTINGS.openai,
      ...(partial.openai ?? {}),
    },
  };
}

export class MurmurSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MurmurPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("TTS provider")
      .setDesc(
        "ElevenLabs gives precise word-level karaoke highlighting but costs more. OpenAI is significantly cheaper; karaoke is approximated from audio duration.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("elevenlabs", "ElevenLabs")
          .addOption("openai", "OpenAI")
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as ProviderId;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.provider === "elevenlabs") {
      this.renderElevenLabs();
    } else {
      this.renderOpenAI();
    }

    new Setting(containerEl)
      .setName("Always show player")
      .setDesc("Keep the top-of-file player visible even when not playing.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.alwaysShowWidget)
          .onChange(async (value) => {
            this.plugin.settings.alwaysShowWidget = value;
            await this.plugin.saveSettings();
            this.plugin.refreshWidget();
          }),
      );

    new Setting(containerEl)
      .setName("Widget theme")
      .setDesc(
        "Inline chip: small pill that retreats into Obsidian's chrome. Tape-deck: taller, mechanical-feel widget with a pixel-grid timer and rolling speed wheel.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("inline-chip", "Inline chip (default)")
          .addOption("tape-deck", "Tape-deck")
          .setValue(this.plugin.settings.widgetTheme)
          .onChange(async (value) => {
            this.plugin.settings.widgetTheme = value as WidgetTheme;
            await this.plugin.saveSettings();
            this.plugin.refreshWidget();
          }),
      );

    new Setting(containerEl)
      .setName("Cache size (MB)")
      .setDesc("Maximum disk cache size. Older entries are evicted when full.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.cacheSizeMB))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (Number.isFinite(n) && n > 0) {
              this.plugin.settings.cacheSizeMB = n;
              this.plugin.cache.setMaxMB(n);
              await this.plugin.saveSettings();
            }
          }),
      );

    const size = this.plugin.cache.size();
    const sizeMB = (size.bytes / 1024 / 1024).toFixed(1);
    new Setting(containerEl)
      .setName("Cached audio")
      .setDesc(
        `${size.entries} ${size.entries === 1 ? "segment" : "segments"}, ${sizeMB} MB`,
      )
      .addButton((btn) =>
        btn.setButtonText("Clear cache").onClick(async () => {
          await this.plugin.cache.clear();
          this.display();
        }),
      );
  }

  private renderElevenLabs(): void {
    const { containerEl } = this;
    const cfg = this.plugin.settings.elevenlabs;

    new Setting(containerEl)
      .setName("ElevenLabs API key")
      .setDesc("Stored as plain text in your vault. Get one at elevenlabs.io.")
      .addText((text) =>
        text
          .setPlaceholder("sk_...")
          .setValue(cfg.apiKey)
          .onChange(async (value) => {
            cfg.apiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Voice ID")
      .setDesc("ElevenLabs voice ID. Browse voices in your ElevenLabs dashboard.")
      .addText((text) =>
        text.setValue(cfg.voiceId).onChange(async (value) => {
          cfg.voiceId = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Flash is fast and cheap. Multilingual is higher quality.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("eleven_flash_v2_5", "Flash v2.5 (fast, cheap)")
          .addOption("eleven_multilingual_v2", "Multilingual v2 (higher quality)")
          .setValue(cfg.modelId)
          .onChange(async (value) => {
            cfg.modelId = value;
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderOpenAI(): void {
    const { containerEl } = this;
    const cfg = this.plugin.settings.openai;

    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Stored as plain text in your vault. Get one at platform.openai.com.")
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(cfg.apiKey)
          .onChange(async (value) => {
            cfg.apiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Voice")
      .addDropdown((dropdown) => {
        for (const voice of OPENAI_VOICES) {
          dropdown.addOption(voice, voice);
        }
        dropdown.setValue(cfg.voiceId).onChange(async (value) => {
          cfg.voiceId = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Model")
      .addDropdown((dropdown) => {
        for (const m of OPENAI_MODELS) {
          dropdown.addOption(m.id, m.label);
        }
        dropdown.setValue(cfg.modelId).onChange(async (value) => {
          cfg.modelId = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
