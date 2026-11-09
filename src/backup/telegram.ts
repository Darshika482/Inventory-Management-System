/**
 * Sending backups to the owner's own Telegram bot, straight from this phone.
 *
 * Setting up, once per phone:
 *  1. the owner makes a bot with @BotFather and pastes its token here;
 *  2. the app opens the bot with a one-time code; the owner taps START;
 *  3. the app finds that START message and remembers the chat it came from.
 * After that every backup goes to that chat. Telegram's Bot API answers web
 * pages directly, so no server of our own is needed.
 *
 * The token stays on this phone only (it is never saved in the database).
 */
import { BACKUP_PARTS, TELEGRAM_CONFIG_KEY, type BackupPartId } from './parts';

const API = 'https://api.telegram.org';

export interface TelegramConfig {
  token: string;
  chatId: string;
  /** "Akhilesh" or a group's title, to show which chat backups go to. */
  chatName: string;
  botName: string;
  botUsername: string;
  /** Parts ticked for a backup. */
  parts: BackupPartId[];
  /** Send a backup by itself, once a day, when the owner opens the app. */
  autoDaily: boolean;
}

export interface BackupStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** The last backup that went out was the daily one (not a tap on Send). */
  lastWasAuto: boolean;
  lastFileCount: number;
}

// --- Saved on this phone ---

const CONFIG_KEY = TELEGRAM_CONFIG_KEY;
const STATUS_KEY = 'ims_backup_status';

const EMPTY_STATUS: BackupStatus = {
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastError: null,
  lastWasAuto: false,
  lastFileCount: 0,
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the setting lasts until the page reloads.
  }
}

const listeners = new Set<() => void>();
let config: TelegramConfig | null = normaliseConfig(readJson<TelegramConfig>(CONFIG_KEY));
let status: BackupStatus = { ...EMPTY_STATUS, ...(readJson<BackupStatus>(STATUS_KEY) ?? {}) };

function normaliseConfig(raw: TelegramConfig | null): TelegramConfig | null {
  if (!raw || !raw.token || !raw.chatId) return null;
  const parts = Array.isArray(raw.parts) ? raw.parts.filter((p) => BACKUP_PARTS.includes(p)) : [];
  return { ...raw, parts: parts.length ? parts : [...BACKUP_PARTS], autoDaily: raw.autoDaily === true };
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeBackup(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab of the app connected, sent a backup or disconnected.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== CONFIG_KEY && e.key !== STATUS_KEY) return;
    config = normaliseConfig(readJson<TelegramConfig>(CONFIG_KEY));
    status = { ...EMPTY_STATUS, ...(readJson<BackupStatus>(STATUS_KEY) ?? {}) };
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export const getTelegramConfig = (): TelegramConfig | null => config;
export const getBackupStatus = (): BackupStatus => status;

export function saveTelegramConfig(next: TelegramConfig | null): void {
  config = normaliseConfig(next);
  writeJson(CONFIG_KEY, config);
  if (!config) {
    status = { ...EMPTY_STATUS };
    writeJson(STATUS_KEY, null);
  }
  emit();
}

export function updateTelegramConfig(changes: Partial<TelegramConfig>): void {
  if (!config) return;
  saveTelegramConfig({ ...config, ...changes });
}

export function updateBackupStatus(changes: Partial<BackupStatus>): void {
  status = { ...status, ...changes };
  writeJson(STATUS_KEY, status);
  emit();
}

// --- Bot API ---

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly retryAfter: number | null = null
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

/** "123456789:AA..." as BotFather gives it. */
export const TOKEN_PATTERN = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/;

export function cleanToken(text: string): string {
  return text.trim().replace(/^bot/i, '').replace(/\s+/g, '');
}

type Params = Record<string, string | number | boolean | object | undefined>;

/**
 * One Bot API call. Plain values go as a form, not JSON: a form is a "simple"
 * request, so the browser sends it without asking Telegram first.
 */
async function call<T>(token: string, method: string, params?: Params | FormData, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body: FormData | URLSearchParams | undefined;
  if (params instanceof FormData) {
    body = params;
  } else if (params) {
    body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, { method: body ? 'POST' : 'GET', body, signal: controller.signal });
  } catch (err) {
    throw new TelegramError(controller.signal.aborted ? 'timeout' : 'network', 0);
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: T;
    description?: string;
    error_code?: number;
    parameters?: { retry_after?: number };
  } | null;
  if (!json?.ok) {
    throw new TelegramError(json?.description ?? `HTTP ${res.status}`, json?.error_code ?? res.status, json?.parameters?.retry_after ?? null);
  }
  return json.result as T;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Telegram asks bots to slow down with a 429 and a wait time: wait, then try again. */
async function callPolitely<T>(token: string, method: string, params: () => Params | FormData, timeoutMs?: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call<T>(token, method, params(), timeoutMs);
    } catch (err) {
      const e = err as TelegramError;
      const canRetry = attempt < 3 && (e.code === 429 || e.code === 0 || e.code >= 500);
      if (!canRetry) throw err;
      await wait(e.retryAfter ? (e.retryAfter + 1) * 1000 : 1500 * (attempt + 1));
    }
  }
}

export interface BotInfo {
  id: number;
  first_name: string;
  username: string;
}

export function getMe(token: string): Promise<BotInfo> {
  return call<BotInfo>(token, 'getMe', undefined, 15_000);
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat: TelegramChat };
}

export interface FoundChat {
  chatId: string;
  chatName: string;
}

/** A one-time code for the START link, so only this phone's link connects. */
export function newConnectCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Link that opens the bot with START (or adds it to a group) carrying the code. */
export function startLink(botUsername: string, code: string, group = false): string {
  return `https://t.me/${botUsername}?${group ? 'startgroup' : 'start'}=${code}`;
}

/** The chat whose START message carries this code, or null when it has not come yet. */
export async function findStartChat(token: string, code: string): Promise<FoundChat | null> {
  const updates = await call<TelegramUpdate[]>(token, 'getUpdates', { timeout: 0, allowed_updates: ['message'] }, 15_000);
  // "/start CODE" in a private chat, "/start@BotName CODE" in a group.
  const pattern = new RegExp(`^/start(@\\w+)?\\s+${code}\\s*$`);
  const match = updates.find((u) => u.message?.text && pattern.test(u.message.text));
  // Mark what was looked at as read, so older messages never hide a new START.
  if (updates.length) {
    const last = updates[updates.length - 1].update_id;
    await call(token, 'getUpdates', { offset: last + 1, timeout: 0 }, 15_000).catch(() => undefined);
  }
  if (!match?.message) return null;
  const chat = match.message.chat;
  const chatName =
    chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || (chat.username ? `@${chat.username}` : String(chat.id));
  return { chatId: String(chat.id), chatName };
}

export function sendMessage(cfg: Pick<TelegramConfig, 'token' | 'chatId'>, html: string): Promise<unknown> {
  return callPolitely(cfg.token, 'sendMessage', () => ({
    chat_id: cfg.chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }));
}

export interface OutgoingFile {
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

const blobOf = (file: OutgoingFile) => new Blob([file.bytes as BlobPart], { type: file.mime });

function sendDocument(cfg: TelegramConfig, file: OutgoingFile, caption?: string): Promise<unknown> {
  return callPolitely(
    cfg.token,
    'sendDocument',
    () => {
      const form = new FormData();
      form.set('chat_id', cfg.chatId);
      form.set('document', blobOf(file), file.fileName);
      if (caption) form.set('caption', caption);
      return form;
    },
    120_000
  );
}

/** Up to 10 files as one album, so a backup sits together in the chat. */
function sendDocumentGroup(cfg: TelegramConfig, files: OutgoingFile[]): Promise<unknown> {
  return callPolitely(
    cfg.token,
    'sendMediaGroup',
    () => {
      const form = new FormData();
      form.set('chat_id', cfg.chatId);
      form.set('media', JSON.stringify(files.map((_, i) => ({ type: 'document', media: `attach://file${i}` }))));
      files.forEach((file, i) => form.set(`file${i}`, blobOf(file), file.fileName));
      return form;
    },
    180_000
  );
}

/** Sends the files as albums of up to 10; a single file goes on its own. */
export async function sendFiles(cfg: TelegramConfig, files: OutgoingFile[], onSent?: (n: number) => void): Promise<void> {
  let sent = 0;
  for (let i = 0; i < files.length; i += 10) {
    const chunk = files.slice(i, i + 10);
    if (chunk.length === 1) {
      await sendDocument(cfg, chunk[0]);
    } else {
      try {
        await sendDocumentGroup(cfg, chunk);
      } catch (err) {
        // A wrong token or chat will fail one by one too: say so at once.
        const code = (err as TelegramError).code;
        if (code === 401 || code === 403) throw err;
        for (const file of chunk) await sendDocument(cfg, file);
      }
    }
    sent += chunk.length;
    onSent?.(sent);
  }
}
