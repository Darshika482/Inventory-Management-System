/**
 * Opening WhatsApp straight on one customer's chat. A web page can fill in the
 * text of that chat but cannot attach a file to it, so the bill goes as a link.
 */
import { toPhoneDigits } from '../states';

/** The customer's 10-digit mobile number, or null when there is none to open a chat with. */
export function whatsAppNumber(phone: string | null | undefined): string | null {
  const digits = toPhoneDigits(phone ?? '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** WhatsApp with this text: on the customer's chat when the number is known, else WhatsApp's own contact list. */
export function whatsAppChatUrl(number: string | null, text: string): string {
  const message = encodeURIComponent(text);
  return number ? `https://wa.me/91${number}?text=${message}` : `https://wa.me/?text=${message}`;
}
