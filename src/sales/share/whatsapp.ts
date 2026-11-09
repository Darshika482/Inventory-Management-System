/**
 * Sending the bill file straight to the customer's WhatsApp chat.
 *
 * A web page can open a WhatsApp chat with text, or open the share menu with a
 * file, but not both. The small Android helper app (android-helper/) does it:
 * the bill file is put online, and the helper downloads it and opens WhatsApp
 * on the customer's chat with the file attached. The shop just taps Send.
 */
import { toPhoneDigits } from '../states';

/** Where the helper APK is published by the "WhatsApp helper APK" GitHub workflow. */
export const HELPER_APK_URL =
  'https://github.com/Darshika482/Inventory-Management-System/releases/download/whatsapp-helper/akshay-whatsapp-helper.apk';

const MISSING_KEY = 'akshay.whatsappHelperMissing';

/** The customer's 10-digit mobile number, or null when there is none. */
export function whatsAppNumber(phone: string | null | undefined): string | null {
  const digits = toPhoneDigits(phone ?? '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** Only Android phones can run the helper. */
export function canUseHelper(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/**
 * WhatsApp did not open through the helper on this phone (it is not
 * installed), so sending goes through the share menu without trying again.
 */
export function helperMissing(): boolean {
  try {
    return localStorage.getItem(MISSING_KEY) === '1';
  } catch {
    return false;
  }
}

export function setHelperMissing(missing: boolean): void {
  try {
    if (missing) localStorage.setItem(MISSING_KEY, '1');
    else localStorage.removeItem(MISSING_KEY);
  } catch {
    // Not remembered; the next send tries the helper again.
  }
}

/** Android with the helper (as far as this phone knows): the customer's chat opens by itself. */
export function canOpenChatDirectly(): boolean {
  return canUseHelper() && !helperMissing();
}

/** True when the page goes to the background within `ms` (another app, e.g. WhatsApp, opened). */
export function pageLeftWithin(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.visibilityState === 'hidden') return resolve(true);
    const onChange = () => {
      if (document.visibilityState !== 'hidden') return;
      cleanup();
      resolve(true);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, ms);
    const cleanup = () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onChange);
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

/**
 * Opens the helper with a file that is already online. True when WhatsApp
 * opened (this page went to the background). False when the helper is not on
 * this phone: that is remembered, so the next send uses the share menu.
 */
export async function openInHelper(fileUrl: string, number: string | null, fileName: string, mimeType: string): Promise<boolean> {
  window.location.href = helperLink(fileUrl, number, fileName, mimeType);
  const opened = await pageLeftWithin(3000);
  setHelperMissing(!opened);
  return opened;
}

/**
 * The link that opens the helper app with the bill file. `number` null: WhatsApp
 * asks which chat to send it to.
 */
export function helperLink(fileUrl: string, number: string | null, fileName: string, mimeType: string): string {
  // %20 for spaces, never "+": the helper must get the file link back exactly.
  const params: [string, string][] = [
    ['url', fileUrl],
    ['name', fileName],
    ['type', mimeType],
  ];
  if (number) params.push(['phone', `91${number}`]);
  const query = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  // No package name: without the helper nothing opens (instead of the Play
  // Store), and the share sheet offers the download.
  return `intent://send?${query}#Intent;scheme=akshaywa;end`;
}
