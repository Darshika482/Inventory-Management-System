/**
 * One backup, start to end: read everything, build the files, send them to
 * Telegram, and remember how it went. Also the daily backup that runs by
 * itself when the owner opens the app.
 */
import { describeDbError } from '../lib/dbErrors';
import { listQueuedSales } from '../sales/outbox';
import { collectAll } from './collect';
import { buildBackup, istDate, type BackupPartId, type Translate } from './reports';
import {
  getBackupStatus,
  getTelegramConfig,
  sendFiles,
  sendMessage,
  TelegramError,
  updateBackupStatus,
} from './telegram';

export type BackupStep =
  | { step: 'reading'; done: number; total: number }
  | { step: 'building' }
  | { step: 'sending'; done: number; total: number };

export interface BackupResult {
  files: number;
  udhaarCustomers: number;
}

/** Plain words for what went wrong while talking to Telegram. */
export function describeTelegramError(err: unknown, t: Translate): string {
  if (!(err instanceof TelegramError)) return describeDbError(err, t('bkReadFailed')).message;
  const text = err.message.toLowerCase();
  if (err.code === 0) return err.message === 'timeout' ? t('bkErrTimeout') : t('bkErrNetwork');
  if (err.code === 401 || err.code === 404) return t('bkErrToken');
  if (err.code === 403 || text.includes('chat not found') || text.includes('blocked')) return t('bkErrChat');
  if (err.code === 409) return t('bkErrWebhook');
  if (err.code === 413) return t('bkErrTooBig');
  if (err.code === 429) return t('bkErrBusy');
  return `${t('bkErrTelegram')} (${err.message})`;
}

let running: Promise<BackupResult> | null = null;

export const isBackupRunning = () => running !== null;

/** Another tab of the app on this phone may be sending one right now. */
const LOCK_KEY = 'ims_backup_lock';
const LOCK_MS = 10 * 60 * 1000;

function takeLock(): boolean {
  try {
    const held = Number(localStorage.getItem(LOCK_KEY) ?? 0);
    if (held && Date.now() - held < LOCK_MS) return false;
    localStorage.setItem(LOCK_KEY, String(Date.now()));
  } catch {
    // No storage: just this tab, then.
  }
  return true;
}

function releaseLock(): void {
  try {
    localStorage.removeItem(LOCK_KEY);
  } catch {
    // Nothing to release.
  }
}

export interface RunBackupOptions {
  t: Translate;
  /** Defaults to the parts ticked in settings. */
  parts?: BackupPartId[];
  auto?: boolean;
  onStep?: (step: BackupStep) => void;
}

export function runBackup(options: RunBackupOptions): Promise<BackupResult> {
  if (running) return running;
  if (!takeLock()) return Promise.reject(new Error(options.t('bkAlreadyRunning')));
  running = doBackup(options).finally(() => {
    running = null;
    releaseLock();
  });
  return running;
}

async function doBackup({ t, parts, auto = false, onStep }: RunBackupOptions): Promise<BackupResult> {
  const cfg = getTelegramConfig();
  if (!cfg) throw new Error(t('bkNotConnected'));
  const chosen = parts ?? cfg.parts;
  if (!chosen.length) throw new Error(t('bkNothingChosen'));
  const startedAt = new Date();
  updateBackupStatus({ lastAttemptAt: startedAt.toISOString() });

  try {
    onStep?.({ step: 'reading', done: 0, total: 1 });
    const data = await collectAll((done, total) => onStep?.({ step: 'reading', done, total }));
    const queuedSales = await listQueuedSales();

    onStep?.({ step: 'building' });
    // Let the screen show "Making files..." before the work starts.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const shopName = String(data.tables.shop_settings?.[0]?.shop_name ?? '') || 'Akshay Traders';
    const built = buildBackup({ data, queuedSales, parts: chosen, shopName, now: startedAt, t });

    const total = built.messages.length + built.files.length;
    let done = 0;
    onStep?.({ step: 'sending', done, total });
    for (const message of built.messages) {
      await sendMessage(cfg, message);
      onStep?.({ step: 'sending', done: ++done, total });
    }
    const before = done;
    await sendFiles(cfg, built.files, (n) => onStep?.({ step: 'sending', done: before + n, total }));

    updateBackupStatus({
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      lastWasAuto: auto,
      lastFileCount: built.files.length,
    });
    return { files: built.files.length, udhaarCustomers: built.udhaarCustomers };
  } catch (err) {
    const message = describeTelegramError(err, t);
    updateBackupStatus({ lastError: message });
    throw new Error(message);
  }
}

/** Daily backup: due when none went out yet today (India time). */
export function dailyBackupDue(now = new Date()): boolean {
  const cfg = getTelegramConfig();
  if (!cfg?.autoDaily) return false;
  const status = getBackupStatus();
  if (status.lastSuccessAt && istDate(new Date(status.lastSuccessAt)) === istDate(now)) return false;
  // After a failure, wait an hour before trying again.
  if (status.lastAttemptAt && now.getTime() - Date.parse(status.lastAttemptAt) < 60 * 60 * 1000 && status.lastError) return false;
  return true;
}

/**
 * Sends today's backup if it is due. Resolves to what happened, for a toast:
 * 'failed' only the first time in a row, so a lasting problem is not repeated every hour.
 */
export async function runDailyBackupIfDue(t: Translate): Promise<'sent' | 'failed' | 'skipped'> {
  if (!dailyBackupDue() || running || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'skipped';
  const failedBefore = Boolean(getBackupStatus().lastError);
  try {
    await runBackup({ t, auto: true });
    return 'sent';
  } catch {
    return failedBefore ? 'skipped' : 'failed';
  }
}
