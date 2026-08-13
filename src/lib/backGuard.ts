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
 */

type DismissHandler = () => void;

const GUARD_STATE = { __appBackGuard: true };

const layers: DismissHandler[] = [];
let armed = false;
// popstate events we triggered ourselves (by removing the guard) and must skip.
let ignorePops = 0;
let flushQueued = false;
let listening = false;

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
  if (flushQueued || !canUseHistory()) return;
  flushQueued = true;
  queueMicrotask(flush);
}

function flush() {
  flushQueued = false;
  const shouldArm = layers.length > 0;
  if (shouldArm && !armed) {
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
export function registerBackLayer(onDismiss: DismissHandler): () => void {
  ensureListening();
  layers.push(onDismiss);
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
 */
export function useBackDismiss(active: boolean, onDismiss: DismissHandler) {
  const handlerRef = useRef(onDismiss);
  handlerRef.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    return registerBackLayer(() => handlerRef.current());
  }, [active]);
}
