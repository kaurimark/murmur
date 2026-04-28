import { App, PluginSettingTab, Setting } from "obsidian";
import type MurmurPlugin from "./main";

export interface MurmurSettings {
  apiKey: string;
  voiceId: string;
  modelId: string;
  cacheSizeMB: number;
  alwaysShowWidget: boolean;
}

export const DEFAULT_SETTINGS: MurmurSettings = {
  apiKey: "",
  voiceId: "21m00Tcm4TlvDq8ikWAM",
  modelId: "eleven_flash_v2_5",
  cacheSizeMB: 500,
  alwaysShowWidget: false,
};

export class MurmurSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MurmurPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("ElevenLabs API key")
      .setDesc("Stored as plain text in your vault. Get one at elevenlabs.io.")
      .addText((text) =>
        text
          .setPlaceholder("sk_...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Voice ID")
      .setDesc("ElevenLabs voice ID. Browse voices in your ElevenLabs dashboard.")
      .addText((text) =>
        text.setValue(this.plugin.settings.voiceId).onChange(async (value) => {
          this.plugin.settings.voiceId = value.trim();
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
          .setValue(this.plugin.settings.modelId)
          .onChange(async (value) => {
            this.plugin.settings.modelId = value;
            await this.plugin.saveSettings();
          }),
      );

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
}
