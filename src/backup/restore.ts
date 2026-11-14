/**
 * Restore: puts back, from a "Full backup" file, every record the app no
 * longer has. Records still in the app are left exactly as they are, nothing
 * is deleted, and running it twice adds nothing the second time.
 *
 * The database does the inserting (app_restore_rows, from
 * supabase/shop/17-backup-restore.sql), so it works whatever the per-table
 * access rules are, and only for the owner.
 */
import { assertSupabase, runDb } from '../lib/database';
import { BACKUP_TABLES, type Row } from './collect';
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupJson } from './reports';

export interface ParsedBackup {
  createdAt: string;
  shopName: string;
  /** Tables Restore can put back, with how many records the file has for each. */
  tables: { name: string; rows: Row[] }[];
  totalRows: number;
}

export class BackupFileError extends Error {
  constructor(readonly reason: 'notJson' | 'notBackup' | 'newerVersion' | 'empty') {
    super(reason);
    this.name = 'BackupFileError';
  }
}

/** Reads and checks a backup file's text. */
export function parseBackupFile(text: string): ParsedBackup {
  let json: Partial<BackupJson>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupFileError('notJson');
  }
  if (!json || json.format !== BACKUP_FORMAT || typeof json.tables !== 'object' || !json.tables) {
    throw new BackupFileError('notBackup');
  }
  if (typeof json.version !== 'number' || json.version > BACKUP_VERSION) throw new BackupFileError('newerVersion');

  const source = json.tables as Record<string, unknown>;
  const tables = BACKUP_TABLES.filter((t) => t.restore)
    .map((t) => ({
      name: t.name,
      rows: Array.isArray(source[t.name])
        ? (source[t.name] as unknown[]).filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r))
        : [],
    }))
    .filter((t) => t.rows.length > 0);
  const totalRows = tables.reduce((sum, t) => sum + t.rows.length, 0);
  if (totalRows === 0) throw new BackupFileError('empty');

  return {
    createdAt: typeof json.created_at === 'string' ? json.created_at : '',
    shopName: typeof json.shop_name === 'string' ? json.shop_name : '',
    tables,
    totalRows,
  };
}

export interface TableRestoreResult {
  name: string;
  inFile: number;
  added: number;
  failed: number;
  error: string | null;
}

export class RestoreSetupMissing extends Error {
  constructor() {
    super('Run supabase/shop/17-backup-restore.sql in Supabase first.');
    this.name = 'RestoreSetupMissing';
  }
}

const CHUNK = 250;

function isMissingFunction(err: unknown): boolean {
  const { code, message = '' } = (err ?? {}) as { code?: string; message?: string };
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(message);
}

/** Puts the missing records back, table by table, in an order that keeps links whole. */
export async function restoreBackup(
  backup: ParsedBackup,
  onProgress?: (done: number, total: number) => void
): Promise<TableRestoreResult[]> {
  const results: TableRestoreResult[] = [];
  let done = 0;
  for (const table of backup.tables) {
    const result: TableRestoreResult = { name: table.name, inFile: table.rows.length, added: 0, failed: 0, error: null };
    for (let i = 0; i < table.rows.length; i += CHUNK) {
      const chunk = table.rows.slice(i, i + CHUNK);
      try {
        const data = await runDb<{ added: number; failed: number; error: string | null }>((signal) =>
          assertSupabase().rpc('app_restore_rows', { p_table: table.name, p_rows: chunk }).abortSignal(signal)
        );
        result.added += data?.added ?? 0;
        result.failed += data?.failed ?? 0;
        if (data?.error) result.error = data.error;
      } catch (err) {
        if (isMissingFunction(err)) throw new RestoreSetupMissing();
        result.failed += chunk.length;
        result.error = (err as { message?: string })?.message ?? String(err);
      }
      done += chunk.length;
      onProgress?.(done, backup.totalRows);
    }
    results.push(result);
  }
  return results;
}
