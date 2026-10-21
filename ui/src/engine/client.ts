import type { Request, RequestBody, Response } from './protocol';
import type { BakeOut, BuildOut, Content, EngineDocument, FontInfo, FontSpec, GlyphOut, GlyphPreview, PairKerning, PathsOut, PieceOut, SvgOptions, TextLayout, TraceOptions, TraceOut } from './types';

export type BuildResult = BuildOut & { ms: number };

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  body: RequestBody;
}

/**
 * Promise-based handle on the engine worker.
 *
 * - Builds are "latest wins": while one build runs, only the newest requested
 *   document is kept, so dragging a slider never queues stale work.
 * - If the WebAssembly module traps, the worker is restarted and every font
 *   is reloaded before the failed request is retried once.
 */
export class EngineClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private fonts = new Map<string, { bytes: Uint8Array; index: number }>();
  private building = false;
  private queued: { doc: string; waiters: ((r: BuildResult | Error) => void)[] } | null = null;
  private lastDoc = '';
  private lastResult: BuildResult | null = null;
  private restarting: Promise<void> | null = null;

  // The worker starts on first use, so importing this module is side-effect free.

  private spawn() {
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<Response>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => {
      ev.preventDefault();
      void this.restart(new Error(ev.message || 'The engine stopped unexpectedly.'));
    };
  }

  private onMessage(msg: Response) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) {
      p.resolve(msg.value);
    } else if (msg.fatal) {
      // Retry once on a fresh engine.
      void this.restart(new Error(msg.error)).then(() => this.post(p.body).then(p.resolve, p.reject));
    } else {
      p.reject(new Error(msg.error));
    }
  }

  private restart(reason: Error): Promise<void> {
    if (this.restarting) return this.restarting;
    console.warn('Restarting engine:', reason.message);
    this.restarting = (async () => {
      this.worker?.terminate();
      const stranded = [...this.pending.values()];
      this.pending.clear();
      this.spawn();
      for (const [id, f] of this.fonts) {
        await this.post({ type: 'loadFont', id, bytes: f.bytes.slice(), index: f.index });
      }
      for (const p of stranded) this.post(p.body).then(p.resolve, p.reject);
      this.lastDoc = '';
    })().finally(() => {
      this.restarting = null;
    });
    return this.restarting;
  }

  private post<T>(body: RequestBody, transfer: Transferable[] = []): Promise<T> {
    const rid = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(rid, { resolve: resolve as (v: unknown) => void, reject, body });
      if (!this.worker) this.spawn();
      this.worker!.postMessage({ ...body, rid } as Request, transfer);
    });
  }

  async loadFont(id: string, bytes: Uint8Array, index = 0): Promise<FontInfo> {
    const info = await this.post<FontInfo>({ type: 'loadFont', id, bytes: bytes.slice(), index });
    this.fonts.set(id, { bytes, index });
    this.lastDoc = '';
    return info;
  }

  async unloadFont(id: string): Promise<void> {
    this.fonts.delete(id);
    this.lastDoc = '';
    await this.post({ type: 'unloadFont', id });
  }

  fontBytes(id: string): Uint8Array | undefined {
    return this.fonts.get(id)?.bytes;
  }

  /** Build a document; resolves with the result for this or a newer document. */
  build(doc: EngineDocument): Promise<BuildResult> {
    const json = JSON.stringify(doc);
    if (json === this.lastDoc && this.lastResult && !this.building) {
      return Promise.resolve(this.lastResult);
    }
    return new Promise((resolve, reject) => {
      const waiter = (r: BuildResult | Error) => (r instanceof Error ? reject(r) : resolve(r));
      if (this.building) {
        const waiters = this.queued?.waiters ?? [];
        waiters.push(waiter);
        this.queued = { doc: json, waiters };
        return;
      }
      this.run(json, [waiter]);
    });
  }

  /** Build exactly this document, outside the latest-wins queue (previews, exports). */
  buildExact(doc: EngineDocument): Promise<BuildResult> {
    return this.post<BuildResult>({ type: 'build', doc: JSON.stringify(doc) });
  }

  private run(doc: string, waiters: ((r: BuildResult | Error) => void)[]) {
    this.building = true;
    this.post<BuildResult>({ type: 'build', doc })
      .then(
        (r) => {
          this.lastDoc = doc;
          this.lastResult = r;
          // Older callers get the newest result once the queue drains.
          if (!this.queued) waiters.forEach((w) => w(r));
          else this.queued.waiters.push(...waiters);
        },
        (e: Error) => waiters.forEach((w) => w(e)),
      )
      .finally(() => {
        this.building = false;
        const q = this.queued;
        this.queued = null;
        if (q) this.run(q.doc, q.waiters);
      });
  }

  exportSvg(doc: EngineDocument, opts: SvgOptions = {}): Promise<string> {
    return this.post({ type: 'exportSvg', doc: JSON.stringify(doc), opts: JSON.stringify(opts) });
  }

  exportPaths(doc: EngineDocument): Promise<PathsOut> {
    return this.post({ type: 'exportPaths', doc: JSON.stringify(doc) });
  }

  bake(doc: EngineDocument, id: string): Promise<BakeOut> {
    return this.post({ type: 'bake', doc: JSON.stringify(doc), id });
  }

  split(doc: EngineDocument, id: string): Promise<PieceOut[]> {
    return this.post({ type: 'split', doc: JSON.stringify(doc), id });
  }

  /** Caret positions of a text content, for on-canvas editing. */
  textLayout(content: Content): Promise<TextLayout> {
    return this.post({ type: 'textLayout', content: JSON.stringify(content) });
  }

  glyphPath(font: string, axes: Record<string, number>, ch: string): Promise<GlyphOut> {
    return this.post({ type: 'glyphPath', font, axes: JSON.stringify(axes), ch });
  }

  fontPreview(spec: FontSpec, chars: string): Promise<GlyphPreview[]> {
    return this.post({ type: 'fontPreview', spec: JSON.stringify(spec), chars });
  }

  /** Whether a font id is loaded in the engine. */
  hasFont(id: string): boolean {
    return this.fonts.has(id);
  }

  /** Kerning of character pairs ("AV") of a font spec. */
  kerningPairs(spec: FontSpec, pairs: string[]): Promise<PairKerning[]> {
    return this.post({ type: 'kerningPairs', spec: JSON.stringify(spec), pairs: JSON.stringify(pairs) });
  }

  exportFont(spec: FontSpec): Promise<Uint8Array> {
    return this.post({ type: 'exportFont', spec: JSON.stringify(spec) });
  }

  trace(rgba: Uint8Array, width: number, height: number, opts: TraceOptions): Promise<TraceOut> {
    const copy = rgba.slice();
    return this.post({ type: 'trace', rgba: copy, width, height, opts: JSON.stringify(opts) }, [copy.buffer]);
  }
}

export const engine = new EngineClient();
