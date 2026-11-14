import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A plain in-memory localStorage, so the settings saved on "this phone" can be set up. */
function stubStorage(initial: Record<string, unknown>) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
}

const connected = {
  token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0',
  chatId: '42',
  chatName: 'Akhilesh',
  botName: 'Shop',
  botUsername: 'shop_bot',
  parts: ['udhaar', 'full'],
  autoDaily: true,
};

async function load(storage: Record<string, unknown>) {
  stubStorage(storage);
  vi.resetModules();
  const run = await import('./runBackup');
  const parts = await import('./parts');
  return { ...run, ...parts };
}

describe('daily backup', () => {
  beforeEach(() => vi.unstubAllGlobals());

  // 9 Nov 2026, 10:00 in India.
  const now = new Date('2026-11-09T04:30:00Z');

  it('is due when none went out today', async () => {
    const m = await load({ ims_backup_telegram: connected, ims_backup_status: { lastSuccessAt: '2026-11-08T12:00:00Z' } });
    expect(m.dailyBackupWanted()).toBe(true);
    expect(m.dailyBackupDue(now)).toBe(true);
  });

  it('is not due again the same day (India time)', async () => {
    // 00:30 on 9 Nov in India is still "today", though it is 8 Nov in UTC.
    const m = await load({ ims_backup_telegram: connected, ims_backup_status: { lastSuccessAt: '2026-11-08T19:00:00Z' } });
    expect(m.dailyBackupDue(now)).toBe(false);
  });

  it('waits an hour after a failed try', async () => {
    const m = await load({
      ims_backup_telegram: connected,
      ims_backup_status: { lastAttemptAt: '2026-11-09T04:00:00Z', lastError: 'No internet' },
    });
    expect(m.dailyBackupDue(now)).toBe(false);
    expect(m.dailyBackupDue(new Date('2026-11-09T05:01:00Z'))).toBe(true);
  });

  it('is off when turned off or not connected', async () => {
    let m = await load({ ims_backup_telegram: { ...connected, autoDaily: false } });
    expect(m.dailyBackupWanted()).toBe(false);
    expect(m.dailyBackupDue(now)).toBe(false);
    m = await load({});
    expect(m.dailyBackupWanted()).toBe(false);
    expect(m.dailyBackupDue(now)).toBe(false);
  });
});
