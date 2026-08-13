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
