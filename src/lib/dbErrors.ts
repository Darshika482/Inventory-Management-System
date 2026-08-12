/**
 * Turns a Supabase / network failure into something a shop owner can act on.
 *
 * The app used to answer every failed save with "check your internet", which is
 * wrong most of the time: a missing column, a row-level-security rule or a
 * duplicate id all fail while the connection is perfectly fine. Guessing like
 * that sends people to reset their router instead of fixing the real problem.
 */

export interface FriendlyError {
  /** Plain-language line for the person using the app. */
  message: string;
  /** Short technical line, shown small. Empty when it would tell nobody anything. */
  detail: string;
}

/** Thrown in place of the raw abort when a request runs past its time limit. */
export class RequestTimeoutError extends Error {
  constructor() {
    super('The server did not answer in time.');
    this.name = 'RequestTimeoutError';
  }
}

interface DbErrorLike {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  name?: string;
}

function asErrorLike(err: unknown): DbErrorLike {
  if (err && typeof err === 'object') return err as DbErrorLike;
  return { message: String(err) };
}

// postgrest-js never throws on a dead connection: it hands back
// `{ error: { message: 'FetchError: Failed to fetch', code: '' } }`.
const NETWORK_MESSAGE =
  /fetcherror|failed to fetch|networkerror|network request failed|load failed|the operation was aborted|err_(internet|network|connection)/i;

export function isNetworkError(err: unknown): boolean {
  const { message = '', name = '' } = asErrorLike(err);
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  return NETWORK_MESSAGE.test(message);
}

/** True when another attempt has a real chance of working. */
export function isTransientError(err: unknown): boolean {
  if (err instanceof RequestTimeoutError) return true;
  if (isNetworkError(err)) return true;

  const { status, code } = asErrorLike(err);
  if (typeof status === 'number' && status >= 500) return true;

  // Statement cancelled, connection dropped mid-query, server out of room.
  return code === '57014' || code === '08006' || code === '08003' || code === '53300';
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Failures the database reports on purpose. Trying again will not help with any
 * of these, so the message has to say what to actually fix.
 */
const REFUSAL_REASONS: Record<string, string> = {
  '23505': 'The database already has a record with this id, so it looks like this was saved once already. Close this and check the list before saving again.',
  '23503': 'It is linked to something that is no longer in the database. Reload the page and try once more.',
  '23514': 'One of the values broke a rule set on the database. Check the amounts and dates.',
  '22003': 'One of the amounts is too large for the database to store.',
  '22P02': 'One of the values is not in the format the database expects. Check the numbers and the date.',
  '42501': 'The database security rules do not allow saving this. The setup SQL needs to be run again in Supabase.',
  '42P01': 'The table this needs does not exist in the database yet. Run the setup SQL in Supabase.',
  '42703': 'The database is missing a column this form needs. Run the latest setup SQL in Supabase.',
  PGRST204: 'The database is missing a column this form needs. Run the latest setup SQL in Supabase.',
  PGRST301: 'The app could not sign in to the database. The API key may have expired or changed.',
};

/**
 * @param sentenceStart what failed, as the start of a sentence and without the
 * full stop — e.g. `'The bill could not be saved'`.
 */
export function describeDbError(err: unknown, sentenceStart: string): FriendlyError {
  const { message = '', code = '' } = asErrorLike(err);
  const detail = [code, message].filter(Boolean).join(' · ');

  if (message.includes('Missing Supabase env vars')) {
    return {
      message: `${sentenceStart}. The app is not connected to the database at all — its settings are missing. This needs a developer, trying again will not help.`,
      detail: message,
    };
  }

  if (err instanceof RequestTimeoutError) {
    return {
      message: `${sentenceStart}. The server did not answer in time, which usually means a slow connection. Please try again.`,
      detail: '',
    };
  }

  if (isNetworkError(err)) {
    return isOffline()
      ? {
          message: `${sentenceStart}. Your device is not connected to the internet. Turn on Wi-Fi or mobile data, then try again.`,
          detail: '',
        }
      : {
          message: `${sentenceStart}. The server could not be reached, even though your device says it is online — the connection is probably weak or dropping. Please try again in a moment.`,
          detail: '',
        };
  }

  const refusal = REFUSAL_REASONS[code];
  if (refusal) {
    return { message: `${sentenceStart}. ${refusal}`, detail };
  }

  return {
    message: `${sentenceStart}. The database refused it, so this is not an internet problem and trying again may not help. Please show the line below to your developer.`,
    detail: detail || 'No details were given.',
  };
}
