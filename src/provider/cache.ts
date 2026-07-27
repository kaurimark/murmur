import { App, normalizePath } from "obsidian";
import type {
  CharAlignment,
  TTSGenerateOptions,
  TTSProvider,
  TTSResult,
} from "./types";

interface IndexEntry {
  bytes: number;
  lastUsed: number;
}

interface IndexFile {
  totalBytes: number;
  entries: Record<string, IndexEntry>;
}

function isIndexFile(value: unknown): value is IndexFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.totalBytes !== "number") return false;
  if (!candidate.entries || typeof candidate.entries !== "object") return false;

  return Object.values(candidate.entries).every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return typeof item.bytes === "number" && typeof item.lastUsed === "number";
  });
}

export class AudioCache {
  private cacheDir: string;
  private indexPath: string;
  private index: IndexFile = { totalBytes: 0, entries: {} };
  private maxBytes: number;

  constructor(
    private app: App,
    manifestDir: string,
    maxMB: number,
  ) {
    this.cacheDir = normalizePath(`${manifestDir}/cache`);
    this.indexPath = normalizePath(`${this.cacheDir}/index.json`);
    this.maxBytes = maxMB * 1024 * 1024;
  }

  setMaxMB(mb: number): void {
    this.maxBytes = mb * 1024 * 1024;
  }

  async init(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.cacheDir))) {
      await adapter.mkdir(this.cacheDir);
    }
    if (await adapter.exists(this.indexPath)) {
      try {
        const text = await adapter.read(this.indexPath);
        const parsed: unknown = JSON.parse(text);
        if (!isIndexFile(parsed)) throw new Error("Invalid cache index");
        this.index = parsed;
      } catch {
        this.index = { totalBytes: 0, entries: {} };
      }
    }
  }

  async get(
    hash: string,
  ): Promise<{ audio: ArrayBuffer; alignment?: CharAlignment } | null> {
    const entry = this.index.entries[hash];
    if (!entry) return null;

    const adapter = this.app.vault.adapter;
    const audioPath = normalizePath(`${this.cacheDir}/${hash}.mp3`);
    const alignPath = normalizePath(`${this.cacheDir}/${hash}.json`);

    if (!(await adapter.exists(audioPath))) {
      delete this.index.entries[hash];
      this.index.totalBytes = Math.max(0, this.index.totalBytes - entry.bytes);
      await this.saveIndex();
      return null;
    }

    const audio = await adapter.readBinary(audioPath);
    let alignment: CharAlignment | undefined;
    if (await adapter.exists(alignPath)) {
      try {
        const alignmentJson = await adapter.read(alignPath);
        alignment = JSON.parse(alignmentJson) as CharAlignment;
      } catch {
        // Corrupt alignment file — proceed without it; player will synthesize.
      }
    }

    entry.lastUsed = Date.now();
    await this.saveIndex();

    return { audio, alignment };
  }

  async set(
    hash: string,
    audio: ArrayBuffer,
    alignment: CharAlignment | undefined,
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    const audioPath = normalizePath(`${this.cacheDir}/${hash}.mp3`);
    const alignPath = normalizePath(`${this.cacheDir}/${hash}.json`);

    await adapter.writeBinary(audioPath, audio);
    let totalBytes = audio.byteLength;
    if (alignment) {
      const alignmentJson = JSON.stringify(alignment);
      totalBytes += alignmentJson.length;
      await adapter.write(alignPath, alignmentJson);
    }

    const prev = this.index.entries[hash];
    if (prev) this.index.totalBytes -= prev.bytes;

    this.index.entries[hash] = { bytes: totalBytes, lastUsed: Date.now() };
    this.index.totalBytes += totalBytes;

    await this.evictIfNeeded();
    await this.saveIndex();
  }

  async clear(): Promise<void> {
    const adapter = this.app.vault.adapter;
    for (const hash of Object.keys(this.index.entries)) {
      try {
        await adapter.remove(normalizePath(`${this.cacheDir}/${hash}.mp3`));
      } catch {
        // File already missing or unreadable — proceed with index cleanup.
      }
      try {
        await adapter.remove(normalizePath(`${this.cacheDir}/${hash}.json`));
      } catch {
        // Alignment file is optional; missing is fine.
      }
    }
    this.index = { totalBytes: 0, entries: {} };
    await this.saveIndex();
  }

  size(): { bytes: number; entries: number } {
    return {
      bytes: this.index.totalBytes,
      entries: Object.keys(this.index.entries).length,
    };
  }

  private async evictIfNeeded(): Promise<void> {
    if (this.index.totalBytes <= this.maxBytes) return;
    const adapter = this.app.vault.adapter;
    const sorted = Object.entries(this.index.entries).sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed,
    );
    for (const [hash, entry] of sorted) {
      if (this.index.totalBytes <= this.maxBytes) break;
      try {
        await adapter.remove(normalizePath(`${this.cacheDir}/${hash}.mp3`));
      } catch {
        // File already missing or unreadable — proceed with index cleanup.
      }
      try {
        await adapter.remove(normalizePath(`${this.cacheDir}/${hash}.json`));
      } catch {
        // Alignment file is optional; missing is fine.
      }
      delete this.index.entries[hash];
      this.index.totalBytes = Math.max(0, this.index.totalBytes - entry.bytes);
    }
  }

  private async saveIndex(): Promise<void> {
    await this.app.vault.adapter.write(
      this.indexPath,
      JSON.stringify(this.index),
    );
  }
}

export class CachedTTSProvider implements TTSProvider {
  constructor(
    private base: TTSProvider,
    private cache: AudioCache,
    private providerId: string,
  ) {}

  async generate(opts: TTSGenerateOptions): Promise<TTSResult> {
    const hash = await hashKey(
      this.providerId,
      opts.text,
      opts.voiceId,
      opts.modelId,
    );
    const hit = await this.cache.get(hash);
    if (hit) return hit;

    const result = await this.base.generate(opts);
    await this.cache.set(hash, result.audio, result.alignment);
    return result;
  }
}

async function hashKey(
  providerId: string,
  text: string,
  voiceId: string,
  modelId: string,
): Promise<string> {
  const data = `${providerId}|${voiceId}|${modelId}|${text}`;
  const buf = new TextEncoder().encode(data);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
