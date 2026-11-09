import { useEffect, useRef } from 'react';

/**
 * Makes the device / browser Back button close whatever is on top (a modal,
 * the photo viewer, a dropdown, the mobile menu, or a sub-page) instead of
 * closing the whole installed app.
 *
 * How it works: every open overlay registers a "dismiss" handler. While at
 * least one is registered we keep a single extra entry on the history stack
 * (the "guard"). A Back press pops that guard, so instead of leaving the app
 * we intercept it and dismiss the top-most overlay. Because history is only
 * touched when the layer count crosses the empty/non-empty boundary, opening
 * and closing overlays in any order stays perfectly balanced.
 *
 * On Android, Chrome's own Back-button API (CloseWatcher) is used instead of
 * history. Chrome skips history entries a page adds without a fresh tap, so
 * with history a second Back press (e.g. after going back one page) closed
 * the whole app. A CloseWatcher is not part of history: while one is open,
 * Back always goes to it, and a new one can be opened after each Back press.
 *
 * Elsewhere (computers, browsers without CloseWatcher) the history guard is
 * used, added only once the page has had a tap or key press.
 */

type DismissHandler = () => void;

const GUARD_STATE = { __appBackGuard: true };

const layers: DismissHandler[] = [];
let armed = false;
// popstate events we triggered ourselves (by removing the guard) and must skip.
let ignorePops = 0;
let flushQueued = false;
let listening = false;
let waitingForTouch = false;

// --- Android: Chrome's CloseWatcher ---

interface CloseWatcherLike {
  destroy(): void;
  addEventListener(type: 'close', listener: () => void): void;
}
type CloseWatcherCtor = new () => CloseWatcherLike;

/** Only on Android: there Back is the only way to send a close request (on a computer, Esc would too). */
function closeWatcherCtor(): CloseWatcherCtor | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  const Ctor = (window as Window & { CloseWatcher?: CloseWatcherCtor }).CloseWatcher;
  return Ctor && /Android/i.test(navigator.userAgent) ? Ctor : null;
}

let watcher: CloseWatcherLike | null = null;

/** Keeps exactly one CloseWatcher open while any layer is registered. */
function syncWatcher(Ctor: CloseWatcherCtor) {
  if (layers.length > 0 && !watcher) {
    try {
      const created = new Ctor();
      watcher = created;
      created.addEventListener('close', () => {
        // Back was pressed: this watcher is used up.
        if (watcher !== created) return;
        watcher = null;
        const dismiss = layers.pop();
        // Ready for the next Back press before anything else runs.
        syncWatcher(Ctor);
        if (dismiss) dismiss();
      });
    } catch {
      watcher = null;
    }
  } else if (layers.length === 0 && watcher) {
    const old = watcher;
    watcher = null;
    old.destroy();
  }
}

/** True once the person has tapped or typed on the page (always true where the browser cannot tell). */
function hadUserActivation(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation ? activation.hasBeenActive : true;
}

/** Arms the guard on the first tap or key press: an entry added then is not skipped by Back. */
function armOnFirstTouch() {
  if (waitingForTouch) return;
  waitingForTouch = true;
  const events = ['pointerup', 'touchend', 'click', 'keydown'] as const;
  const onTouch = () => {
    if (!hadUserActivation()) return;
    waitingForTouch = false;
    events.forEach((name) => window.removeEventListener(name, onTouch, true));
    flush();
  };
  events.forEach((name) => window.addEventListener(name, onTouch, true));
}

function canUseHistory(): boolean {
  return typeof window !== 'undefined' && typeof window.history !== 'undefined';
}

function ensureListening() {
  if (listening || !canUseHistory()) return;
  listening = true;
  window.addEventListener('popstate', handlePopState);
}

// Reconciling on a microtask lets a close-then-open (or React Strict Mode's
// mount/unmount/mount) cancel out to a single, stable guard entry.
function scheduleFlush() {
  if (flushQueued || (!closeWatcherCtor() && !canUseHistory())) return;
  flushQueued = true;
  queueMicrotask(flush);
}

function flush() {
  flushQueued = false;
  const Ctor = closeWatcherCtor();
  if (Ctor) {
    syncWatcher(Ctor);
    return;
  }
  const shouldArm = layers.length > 0;
  if (shouldArm && !armed) {
    if (!hadUserActivation()) {
      armOnFirstTouch();
      return;
    }
    window.history.pushState(GUARD_STATE, '');
    armed = true;
  } else if (!shouldArm && armed) {
    armed = false;
    ignorePops += 1;
    window.history.back();
  }
}

function handlePopState() {
  if (ignorePops > 0) {
    ignorePops -= 1;
    return;
  }

  // The user pressed Back and consumed our guard entry.
  armed = false;
  const dismiss = layers.pop();

  // Re-arm immediately so a following Back is still trapped for lower layers.
  if (layers.length > 0) {
    window.history.pushState(GUARD_STATE, '');
    armed = true;
  }

  if (dismiss) dismiss();
}

/**
 * Registers an overlay's close handler and returns a disposer. Call the
 * disposer when the overlay closes by any other means (button, backdrop, Esc).
 */
export function registerBackLayer(onDismiss: DismissHandler, atBottom = false): () => void {
  if (!closeWatcherCtor()) ensureListening();
  // atBottom: under every open overlay (the page itself), so overlays close first.
  if (atBottom) layers.unshift(onDismiss);
  else layers.push(onDismiss);
  scheduleFlush();

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const index = layers.lastIndexOf(onDismiss);
    if (index !== -1) layers.splice(index, 1);
    scheduleFlush();
  };
}

/**
 * Hook form: while `active` is true, pressing Back runs `onDismiss` instead of
 * leaving the app. `onDismiss` may change between renders without re-arming.
 * A Back press uses up the layer; a new `resetKey` (e.g. the page shown after
 * it) catches the next Back press again while `active` stays true.
 */
export function useBackDismiss(active: boolean, onDismiss: DismissHandler, resetKey?: string, atBottom = false) {
  const handlerRef = useRef(onDismiss);
  handlerRef.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    return registerBackLayer(() => handlerRef.current(), atBottom);
  }, [active, resetKey, atBottom]);
}

/**
 * Leaves the app on purpose (the person chose "Exit"): drops every layer and
 * the guard entry, then closes the window where the browser allows it. In a
 * browser tab it goes back to the page before the app.
 *
 * Resolves false when the app is still open afterwards: an installed app on
 * Android only closes on a real Back press from its first page, and nothing is
 * left to stop that press now.
 */
export function leaveApp(): Promise<boolean> {
  layers.length = 0;
  if (watcher) {
    const old = watcher;
    watcher = null;
    old.destroy();
  }
  if (!canUseHistory()) return Promise.resolve(false);

  const stillOpen = () => document.visibilityState === 'visible';
  const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const dropGuard = new Promise<void>((resolve) => {
    if (!armed) return resolve();
    armed = false;
    ignorePops += 1;
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.setTimeout(resolve, 400);
    window.history.back();
  });

  return dropGuard.then(async () => {
    window.close();
    await pause(250);
    if (!stillOpen()) return true;
    window.history.back();
    await pause(250);
    return !stillOpen();
  });
}
