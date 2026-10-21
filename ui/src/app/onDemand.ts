// Parts of the UI whose code loads on first use, so the first paint doesn't
// wait for them. Once loaded (or preloaded) a part renders straight away,
// without the extra round trip React.lazy takes.
import { createElement, useEffect, useState, type ComponentType, type ReactElement } from 'react';
import { toast } from '../state/store';

export interface OnDemand<P> {
  (props: P): ReactElement | null;
  /** Start loading now; resolves when the part can render (a failure shows when the part does). */
  preload: () => Promise<void>;
}

/** A component loaded by `load`; renders `fallback` (nothing by default) until its code arrives. */
export function onDemand<P extends object>(load: () => Promise<ComponentType<P>>, fallback: () => ReactElement | null = () => null): OnDemand<P> {
  let ready: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const get = () =>
    (pending ??= load().then(
      (c) => (ready = c),
      (e: Error) => {
        pending = null;
        throw e;
      },
    ));
  function Part(props: P) {
    const [, loaded] = useState(0);
    useEffect(() => {
      if (ready) return;
      let live = true;
      get().then(
        () => live && loaded(1),
        (e: Error) => toast(`Couldn't load this part of the app: ${e.message}`, 'error'),
      );
      return () => {
        live = false;
      };
    }, []);
    return ready ? createElement(ready, props) : fallback();
  }
  const preload = () => get().then(() => {}, () => {});
  return Object.assign(Part, { preload });
}

/** Run `cb` when the main thread is idle (soon after the first paint). */
export function whenIdle(cb: () => void) {
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(cb, { timeout: 1000 });
  else setTimeout(cb, 200);
}
