-- Run this in Supabase Dashboard → SQL Editor
-- https://supabase.com/dashboard/project/qcbpztehbutwlbwjykoy/sql

create table if not exists public.categories (
  id text primary key,
  name text not null,
  unit text not null default 'pieces',
  floor text not null default 'First Floor' check (floor in ('First Floor', 'Second Floor')),
  initial_stock integer not null default 0 check (initial_stock >= 0),
  current_quantity integer not null default 0 check (current_quantity >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawal_logs (
  id text primary key,
  worker_id text not null,
  category_id text not null,
  category_name text not null,
  quantity integer not null check (quantity > 0),
  timestamp text not null,
  status text not null check (status in ('Approved', 'Rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  role text not null check (role in ('Admin', 'Worker')),
  password_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;
alter table public.withdrawal_logs enable row level security;
alter table public.app_users enable row level security;

drop policy if exists "categories_all" on public.categories;
create policy "categories_all" on public.categories for all using (true) with check (true);

drop policy if exists "withdrawal_logs_all" on public.withdrawal_logs;
create policy "withdrawal_logs_all" on public.withdrawal_logs for all using (true) with check (true);

drop policy if exists "app_users_select" on public.app_users;
create policy "app_users_select" on public.app_users for select using (true);

insert into public.app_users (username, role, password_hash) values
  ('akhilesh', 'Admin', 'akshay348'),
  ('ayush', 'Worker', 'ayush724'),
  ('mohit', 'Worker', 'mohit591')
on conflict (username) do nothing;
