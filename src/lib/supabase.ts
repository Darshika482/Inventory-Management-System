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
