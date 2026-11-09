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

const HELPER_PACKAGE = 'in.akshaytraders.whatsapp';
const HELPER_KEY = 'akshay.whatsappHelper';

/** The customer's 10-digit mobile number, or null when there is none. */
export function whatsAppNumber(phone: string | null | undefined): string | null {
  const digits = toPhoneDigits(phone ?? '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** Only Android phones can run the helper. */
export function canUseHelper(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/** This phone has the helper installed (the shop said so on the share sheet). */
export function helperEnabled(): boolean {
  try {
    return localStorage.getItem(HELPER_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setHelperEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(HELPER_KEY, 'on');
    else localStorage.removeItem(HELPER_KEY);
  } catch {
    // Private mode: the choice is not remembered.
  }
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
  return `intent://send?${query}#Intent;scheme=akshaywa;package=${HELPER_PACKAGE};end`;
}
