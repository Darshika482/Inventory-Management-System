/**
 * Keeps phones on the latest version of the app.
 *
 * An app added to the home screen can stay open in the background for days,
 * still running the code it started with. After an update that changes how
 * signing in works, that old code can no longer sign in or load data. So
 * whenever the app is opened or brought back to the front, it asks the server
 * which version is current and reloads itself if it is behind.
 *
 * Unsaved bills are not lost: the New Sale screen keeps its draft on the phone.
 */

const CHECK_GAP_MS = 60_000;
let lastCheck = 0;

/** The main script this page is running, e.g. "/assets/index-AbC123.js" (null in development). */
function runningScript(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  if (!script) return null;
  return new URL(script.src, location.origin).pathname;
}

async function checkForNewVersion() {
  const current = runningScript();
  if (!current || !navigator.onLine) return;
  const now = Date.now();
  if (now - lastCheck < CHECK_GAP_MS) return;
  lastCheck = now;

  try {
    const res = await fetch(`/?version-check=${now}`, { cache: 'no-store' });
    if (!res.ok) return;
    const latest = /\/assets\/index-[\w-]+\.js/.exec(await res.text())?.[0];
    if (latest && latest !== current) {
      // Make sure the service worker serves the new files too, then reload.
      const registration = await navigator.serviceWorker?.getRegistration();
      await registration?.update().catch(() => {});
      location.reload();
    }
  } catch {
    // Offline or the server did not answer: keep running this version.
  }
}

export function startUpdateChecks(): void {
  void checkForNewVersion();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForNewVersion();
  });
  window.addEventListener('focus', () => void checkForNewVersion());
  window.addEventListener('online', () => void checkForNewVersion());
}
