/**
 * Reads every record the app keeps, table by table, for the backup.
 *
 * Some tables only exist once their SQL file has been run in Supabase
 * (party bills, workers, transport, ...). A table that is not there is noted
 * and skipped, so the backup still goes out with everything else.
 */
import { assertSupabase, fetchAllRows } from '../lib/database';
import type { BackupPartId } from './parts';

export type Row = Record<string, unknown>;

export interface BackupTable {
  name: string;
  /** Columns to sort by; the last one must be unique so no row lands on two pages. */
  order: string[];
  /** Put back by Restore (lists that are only for reading, like user names, are not). */
  restore: boolean;
  /** The part of the business it belongs to, for the Restore summary. */
  part: BackupPartId;
}

/**
 * In the order Restore puts them back: a record always comes after the
 * records it points to (items after categories, bill lines after bills).
 */
export const BACKUP_TABLES: BackupTable[] = [
  // Shop sales
  { name: 'shop_settings', order: ['id'], restore: true, part: 'sales' },
  { name: 'shop_categories', order: ['id'], restore: true, part: 'parties' },
  { name: 'shop_items', order: ['id'], restore: true, part: 'parties' },
  { name: 'shop_parties', order: ['id'], restore: true, part: 'parties' },
  { name: 'shop_counters', order: ['bill_type', 'fy', 'series'], restore: true, part: 'sales' },
  { name: 'shop_invoices', order: ['created_at', 'id'], restore: true, part: 'sales' },
  { name: 'shop_invoice_items', order: ['invoice_id', 'line_no', 'id'], restore: true, part: 'sales' },
  { name: 'shop_payments', order: ['created_at', 'id'], restore: true, part: 'udhaar' },
  { name: 'shop_invoice_versions', order: ['invoice_id', 'version', 'id'], restore: true, part: 'sales' },
  { name: 'shop_monthly_summary', order: ['month'], restore: true, part: 'sales' },
  // Godown stock
  { name: 'categories', order: ['created_at', 'id'], restore: true, part: 'godown' },
  { name: 'withdrawal_logs', order: ['created_at', 'id'], restore: true, part: 'godown' },
  { name: 'stock_additions', order: ['created_at', 'id'], restore: true, part: 'godown' },
  { name: 'item_groups', order: ['created_at', 'id'], restore: true, part: 'godown' },
  // Party bills
  { name: 'purchase_bills', order: ['created_at', 'id'], restore: true, part: 'partyBills' },
  { name: 'bill_payments', order: ['created_at', 'id'], restore: true, part: 'partyBills' },
  // Transport
  { name: 'transport_bills', order: ['created_at', 'id'], restore: true, part: 'transport' },
  { name: 'transport_payments', order: ['created_at', 'id'], restore: true, part: 'transport' },
  // Workers
  { name: 'workers', order: ['created_at', 'id'], restore: true, part: 'workers' },
  { name: 'worker_goods_issues', order: ['created_at', 'id'], restore: true, part: 'workers' },
  { name: 'worker_goods_returns', order: ['created_at', 'id'], restore: true, part: 'workers' },
  { name: 'worker_payments', order: ['created_at', 'id'], restore: true, part: 'workers' },
  // Names of the app's users, for "made by" columns. Passwords are never read.
  { name: 'app_user_list', order: ['id'], restore: false, part: 'full' },
];

export interface CollectedData {
  tables: Record<string, Row[]>;
  /** Tables this database does not have (their SQL file was never run). */
  missing: string[];
}

/** PostgREST's answer for a table it does not know. */
function isMissingTable(err: unknown): boolean {
  const { code, message = '' } = (err ?? {}) as { code?: string; message?: string };
  return code === 'PGRST205' || code === '42P01' || /could not find the table|does not exist/i.test(message);
}

async function fetchTable(table: BackupTable): Promise<Row[]> {
  return fetchAllRows<Row>((withCount) => {
    let query = assertSupabase()
      .from(table.name)
      .select('*', withCount ? { count: 'exact' } : undefined);
    for (const column of table.order) query = query.order(column, { ascending: true });
    return query;
  });
}

/** Every table, a few at a time so a slow phone connection is not swamped. */
export async function collectAll(onProgress?: (done: number, total: number) => void): Promise<CollectedData> {
  const tables: Record<string, Row[]> = {};
  const missing: string[] = [];
  let done = 0;
  const queue = [...BACKUP_TABLES];
  const worker = async () => {
    for (let table = queue.shift(); table; table = queue.shift()) {
      try {
        tables[table.name] = await fetchTable(table);
      } catch (err) {
        if (!isMissingTable(err)) throw err;
        missing.push(table.name);
        tables[table.name] = [];
      }
      onProgress?.(++done, BACKUP_TABLES.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { tables, missing };
}
