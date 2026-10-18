export type Request =
  | { rid: number; type: 'loadFont'; id: string; bytes: Uint8Array; index?: number }
  | { rid: number; type: 'unloadFont'; id: string }
  | { rid: number; type: 'build'; doc: string }
  | { rid: number; type: 'exportSvg'; doc: string; opts: string }
  | { rid: number; type: 'exportFont'; spec: string }
  | { rid: number; type: 'trace'; rgba: Uint8Array; width: number; height: number; opts: string };

export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string; fatal: boolean };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type RequestBody = DistributiveOmit<Request, 'rid'>;
