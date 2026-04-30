import { App, PluginSettingTab, Setting } from "obsidian";
import type MurmurPlugin from "./main";
import { OPENAI_MODELS, OPENAI_VOICES } from "./provider/openai";
import { CARTESIA_MODELS } from "./provider/cartesia";
import { FISHAUDIO_MODELS } from "./provider/fishaudio";
import { INWORLD_MODELS, INWORLD_VOICES } from "./provider/inworld";

export type WidgetTheme = "inline-chip" | "tape-deck";

export type WidgetPlacement = "inline" | "floating";

export type ProviderId =
  | "elevenlabs"
  | "inworld"
  | "openai"
  | "cartesia"
  | "fishaudio";

export interface ProviderConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export type ElevenLabsConfig = ProviderConfig;
export type OpenAIConfig = ProviderConfig;
export type CartesiaConfig = ProviderConfig;
export type FishAudioConfig = ProviderConfig;
export type InworldConfig = ProviderConfig;

export interface FloatingPosition {
  x: number;
  y: number;
}

export interface MurmurSettings {
  provider: ProviderId;
  elevenlabs: ElevenLabsConfig;
  inworld: InworldConfig;
  openai: OpenAIConfig;
  cartesia: CartesiaConfig;
  fishaudio: FishAudioConfig;
  cacheSizeMB: number;
  alwaysShowWidget: boolean;
  widgetTheme: WidgetTheme;
  widgetPlacement: WidgetPlacement;
  floatingPosition: FloatingPosition;
}

export const DEFAULT_SETTINGS: MurmurSettings = {
  provider: "elevenlabs",
  elevenlabs: {
    apiKey: "",
    voiceId: "21m00Tcm4TlvDq8ikWAM",
    modelId: "eleven_flash_v2_5",
  },
  inworld: {
    apiKey: "",
    voiceId: "Ashley",
    modelId: "inworld-tts-1.5-max",
  },
  openai: {
    apiKey: "",
    voiceId: "alloy",
    modelId: "tts-1",
  },
  cartesia: {
    apiKey: "",
    voiceId: "",
    modelId: "sonic-3",
  },
  fishaudio: {
    apiKey: "",
    voiceId: "",
    modelId: "s2-pro",
  },
  cacheSizeMB: 500,
  alwaysShowWidget: false,
  // Tape-deck is the better default — characterful, larger, more usable. Users
  // who want minimal can switch back to inline-chip in settings.
  widgetTheme: "tape-deck",
  widgetPlacement: "inline",
  floatingPosition: { x: 24, y: 24 },
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
    inworld: {
      ...DEFAULT_SETTINGS.inworld,
      ...(partial.inworld ?? {}),
    },
    openai: {
      ...DEFAULT_SETTINGS.openai,
      ...(partial.openai ?? {}),
    },
    cartesia: {
      ...DEFAULT_SETTINGS.cartesia,
      ...(partial.cartesia ?? {}),
    },
    fishaudio: {
      ...DEFAULT_SETTINGS.fishaudio,
      ...(partial.fishaudio ?? {}),
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
        "Inworld TTS 1.5 Max currently tops the Artificial Analysis Speech Arena at OpenAI-level pricing (~$35/1M chars). ElevenLabs gives precise word-level karaoke highlighting but costs ~10× more. Fish Audio and Cartesia are quality alternatives. OpenAI is the cheapest. Karaoke is approximated from audio duration on every provider except ElevenLabs.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("elevenlabs", "ElevenLabs")
          .addOption("inworld", "Inworld")
          .addOption("fishaudio", "Fish Audio")
          .addOption("cartesia", "Cartesia")
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
    } else if (this.plugin.settings.provider === "inworld") {
      this.renderInworld();
    } else if (this.plugin.settings.provider === "cartesia") {
      this.renderCartesia();
    } else if (this.plugin.settings.provider === "fishaudio") {
      this.renderFishAudio();
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
          .addOption("tape-deck", "Tape-deck (default)")
          .addOption("inline-chip", "Inline chip")
          .setValue(this.plugin.settings.widgetTheme)
          .onChange(async (value) => {
            this.plugin.settings.widgetTheme = value as WidgetTheme;
            await this.plugin.saveSettings();
            this.plugin.refreshWidget();
          }),
      );

    new Setting(containerEl)
      .setName("Widget placement")
      .setDesc(
        "Inline: at the top of each note (scrolls with the page). Floating: a draggable pane that stays visible everywhere — useful for long notes where the inline widget would scroll out of view.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("inline", "Inline (at the top of the note)")
          .addOption("floating", "Floating (draggable, always visible)")
          .setValue(this.plugin.settings.widgetPlacement)
          .onChange(async (value) => {
            this.plugin.settings.widgetPlacement = value as WidgetPlacement;
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

    // Affiliate disclosure: the link below is a referral link. Plain text
    // marker `(referral)` is shown to users at the point of click. See the
    // README's "Affiliate disclosure" section for the full disclosure.
    const apiKeyDesc = document.createDocumentFragment();
    apiKeyDesc.append("Stored as plain text in your vault. Get one at ");
    const apiKeyLink = apiKeyDesc.appendChild(document.createElement("a"));
    apiKeyLink.href = "https://try.elevenlabs.io/0dwmkurqlz4a";
    apiKeyLink.textContent = "elevenlabs.io";
    apiKeyLink.target = "_blank";
    apiKeyLink.rel = "noopener noreferrer";
    apiKeyDesc.append(" (referral).");

    new Setting(containerEl)
      .setName("ElevenLabs API key")
      .setDesc(apiKeyDesc)
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

    this.renderPreviewButton();
  }

  private renderOpenAI(): void {
    const { containerEl } = this;
    const cfg = this.plugin.settings.openai;

    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Stored as plain text in your vault. Get one at platform.OpenAI.com.")
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

    this.renderPreviewButton();
  }

  private renderCartesia(): void {
    const { containerEl } = this;
    const cfg = this.plugin.settings.cartesia;

    new Setting(containerEl)
      .setName("Cartesia API key")
      .setDesc("Stored as plain text in your vault. Get one at Cartesia.ai.")
      .addText((text) =>
        text
          .setPlaceholder("sk_car_...")
          .setValue(cfg.apiKey)
          .onChange(async (value) => {
            cfg.apiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Voice ID")
      .setDesc(
        "Cartesia voice ID (UUID). Browse the voice library at cartesia.ai and copy the ID.",
      )
      .addText((text) =>
        text.setValue(cfg.voiceId).onChange(async (value) => {
          cfg.voiceId = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Model")
      .addDropdown((dropdown) => {
        for (const m of CARTESIA_MODELS) {
          dropdown.addOption(m.id, m.label);
        }
        dropdown.setValue(cfg.modelId).onChange(async (value) => {
          cfg.modelId = value;
          await this.plugin.saveSettings();
        });
      });

    this.renderPreviewButton();
  }

  private renderFishAudio(): void {
    const { containerEl } = this;
    const cfg = this.plugin.settings.fishaudio;

    new Setting(containerEl)
      .setName("Fish Audio API key")
      .setDesc(
        "Stored as plain text in your vault. Get one at Fish Audio. Important: API usage is billed pay-as-you-go from a separate wallet — your subscription credits cover the web UI only. Fund the API wallet via Fish Audio's pricing page or you'll get HTTP 402 errors.",
      )
      .addText((text) =>
        text
          .setPlaceholder("...")
          .setValue(cfg.apiKey)
          .onChange(async (value) => {
            cfg.apiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Voice (reference) ID")
      .setDesc(
        "The hex ID of the voice you want to use. Find it at fish.audio: open a voice in the library — the URL looks like fish.audio/m/<id>. Copy the part after /m/ (~32 hex characters).",
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. 802e3bc2b27e49c2995d23ef70e6ac89")
          .setValue(cfg.voiceId)
          .onChange(async (value) => {
            cfg.voiceId = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("S2 Pro is Fish Audio's current state of the art. S1 is legacy.")
      .addDropdown((dropdown) => {
        for (const m of FISHAUDIO_MODELS) {
          dropdown.addOption(m.id, m.label);
        }
        dropdown.setValue(cfg.modelId).onChange(async (value) => {
          cfg.modelId = value;
          await this.plugin.saveSettings();
        });
      });

    this.renderPreviewButton();
  }

  private renderInworld(): void {
    const { containerEl } = this;
    const cfg = this.plugin.settings.inworld;

    new Setting(containerEl)
      .setName("Inworld API key")
      .setDesc(
        "Stored as plain text in your vault. Get one at platform.Inworld.ai. The on-demand plan includes ~40 free TTS minutes/month — enough to evaluate.",
      )
      .addText((text) =>
        text
          .setPlaceholder("...")
          .setValue(cfg.apiKey)
          .onChange(async (value) => {
            cfg.apiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Voice")
      .setDesc("One of Inworld's 22 stock voices.")
      .addDropdown((dropdown) => {
        for (const voice of INWORLD_VOICES) {
          dropdown.addOption(voice, voice);
        }
        dropdown.setValue(cfg.voiceId).onChange(async (value) => {
          cfg.voiceId = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc(
        "TTS 1.5 Max is the flagship; 1.5 Mini trades a bit of quality for ~30% lower cost and faster response.",
      )
      .addDropdown((dropdown) => {
        for (const m of INWORLD_MODELS) {
          dropdown.addOption(m.id, m.label);
        }
        dropdown.setValue(cfg.modelId).onChange(async (value) => {
          cfg.modelId = value;
          await this.plugin.saveSettings();
        });
      });

    this.renderPreviewButton();
  }

  private renderPreviewButton(): void {
    new Setting(this.containerEl)
      .setName("Preview voice")
      .setDesc(
        "Play a short sample with the current voice and model. Useful for tasting voices before committing.",
      )
      .addButton((btn) =>
        btn
          .setButtonText("Preview")
          .onClick(async () => {
            btn.setDisabled(true);
            const original = "Preview";
            btn.setButtonText("Loading…");
            try {
              await this.plugin.previewVoice();
            } finally {
              btn.setDisabled(false);
              btn.setButtonText(original);
            }
          }),
      );
  }
}
