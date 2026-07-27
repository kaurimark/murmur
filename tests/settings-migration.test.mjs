import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

let tempDir;
let settings;

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "murmur-settings-test-"));
  const outfile = path.join(tempDir, "settings.mjs");

  await build({
    entryPoints: ["src/settings.ts"],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    plugins: [
      {
        name: "obsidian-stub",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
            path: "obsidian",
            namespace: "obsidian-stub",
          }));
          buildApi.onLoad(
            { filter: /.*/, namespace: "obsidian-stub" },
            () => ({
              contents: `
                export class PluginSettingTab {}
                export class SecretComponent {}
                export class Setting {}
                export const requestUrl = async () => { throw new Error("not used"); };
              `,
              loader: "js",
            }),
          );
        },
      },
    ],
  });

  settings = await import(pathToFileURL(outfile).href);
});

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("migrates a flat ElevenLabs key without retaining plaintext", () => {
  const raw = {
    apiKey: "  legacy-eleven-key  ",
    voiceId: "legacy-voice",
    modelId: "legacy-model",
  };

  assert.deepEqual(settings.extractLegacyApiKeys(raw), {
    elevenlabs: "legacy-eleven-key",
  });

  const migrated = settings.migrateSettings(raw);
  assert.equal("apiKey" in migrated, false);
  assert.equal("voiceId" in migrated, false);
  assert.equal("modelId" in migrated, false);
  assert.deepEqual(migrated.elevenlabs, {
    apiKeySecretId: "",
    voiceId: "legacy-voice",
    modelId: "legacy-model",
  });
});

test("extracts nested provider keys and scrubs every plaintext value", () => {
  const raw = {
    elevenlabs: {
      apiKey: "eleven-key",
      voiceId: "eleven-voice",
      modelId: "eleven-model",
    },
    openai: {
      apiKey: "openai-key",
      apiKeySecretId: "shared-openai",
      voiceId: "alloy",
      modelId: "tts-1",
    },
  };

  assert.deepEqual(settings.extractLegacyApiKeys(raw), {
    elevenlabs: "eleven-key",
    openai: "openai-key",
  });

  const migrated = settings.migrateSettings(raw);
  assert.equal("apiKey" in migrated.elevenlabs, false);
  assert.equal("apiKey" in migrated.openai, false);
  assert.equal(migrated.openai.apiKeySecretId, "shared-openai");
});

test("preserves a valid existing secret reference during migration", () => {
  const raw = {
    openai: {
      apiKey: "legacy-openai-key",
      apiKeySecretId: "shared-openai",
      voiceId: "alloy",
      modelId: "tts-1",
    },
  };
  const values = new Map([["shared-openai", "current-openai-key"]]);
  const secretStore = {
    getSecret: (id) => values.get(id) ?? null,
    setSecret: (id, value) => values.set(id, value),
  };
  const merged = settings.mergeWithDefaults(settings.migrateSettings(raw));

  settings.importLegacyApiKeys(
    merged,
    secretStore,
    settings.extractLegacyApiKeys(raw),
  );

  assert.equal(merged.openai.apiKeySecretId, "shared-openai");
  assert.equal(values.get("shared-openai"), "current-openai-key");
});

test("repairs a stale secret reference without overwriting another secret", () => {
  const raw = {
    openai: {
      apiKey: "legacy-openai-key",
      apiKeySecretId: "deleted-secret",
      voiceId: "alloy",
      modelId: "tts-1",
    },
  };
  const values = new Map([
    ["murmur-openai-api-key", "unrelated-key"],
    ["murmur-openai-api-key-2", "legacy-openai-key"],
  ]);
  const secretStore = {
    getSecret: (id) => values.get(id) ?? null,
    setSecret: (id, value) => values.set(id, value),
  };
  const merged = settings.mergeWithDefaults(settings.migrateSettings(raw));

  settings.importLegacyApiKeys(
    merged,
    secretStore,
    settings.extractLegacyApiKeys(raw),
  );

  assert.equal(merged.openai.apiKeySecretId, "murmur-openai-api-key-2");
  assert.equal(values.get("murmur-openai-api-key"), "unrelated-key");
});

test("does not scrub the usable reference when secret storage rejects a write", () => {
  const raw = {
    openai: {
      apiKey: "legacy-openai-key",
      apiKeySecretId: "deleted-secret",
      voiceId: "alloy",
      modelId: "tts-1",
    },
  };
  const merged = settings.mergeWithDefaults(settings.migrateSettings(raw));
  const secretStore = {
    getSecret: () => null,
    setSecret: () => {
      throw new Error("secret storage unavailable");
    },
  };

  assert.throws(
    () =>
      settings.importLegacyApiKeys(
        merged,
        secretStore,
        settings.extractLegacyApiKeys(raw),
      ),
    /secret storage unavailable/,
  );
  assert.equal(merged.openai.apiKeySecretId, "deleted-secret");
});

test("merges migrated settings with secure defaults", () => {
  const merged = settings.mergeWithDefaults({
    provider: "openai",
    openai: {
      apiKeySecretId: "openai-production",
      voiceId: "nova",
      modelId: "tts-1-hd",
    },
  });

  assert.equal(merged.provider, "openai");
  assert.equal(merged.openai.apiKeySecretId, "openai-production");
  assert.equal(merged.elevenlabs.apiKeySecretId, "");
  assert.equal(merged.cacheSizeMB, 500);
});
