import {
  BillPayment,
  Category,
  Floor,
  PurchaseBill,
  StockAddition,
  WithdrawalLog,
  User,
} from '../types';
import {
  DbAppUser,
  DbBillPayment,
  DbCategory,
  DbPurchaseBill,
  DbStockAddition,
  DbWithdrawalLog,
  supabase,
} from './supabase';

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

// Firm bills (purchases) & payments

function mapPurchaseBill(row: DbPurchaseBill): PurchaseBill {
  return {
    id: row.id,
    firmName: row.firm_name,
    billNo: row.bill_no,
    billDate: row.bill_date ?? '',
    lrNo: row.lr_no ?? '',
    transportName: row.transport_name ?? '',
    items: Array.isArray(row.items)
      ? row.items.map((item) => ({
          name: item.name ?? '',
          quantity: Number(item.quantity) || 0,
          rate: Number(item.rate) || 0,
          amount: Number(item.amount) || 0,
        }))
      : [],
    grossAmount: Number(row.gross_amount) || 0,
    discount: Number(row.discount) || 0,
    netAmount: Number(row.net_amount) || 0,
    photoUrl: row.photo_url,
    createdAt: row.created_at,
  };
}

function toPurchaseBillRow(bill: PurchaseBill): DbPurchaseBill {
  return {
    id: bill.id,
    firm_name: bill.firmName,
    bill_no: bill.billNo,
    bill_date: bill.billDate || null,
    lr_no: bill.lrNo,
    transport_name: bill.transportName,
    items: bill.items,
    gross_amount: bill.grossAmount,
    discount: bill.discount,
    net_amount: bill.netAmount,
    photo_url: bill.photoUrl,
    created_at: bill.createdAt,
  };
}

function mapBillPayment(row: DbBillPayment): BillPayment {
  return {
    id: row.id,
    billId: row.bill_id,
    paidOn: row.paid_on ?? '',
    amount: Number(row.amount) || 0,
    method: row.method,
    reference: row.reference ?? '',
    bankName: row.bank_name ?? '',
    photoUrl: row.photo_url,
    createdAt: row.created_at,
  };
}

function toBillPaymentRow(payment: BillPayment): DbBillPayment {
  return {
    id: payment.id,
    bill_id: payment.billId,
    paid_on: payment.paidOn || null,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference,
    bank_name: payment.bankName,
    photo_url: payment.photoUrl,
    created_at: payment.createdAt,
  };
}

export async function fetchPurchaseBills(): Promise<PurchaseBill[]> {
  const { data, error } = await assertSupabase()
    .from('purchase_bills')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as DbPurchaseBill[]).map(mapPurchaseBill);
}

export async function fetchBillPayments(): Promise<BillPayment[]> {
  const { data, error } = await assertSupabase()
    .from('bill_payments')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as DbBillPayment[]).map(mapBillPayment);
}

export async function insertPurchaseBill(bill: PurchaseBill): Promise<void> {
  const { error } = await assertSupabase()
    .from('purchase_bills')
    .insert(toPurchaseBillRow(bill));
  if (error) throw error;
}

export async function deletePurchaseBillFromDb(billId: string): Promise<void> {
  const { error } = await assertSupabase().from('purchase_bills').delete().eq('id', billId);
  if (error) throw error;
}

export async function insertBillPayment(payment: BillPayment): Promise<void> {
  const { error } = await assertSupabase()
    .from('bill_payments')
    .insert(toBillPaymentRow(payment));
  if (error) throw error;
}

export async function deleteBillPaymentFromDb(paymentId: string): Promise<void> {
  const { error } = await assertSupabase().from('bill_payments').delete().eq('id', paymentId);
  if (error) throw error;
}

/**
 * Uploads a bill photo / payment screenshot to the `bill-photos` bucket.
 * Returns the public URL, or null if the upload failed (the record can still
 * be saved without a photo).
 */
export async function uploadBillPhoto(file: File, folder: 'bills' | 'payments'): Promise<string | null> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${folder}/${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
    const { error } = await assertSupabase()
      .storage.from('bill-photos')
      .upload(path, file, { contentType: file.type || 'image/jpeg' });

    if (error) {
      console.warn('Could not upload photo:', error.message);
      return null;
    }

    const { data } = assertSupabase().storage.from('bill-photos').getPublicUrl(path);
    return data.publicUrl ?? null;
  } catch {
    return null;
  }
}
