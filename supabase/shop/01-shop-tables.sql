-- Run this in Supabase Dashboard → SQL Editor.
-- Main shop sales module, file 1 of 5: tables and indexes.
-- Run the files in supabase/shop/ in number order. Every file is safe to re-run.
--
-- The main shop does NOT track stock. Every table here starts with `shop_` and
-- nothing in this module reads or writes the godown stock tables
-- (categories, withdrawal_logs, stock_additions).
--
-- Needs public.app_users (from schema.sql): bills and audit rows record which
-- app user made them.

-- 1. Shop details (always exactly one row, id = 1)
create table if not exists public.shop_settings (
  id int primary key default 1 check (id = 1),
  shop_name text not null,
  address text not null default '',
  phone text not null default '',
  gstin text not null default '',
  state_code text not null default '23',              -- 23 = Madhya Pradesh
  upi_id text not null default '',
  logo_url text,
  printer_width_mm int not null default 58 check (printer_width_mm in (58, 80)),
  rates_include_gst boolean not null default true,
  receipt_footer text not null default 'Dhanyavaad! Phir padhariye.',
  language text not null default 'hi' check (language in ('hi', 'en')),
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 2. Item categories, shown in this order in the item picker
create table if not exists public.shop_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_hi text not null default '',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3. Items sold in the shop (price list only, no stock)
create table if not exists public.shop_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.shop_categories(id) on delete set null,
  name text not null,
  name_hi text not null default '',
  unit text not null default 'pcs',
  sale_rate numeric(12,2) not null default 0 check (sale_rate >= 0),
  purchase_rate numeric(12,2) not null default 0 check (purchase_rate >= 0), -- updated from latest purchase bill
  gst_rate numeric(5,2) not null default 0 check (gst_rate in (0, 5, 12, 18, 28)),
  hsn text not null default '',
  is_active boolean not null default true,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Customers and suppliers. Balance is always worked out from bills and
--    payments; only the opening balance is typed in.
create table if not exists public.shop_parties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  address text not null default '',
  gstin text not null default '',
  state_code text not null default '23',
  party_type text not null default 'customer' check (party_type in ('customer', 'supplier', 'both')),
  opening_balance numeric(12,2) not null default 0,   -- positive = they owe us
  carried_balance numeric(12,2) not null default 0,   -- filled only by backup archival
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Last bill number used, per bill type, financial year and device series.
--    Each billing device has its own series letter (A, B, ...) so it can
--    number bills without internet and never clash with another device.
create table if not exists public.shop_counters (
  bill_type text not null check (bill_type in ('sale', 'purchase', 'quotation')),
  fy text not null,                                   -- e.g. '2026-27'
  series text not null default 'A' check (series ~ '^[A-Z]$'),
  last_number int not null default 0 check (last_number >= 0),
  primary key (bill_type, fy, series)
);

-- 6. Bills (sale now; purchase and quotation later share this table)
create table if not exists public.shop_invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique not null,                     -- made on the device; a repeated sync cannot save twice
  bill_type text not null check (bill_type in ('sale', 'purchase', 'quotation')),
  series text not null default 'A' check (series ~ '^[A-Z]$'),
  bill_number text,                                   -- e.g. 'S-A/2026-27/0042'
  fy text not null,
  bill_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  party_id uuid references public.shop_parties(id),   -- null = walk-in cash sale
  party_name text not null default '',                -- as it was on the bill
  party_gstin text not null default '',               -- as it was on the bill
  is_gst boolean not null default false,
  is_interstate boolean not null default false,
  rates_include_gst boolean not null default true,    -- how the rates on this bill were typed
  payment_mode text not null check (payment_mode in ('cash', 'upi', 'credit', 'partial')),
  paid_mode text check (paid_mode in ('cash', 'upi')),-- how the paid part of a partial bill was paid
  subtotal numeric(12,2) not null default 0,          -- taxable value, after discount
  discount numeric(12,2) not null default 0,
  discount_percent numeric(5,2),                      -- set when the discount was typed as a %
  cgst numeric(12,2) not null default 0,
  sgst numeric(12,2) not null default 0,
  igst numeric(12,2) not null default 0,
  round_off numeric(6,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  converted_from uuid references public.shop_invoices(id),
  notes text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7. Lines on a bill. Name, HSN, unit and rates are copied onto the line so
--    an old bill never changes when the item is edited later.
create table if not exists public.shop_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.shop_invoices(id) on delete cascade,
  line_no int not null default 0,
  item_id uuid references public.shop_items(id) on delete set null,
  item_name text not null,
  hsn text not null default '',
  unit text not null default '',
  qty numeric(12,3) not null check (qty > 0),
  rate numeric(12,2) not null check (rate >= 0),      -- rate actually used on this bill
  gst_rate numeric(5,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,   -- this line's share of the bill discount
  taxable_amount numeric(12,2) not null,
  tax_amount numeric(12,2) not null default 0,
  line_total numeric(12,2) not null,                  -- taxable + tax
  cost_rate numeric(12,2) not null                    -- purchase rate when sold; filled by trigger when left out
);

-- 8. Money received from / paid to parties
create table if not exists public.shop_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique not null,
  party_id uuid not null references public.shop_parties(id),
  invoice_id uuid references public.shop_invoices(id), -- null = on account
  direction text not null check (direction in ('in', 'out')),
  amount numeric(12,2) not null check (amount > 0),
  mode text not null check (mode in ('cash', 'upi', 'bank', 'cheque')),
  payment_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  note text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 9. Every change to a saved bill, payment or item
create table if not exists public.shop_audit_log (
  id bigserial primary key,
  table_name text not null,
  record_id uuid not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  user_id uuid,
  created_at timestamptz not null default now()
);

-- 10. Month totals kept when old bills are archived (used by the backup, later)
create table if not exists public.shop_monthly_summary (
  month date primary key,                             -- first day of the month
  sale_total numeric(14,2),
  purchase_total numeric(14,2),
  output_gst numeric(14,2),
  input_gst numeric(14,2),
  gross_profit numeric(14,2),
  sale_bill_count int,
  item_totals jsonb
);

-- 11. Result of every monthly backup (used by the backup, later)
create table if not exists public.shop_backup_log (
  id bigserial primary key,
  period_start date not null,
  period_end date not null,
  row_counts jsonb not null,
  files jsonb,
  status text not null check (status in ('success', 'failed')),
  error text,
  rows_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists shop_items_category_id_idx on public.shop_items (category_id);
create index if not exists shop_invoices_bill_date_idx on public.shop_invoices (bill_date);
create index if not exists shop_invoices_party_id_idx on public.shop_invoices (party_id);
create index if not exists shop_invoices_type_status_idx on public.shop_invoices (bill_type, status);
create index if not exists shop_invoice_items_invoice_id_idx on public.shop_invoice_items (invoice_id);
create index if not exists shop_invoice_items_item_id_idx on public.shop_invoice_items (item_id);
create index if not exists shop_payments_party_id_idx on public.shop_payments (party_id);
create index if not exists shop_payments_invoice_id_idx on public.shop_payments (invoice_id);
create index if not exists shop_audit_log_record_idx on public.shop_audit_log (table_name, record_id);

-- GST rule: bill numbers are unique within a bill type and financial year.
create unique index if not exists shop_invoices_bill_number_uniq
  on public.shop_invoices (bill_type, fy, bill_number)
  where bill_number is not null;
