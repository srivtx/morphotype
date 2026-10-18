// Platform layer: the same UI runs in a browser and inside the Tauri shell.
// Desktop builds get native dialogs, direct file writes and system fonts.

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

export interface SystemFont {
  family: string;
  style: string;
  path: string;
  index: number;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Platform {
  kind: 'web' | 'desktop';
  isMac: boolean;
  open(filters: FileFilter[], multiple?: boolean): Promise<PickedFile[]>;
  save(suggestedName: string, data: Uint8Array | string, filter: FileFilter): Promise<boolean>;
  listSystemFonts?(): Promise<SystemFont[]>;
  readSystemFont?(path: string): Promise<Uint8Array>;
  /** Copy a font into the user's font folder; returns where it went. */
  installFont?(fileName: string, bytes: Uint8Array): Promise<string>;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const web: Platform = {
  kind: 'web',
  isMac,
  open(filters, multiple = false) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = multiple;
      input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
      input.onchange = async () => {
        const files = Array.from(input.files ?? []);
        resolve(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      };
      input.oncancel = () => resolve([]);
      input.click();
    });
  },
  async save(name, data, filter) {
    const type = filter.extensions[0] === 'svg' ? 'image/svg+xml' : filter.extensions[0] === 'png' ? 'image/png' : 'application/octet-stream';
    const blob = new Blob([data as BlobPart], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  },
};

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function desktop(): Promise<Platform> {
  const [{ open, save }, fs, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/core'),
  ]);
  const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
  return {
    kind: 'desktop',
    isMac,
    async open(filters, multiple = false) {
      const picked = await open({ multiple, filters });
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      return Promise.all(paths.map(async (p) => ({ name: basename(p), bytes: await fs.readFile(p) })));
    },
    async save(name, data, filter) {
      const path = await save({ defaultPath: name, filters: [filter] });
      if (!path) return false;
      if (typeof data === 'string') await fs.writeTextFile(path, data);
      else await fs.writeFile(path, data);
      return true;
    },
    listSystemFonts: () => invoke<SystemFont[]>('list_system_fonts'),
    async readSystemFont(path) {
      const buf = await invoke<ArrayBuffer>('read_font_file', { path });
      return new Uint8Array(buf);
    },
    installFont: (fileName, bytes) => invoke<string>('install_font', bytes, { headers: { 'x-file-name': encodeURIComponent(fileName) } }),
  };
}

export const platformReady: Promise<Platform> = inTauri() ? desktop().catch(() => web) : Promise.resolve(web);

let current: Platform = web;
void platformReady.then((p) => (current = p));

export function platform(): Platform {
  return current;
}
