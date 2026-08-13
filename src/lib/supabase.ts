import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export type DbCategory = {
  id: string;
  name: string;
  unit: string;
  floor: string;
  initial_stock: number;
  current_quantity: number;
  created_at: string;
};

export type DbWithdrawalLog = {
  id: string;
  worker_id: string;
  category_id: string;
  category_name: string;
  quantity: number;
  timestamp: string;
  status: 'Approved' | 'Rejected';
};

export type DbAppUser = {
  id: string;
  username: string;
  role: 'Admin' | 'Worker';
  password_hash: string;
};

export type DbStockAddition = {
  id: string;
  category_id: string;
  category_name: string;
  quantity: number;
  floor: string;
  unit: string;
  type: 'new' | 'restock';
  timestamp: string;
  created_at: string;
};

export type DbPurchaseBill = {
  id: string;
  firm_name: string;
  bill_no: string;
  bill_date: string | null;
  gst_number: string;
  lr_no: string;
  transport_name: string;
  items: { name: string; quantity: number; unit?: string; rate: number; amount: number }[];
  gross_amount: number;
  discounts: { name: string; amount: number }[];
  discount: number;
  gst_amount: number;
  net_amount: number;
  photo_url: string | null;
  created_at: string;
};

export type DbWorker = {
  id: string;
  name: string;
  type: 'Shop' | 'Job work';
  phone: string;
  monthly_salary: number;
  note: string;
  created_at: string;
};

export type DbGoodsItem = { item: string; quantity: number; unit: string };

export type DbGoodsIssue = {
  id: string;
  worker_id: string;
  issued_on: string | null;
  items: DbGoodsItem[];
  note: string;
  created_at: string;
  // Legacy single-item columns, present on tables created before `items` existed
  item?: string | null;
  quantity?: number | null;
  unit?: string | null;
};

export type DbGoodsReturn = {
  id: string;
  worker_id: string;
  returned_on: string | null;
  items: DbGoodsItem[];
  meters_used: number;
  rate: number;
  amount: number;
  note: string;
  created_at: string;
  // Legacy single-item columns, present on tables created before `items` existed
  item?: string | null;
  quantity?: number | null;
  unit?: string | null;
};

export type DbWorkerPayment = {
  id: string;
  worker_id: string;
  paid_on: string | null;
  amount: number;
  method: 'Cash' | 'Cheque' | 'Bank transfer' | 'UPI';
  reference: string;
  bank_name: string;
  photo_url: string | null;
  note: string;
  created_at: string;
};

export type DbTransportBill = {
  id: string;
  received_date: string | null;
  transport_name: string;
  item: string;
  weight: string;
  bilty_no: string;
  party_name: string;
  amount: number;
  photo_url: string | null;
  created_at: string;
};

export type DbItemGroup = {
  id: string;
  name: string;
  members: string[];
  created_at: string;
};

export type DbBillPayment = {
  id: string;
  bill_id: string;
  paid_on: string | null;
  amount: number;
  method: 'Cash' | 'Cheque' | 'Bank transfer' | 'UPI';
  reference: string;
  bank_name: string;
  photo_url: string | null;
  created_at: string;
};
