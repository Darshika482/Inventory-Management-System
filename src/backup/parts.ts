/**
 * The parts a backup is divided into. Kept tiny (no other imports) so the app
 * shell can check for the daily backup without loading the backup code.
 */

export type BackupPartId = 'udhaar' | 'sales' | 'parties' | 'godown' | 'partyBills' | 'transport' | 'workers' | 'full';

/** In the order they are listed on screen and sent. Udhaar first: it matters most. */
export const BACKUP_PARTS: BackupPartId[] = ['udhaar', 'sales', 'parties', 'godown', 'partyBills', 'transport', 'workers', 'full'];

/** Where the Telegram connection is kept on this phone. */
export const TELEGRAM_CONFIG_KEY = 'ims_backup_telegram';

/** True when this phone is connected to Telegram with the daily backup on. */
export function dailyBackupWanted(): boolean {
  try {
    const raw = localStorage.getItem(TELEGRAM_CONFIG_KEY);
    if (!raw) return false;
    const cfg = JSON.parse(raw) as { token?: string; chatId?: string; autoDaily?: boolean };
    return Boolean(cfg.token && cfg.chatId && cfg.autoDaily);
  } catch {
    return false;
  }
}
