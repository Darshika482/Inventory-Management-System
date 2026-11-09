import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanToken, findStartChat, sendFiles, startLink, TelegramError, TOKEN_PATTERN, type TelegramConfig } from './telegram';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';

const cfg: TelegramConfig = {
  token: TOKEN,
  chatId: '42',
  chatName: 'Akhilesh',
  botName: 'Shop backup',
  botUsername: 'shop_backup_bot',
  parts: ['udhaar'],
  autoDaily: true,
};

type Call = { url: string; body: BodyInit | null | undefined };

function mockTelegram(answer: (method: string, call: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, body: init?.body };
      calls.push(call);
      const method = url.split('/').pop() ?? '';
      const result = answer(method, call);
      const json = result instanceof TelegramError
        ? { ok: false, error_code: result.code, description: result.message, parameters: result.retryAfter !== null ? { retry_after: result.retryAfter } : undefined }
        : { ok: true, result };
      return new Response(JSON.stringify(json), { status: 200 });
    })
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('tokens and links', () => {
  it('accepts a token as BotFather gives it, even pasted with spaces', () => {
    expect(TOKEN_PATTERN.test(cleanToken(`  ${TOKEN} `))).toBe(true);
    expect(TOKEN_PATTERN.test(cleanToken('bot' + TOKEN))).toBe(true);
    expect(TOKEN_PATTERN.test(cleanToken('hello'))).toBe(false);
  });

  it('opens the bot with the one-time code', () => {
    expect(startLink('shop_backup_bot', 'abc123')).toBe('https://t.me/shop_backup_bot?start=abc123');
    expect(startLink('shop_backup_bot', 'abc123', true)).toBe('https://t.me/shop_backup_bot?startgroup=abc123');
  });
});

describe('findStartChat', () => {
  it('finds the chat that sent START with this code, and marks updates read', async () => {
    const calls = mockTelegram((method, call) => {
      if (method !== 'getUpdates') return null;
      if (String(call.body).includes('offset')) return [];
      return [
        { update_id: 10, message: { text: '/start someoneelse', chat: { id: 1, type: 'private', first_name: 'X' } } },
        { update_id: 11, message: { text: '/start abc123', chat: { id: 42, type: 'private', first_name: 'Akhilesh', last_name: 'Jain' } } },
        { update_id: 12, message: { text: 'hello', chat: { id: 42, type: 'private' } } },
      ];
    });
    await expect(findStartChat(TOKEN, 'abc123')).resolves.toEqual({ chatId: '42', chatName: 'Akhilesh Jain' });
    expect(String(calls[1].body)).toContain('offset=13');
  });

  it('takes START from a group too', async () => {
    mockTelegram(() => [
      { update_id: 1, message: { text: '/start@shop_backup_bot abc123', chat: { id: -100, type: 'group', title: 'Shop records' } } },
    ]);
    await expect(findStartChat(TOKEN, 'abc123')).resolves.toEqual({ chatId: '-100', chatName: 'Shop records' });
  });

  it('is null while START has not come, and clears older messages out of the way', async () => {
    let calls = mockTelegram(() => []);
    await expect(findStartChat(TOKEN, 'abc123')).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    calls = mockTelegram((_, call) => (String(call.body).includes('offset') ? [] : [{ update_id: 7, message: { text: 'hi', chat: { id: 1, type: 'private' } } }]));
    await expect(findStartChat(TOKEN, 'abc123')).resolves.toBeNull();
    expect(String(calls[1].body)).toContain('offset=8');
  });
});

describe('sendFiles', () => {
  const file = (n: number) => ({ fileName: `f${n}.xlsx`, mime: 'application/octet-stream', bytes: new Uint8Array([n]) });

  it('sends up to 10 files per album, and a lone file by itself', async () => {
    const calls = mockTelegram(() => true);
    const sent: number[] = [];
    await sendFiles(cfg, Array.from({ length: 11 }, (_, i) => file(i)), (n) => sent.push(n));
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['sendMediaGroup', 'sendDocument']);
    const album = calls[0].body as FormData;
    expect(JSON.parse(String(album.get('media')))).toHaveLength(10);
    expect((album.get('file9') as File).name).toBe('f9.xlsx');
    expect(sent).toEqual([10, 11]);
  });

  it('falls back to one by one when the album is refused', async () => {
    const calls = mockTelegram((method) => (method === 'sendMediaGroup' ? new TelegramError('Bad Request: something', 400) : true));
    await sendFiles(cfg, [file(1), file(2)]);
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['sendMediaGroup', 'sendDocument', 'sendDocument']);
  });

  it('stops at once on a wrong token', async () => {
    mockTelegram(() => new TelegramError('Unauthorized', 401));
    await expect(sendFiles(cfg, [file(1), file(2)])).rejects.toMatchObject({ code: 401 });
  });

  it('waits and tries again when Telegram says slow down', async () => {
    vi.useFakeTimers();
    let tries = 0;
    const calls = mockTelegram(() => (++tries === 1 ? new TelegramError('Too Many Requests', 429, 2) : true));
    const done = sendFiles(cfg, [file(1)]);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(calls).toHaveLength(2);
  });
});
