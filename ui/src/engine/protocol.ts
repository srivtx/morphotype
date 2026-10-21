export type Request =
  | { rid: number; type: 'loadFont'; id: string; bytes: Uint8Array; index?: number }
  | { rid: number; type: 'unloadFont'; id: string }
  | { rid: number; type: 'build'; doc: string }
  | { rid: number; type: 'exportSvg'; doc: string; opts: string }
  | { rid: number; type: 'exportPaths'; doc: string }
  | { rid: number; type: 'bake'; doc: string; id: string }
  | { rid: number; type: 'split'; doc: string; id: string }
  | { rid: number; type: 'textLayout'; content: string }
  | { rid: number; type: 'glyphPath'; font: string; axes: string; ch: string }
  | { rid: number; type: 'fontPreview'; spec: string; chars: string }
  | { rid: number; type: 'exportFont'; spec: string }
  | { rid: number; type: 'kerningTable'; spec: string }
  | { rid: number; type: 'trace'; rgba: Uint8Array; width: number; height: number; opts: string };

export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string; fatal: boolean };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type RequestBody = DistributiveOmit<Request, 'rid'>;
