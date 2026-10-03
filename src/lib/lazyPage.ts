import { createElement, lazy, type ComponentType } from 'react';

/** Pages whose code download failed; "Try again" gives each a fresh attempt. */
const failedPages = new Set<() => void>();

/**
 * A page whose code is downloaded only when it is first shown, so opening the
 * app does not wait for every screen. `preload()` starts that download early
 * (e.g. while the phone is idle) so tapping the page later is instant.
 */
export function lazyPage<M, P extends object>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<P>
) {
  let loading: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () => {
    loading ??= load().then(
      (module) => ({ default: pick(module) }),
      (err) => {
        // No signal, or an app update replaced the file: try afresh next time.
        loading = null;
        failedPages.add(reset);
        throw err;
      }
    );
    return loading;
  };
  // React remembers a failed lazy() for good, so a retry needs a new one.
  let Lazy = lazy(preload);
  const reset = () => {
    Lazy = lazy(preload);
  };
  const Page = (props: P) => createElement(Lazy as ComponentType<P>, props);
  return Object.assign(Page, { preload });
}

/** Lets every page that failed to download try again on its next render. */
export function retryFailedPages(): void {
  failedPages.forEach((reset) => reset());
  failedPages.clear();
}

/** Runs `task` once the phone has nothing else to do (or after `fallbackMs`). */
export function whenIdle(task: () => void, fallbackMs = 2500): void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (w.requestIdleCallback) w.requestIdleCallback(task, { timeout: fallbackMs * 2 });
  else setTimeout(task, fallbackMs);
}

/** Downloads the given pages one after another in the background. */
export function preloadInBackground(pages: { preload: () => Promise<unknown> }[]): void {
  whenIdle(async () => {
    for (const page of pages) {
      // A failure here is fine: the page tries again when it is opened.
      await page.preload().catch(() => {});
    }
  });
}
