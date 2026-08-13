-- Run this in Supabase Dashboard → SQL Editor
-- Transport bills (bilty / freight charges) + payments made against them.
-- Photos reuse the existing `bill-photos` storage bucket
-- (created by add-purchase-bills.sql).

-- 1. Transport bills (bilty for parcels that arrived)
create table if not exists public.transport_bills (
  id text primary key,
  received_date date,
  transport_name text not null,
  item text not null default '',
  weight text not null default '',
  bilty_no text not null default '',
  party_name text not null default '',
  amount numeric not null default 0,
  photo_url text,
  created_at timestamptz not null default now()
);

alter table public.transport_bills enable row level security;

drop policy if exists "transport_bills_all" on public.transport_bills;
create policy "transport_bills_all" on public.transport_bills
  for all using (true) with check (true);

-- 2. Payments made against those bills
create table if not exists public.transport_payments (
  id text primary key,
  bill_id text not null references public.transport_bills(id) on delete cascade,
  paid_on date,
  amount numeric not null check (amount > 0),
  method text not null default 'Cash' check (method in ('Cash', 'Cheque', 'Bank transfer', 'UPI')),
  reference text not null default '',
  bank_name text not null default '',
  photo_url text,
  created_at timestamptz not null default now()
);

alter table public.transport_payments enable row level security;

drop policy if exists "transport_payments_all" on public.transport_payments;
create policy "transport_payments_all" on public.transport_payments
  for all using (true) with check (true);

create index if not exists transport_payments_bill_id_idx on public.transport_payments (bill_id);
