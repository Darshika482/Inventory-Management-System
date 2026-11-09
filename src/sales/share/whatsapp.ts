/**
 * The customer's WhatsApp number, shown on the share sheet so the right chat
 * is easy to pick. (A web page cannot attach a file to a chat it opens, so the
 * bill file goes through the phone's share menu.)
 */
import { toPhoneDigits } from '../states';

/** The customer's 10-digit mobile number, or null when there is none. */
export function whatsAppNumber(phone: string | null | undefined): string | null {
  const digits = toPhoneDigits(phone ?? '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
