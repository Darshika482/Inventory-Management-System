-- Run this in Supabase Dashboard → SQL Editor
-- Tracks every stock addition event (new items + restocking)

create table if not exists public.stock_additions (
  id text primary key,
  category_id text not null,
  category_name text not null,
  quantity integer not null check (quantity > 0),
  floor text not null check (floor in ('First Floor', 'Second Floor')),
  unit text not null default 'pieces',
  type text not null check (type in ('new', 'restock')),
  timestamp text not null,
  created_at timestamptz not null default now()
);

alter table public.stock_additions enable row level security;

drop policy if exists "stock_additions_all" on public.stock_additions;
create policy "stock_additions_all" on public.stock_additions
  for all using (true) with check (true);
