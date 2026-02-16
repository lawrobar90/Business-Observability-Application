/**
 * Vector Store — lightweight cosine‑similarity search over embeddings.
 * Uses Ollama embeddings API (nomic-embed-text or model‑based).
 * Falls back to a simple TF‑IDF bag‑of‑words when embeddings unavailable.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('librarian');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Types ────────────────────────────────────────────────────

export interface VectorEntry {
  id: string;
  text: string;
  vector: number[];
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface SearchResult {
  entry: VectorEntry;
  score: number;
}

// ─── Embedding ────────────────────────────────────────────────

const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

async function getEmbedding(text: string): Promise<number[]> {
  try {
    const res = await fetch(`${config.ollama.endpoint}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) throw new Error(`Embed ${res.status}`);
    const data = await res.json() as { embedding?: number[] };
    if (data.embedding?.length) return data.embedding;
    throw new Error('No embedding returned');
  } catch {
    // Fallback: deterministic bag‑of‑words hash vector
    return bowVector(text);
  }
}

/** Bag‑of‑words fallback: 128‑dim vector from word frequencies */
function bowVector(text: string): number[] {
  const DIM = 128;
  const vec = new Float64Array(DIM);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  for (const w of words) {
    let h = 0;
    for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) & 0x7fff_ffff;
    vec[h % DIM] += 1;
  }
  // Normalise
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return Array.from(vec.map(v => v / mag));
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

// ─── Store ────────────────────────────────────────────────────

export class VectorStore {
  private entries: VectorEntry[] = [];
  private filePath: string;

  constructor(storeName = 'default') {
    const dir = path.resolve(__dirname, 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, `${storeName}.json`);
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.entries = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        log.info(`Vector store loaded: ${this.entries.length} entries`, { file: this.filePath });
      }
    } catch (err) {
      log.warn('Failed to load vector store, starting fresh', { error: String(err) });
      this.entries = [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
  }

  async add(id: string, text: string, metadata: Record<string, unknown> = {}): Promise<void> {
    // Deduplicate by id
    this.entries = this.entries.filter(e => e.id !== id);

    const vector = await getEmbedding(text);
    this.entries.push({
      id,
      text,
      vector,
      metadata,
      timestamp: new Date().toISOString(),
    });
    this.save();
    log.debug('Vector entry added', { id, textLen: text.length });
  }

  async search(query: string, topK = 5): Promise<SearchResult[]> {
    if (this.entries.length === 0) return [];

    const qVec = await getEmbedding(query);
    const scored = this.entries.map(entry => ({
      entry,
      score: cosine(qVec, entry.vector),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  getAll(): VectorEntry[] {
    return [...this.entries];
  }

  getById(id: string): VectorEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  delete(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => e.id !== id);
    if (this.entries.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  get size(): number {
    return this.entries.length;
  }
}

export default VectorStore;
