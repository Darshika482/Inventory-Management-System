import { Category, Floor, StockAddition, WithdrawalLog, User } from '../types';
import { DbAppUser, DbCategory, DbStockAddition, DbWithdrawalLog, supabase } from './supabase';

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel project settings.'
    );
  }
  return supabase;
}

function mapCategory(row: DbCategory): Category {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    floor: (row.floor === 'Second Floor' ? 'Second Floor' : 'First Floor') as Floor,
    initialStock: row.initial_stock,
    currentQuantity: row.current_quantity,
    createdAt: row.created_at,
  };
}

function mapLog(row: DbWithdrawalLog): WithdrawalLog {
  return {
    id: row.id,
    workerId: row.worker_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    quantity: row.quantity,
    timestamp: row.timestamp,
    status: row.status,
  };
}

function toCategoryRow(category: Category): DbCategory {
  return {
    id: category.id,
    name: category.name,
    unit: category.unit,
    floor: category.floor,
    initial_stock: category.initialStock,
    current_quantity: category.currentQuantity,
    created_at: category.createdAt,
  };
}

function toLogRow(log: WithdrawalLog): DbWithdrawalLog {
  return {
    id: log.id,
    worker_id: log.workerId,
    category_id: log.categoryId,
    category_name: log.categoryName,
    quantity: log.quantity,
    timestamp: log.timestamp,
    status: log.status,
  };
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await assertSupabase()
    .from('categories')
    .select('*')
    .order('name');

  if (error) throw error;
  return (data as DbCategory[]).map(mapCategory);
}

export async function fetchWithdrawalLogs(): Promise<WithdrawalLog[]> {
  const { data, error } = await assertSupabase()
    .from('withdrawal_logs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as DbWithdrawalLog[]).map(mapLog);
}

export async function fetchAppUsers(): Promise<DbAppUser[]> {
  const { data, error } = await assertSupabase().from('app_users').select('*').order('username');

  if (error) throw error;
  return data as DbAppUser[];
}

export async function fetchStaffUsers(): Promise<User[]> {
  const { data, error } = await assertSupabase()
    .from('app_users')
    .select('id, username, role')
    .eq('role', 'Worker')
    .order('username');

  if (error) throw error;
  return (data as Pick<DbAppUser, 'id' | 'username' | 'role'>[]).map((row) => ({
    id: row.id,
    username: row.username,
    role: row.role,
  }));
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<User | null> {
  const { data, error } = await assertSupabase()
    .from('app_users')
    .select('id, username, role, password_hash')
    .ilike('username', username.trim())
    .maybeSingle();

  if (error) throw error;
  if (!data || data.password_hash !== password) return null;

  return {
    id: data.id,
    username: data.username,
    role: data.role,
  };
}

export async function insertCategory(category: Category): Promise<void> {
  const { error } = await assertSupabase().from('categories').insert(toCategoryRow(category));
  if (error) throw error;
}

export async function updateCategoryInDb(category: Category): Promise<void> {
  const { error } = await assertSupabase()
    .from('categories')
    .update({
      name: category.name,
      unit: category.unit,
      floor: category.floor,
      initial_stock: category.initialStock,
      current_quantity: category.currentQuantity,
    })
    .eq('id', category.id);

  if (error) throw error;
}

export async function deleteCategoryFromDb(categoryId: string): Promise<void> {
  const { error } = await assertSupabase().from('categories').delete().eq('id', categoryId);
  if (error) throw error;
}

export async function updateCategoryNameInLogs(
  categoryId: string,
  categoryName: string
): Promise<void> {
  const { error } = await assertSupabase()
    .from('withdrawal_logs')
    .update({ category_name: categoryName })
    .eq('category_id', categoryId);

  if (error) throw error;
}

export async function insertWithdrawalLog(log: WithdrawalLog): Promise<void> {
  const { error } = await assertSupabase().from('withdrawal_logs').insert(toLogRow(log));
  if (error) throw error;
}

export async function updateWithdrawalLogStatus(
  logId: string,
  status: WithdrawalLog['status']
): Promise<void> {
  const { error } = await assertSupabase()
    .from('withdrawal_logs')
    .update({ status })
    .eq('id', logId);

  if (error) throw error;
}

// Stock additions

function mapStockAddition(row: DbStockAddition): StockAddition {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    quantity: row.quantity,
    floor: (row.floor === 'Second Floor' ? 'Second Floor' : 'First Floor') as Floor,
    unit: row.unit,
    type: row.type,
    timestamp: row.timestamp,
    createdAt: row.created_at,
  };
}

function toStockAdditionRow(entry: StockAddition): DbStockAddition {
  return {
    id: entry.id,
    category_id: entry.categoryId,
    category_name: entry.categoryName,
    quantity: entry.quantity,
    floor: entry.floor,
    unit: entry.unit,
    type: entry.type,
    timestamp: entry.timestamp,
    created_at: entry.createdAt,
  };
}

export async function fetchStockAdditions(): Promise<StockAddition[]> {
  try {
    const { data, error } = await assertSupabase()
      .from('stock_additions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01' || error.message?.includes('404')) return [];
      throw error;
    }
    return (data as DbStockAddition[]).map(mapStockAddition);
  } catch {
    return [];
  }
}

export async function insertStockAddition(entry: StockAddition): Promise<void> {
  try {
    const { error } = await assertSupabase()
      .from('stock_additions')
      .insert(toStockAdditionRow(entry));
    if (error && error.code !== '42P01') {
      console.warn('Could not log stock addition:', error.message);
    }
  } catch {
    // Table may not exist yet — silently skip
  }
}
