-- Run this in Supabase Dashboard → SQL Editor
-- Firm bills (purchases) + payments made against them, with photo storage.

-- 1. Bills from firms (suppliers)
create table if not exists public.purchase_bills (
  id text primary key,
  firm_name text not null,
  bill_no text not null,
  bill_date date,
  gst_number text not null default '',
  lr_no text not null default '',
  transport_name text not null default '',
  items jsonb not null default '[]',
  gross_amount numeric not null default 0,
  discount numeric not null default 0,
  net_amount numeric not null default 0,
  photo_url text,
  created_at timestamptz not null default now()
);

-- Safe to re-run: adds the columns if the table was created before they existed
alter table public.purchase_bills
  add column if not exists gst_number text not null default '';
alter table public.purchase_bills
  add column if not exists gst_amount numeric not null default 0;
alter table public.purchase_bills
  add column if not exists discounts jsonb not null default '[]';

alter table public.purchase_bills enable row level security;

drop policy if exists "purchase_bills_all" on public.purchase_bills;
create policy "purchase_bills_all" on public.purchase_bills
  for all using (true) with check (true);

-- 2. Payments made against those bills
create table if not exists public.bill_payments (
  id text primary key,
  bill_id text not null references public.purchase_bills(id) on delete cascade,
  paid_on date,
  amount numeric not null check (amount > 0),
  method text not null default 'Cash' check (method in ('Cash', 'Cheque', 'Bank transfer', 'UPI')),
  reference text not null default '',
  bank_name text not null default '',
  photo_url text,
  created_at timestamptz not null default now()
);

alter table public.bill_payments enable row level security;

drop policy if exists "bill_payments_all" on public.bill_payments;
create policy "bill_payments_all" on public.bill_payments
  for all using (true) with check (true);

create index if not exists bill_payments_bill_id_idx on public.bill_payments (bill_id);

-- 3. Storage bucket for bill photos and payment screenshots
insert into storage.buckets (id, name, public)
values ('bill-photos', 'bill-photos', true)
on conflict (id) do nothing;

drop policy if exists "bill_photos_read" on storage.objects;
create policy "bill_photos_read" on storage.objects
  for select using (bucket_id = 'bill-photos');

drop policy if exists "bill_photos_insert" on storage.objects;
create policy "bill_photos_insert" on storage.objects
  for insert with check (bucket_id = 'bill-photos');

drop policy if exists "bill_photos_delete" on storage.objects;
create policy "bill_photos_delete" on storage.objects
  for delete using (bucket_id = 'bill-photos');
