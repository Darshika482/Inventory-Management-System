-- Run this in Supabase Dashboard → SQL Editor
-- Workers (shop salary + job work), the goods given to job workers,
-- the finished pieces they bring back, and every payment made to them.
-- Payment photos reuse the existing `bill-photos` storage bucket
-- (created by add-purchase-bills.sql).

-- 1. Workers
create table if not exists public.workers (
  id text primary key,
  name text not null,
  type text not null default 'Shop' check (type in ('Shop', 'Job work')),
  phone text not null default '',
  monthly_salary numeric not null default 0,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.workers enable row level security;

drop policy if exists "workers_all" on public.workers;
create policy "workers_all" on public.workers
  for all using (true) with check (true);

-- 2. Cloth / raw material given to job workers.
--    One row is one transaction; `items` holds every item given that day,
--    e.g. [{"item": "Cotton cloth", "quantity": 500, "unit": "Meter"}].
create table if not exists public.worker_goods_issues (
  id text primary key,
  worker_id text not null references public.workers(id) on delete cascade,
  issued_on date,
  items jsonb not null default '[]',
  note text not null default '',
  created_at timestamptz not null default now()
);

-- Safe to re-run: upgrades tables created before multi-item transactions.
-- Old single-item columns stay readable but are no longer required.
alter table public.worker_goods_issues
  add column if not exists items jsonb not null default '[]';
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'worker_goods_issues' and column_name = 'item'
  ) then
    alter table public.worker_goods_issues alter column item drop not null;
  end if;
end $$;

alter table public.worker_goods_issues enable row level security;

drop policy if exists "worker_goods_issues_all" on public.worker_goods_issues;
create policy "worker_goods_issues_all" on public.worker_goods_issues
  for all using (true) with check (true);

create index if not exists worker_goods_issues_worker_id_idx
  on public.worker_goods_issues (worker_id);

-- 3. Finished pieces (falls) brought back, with the wage earned.
--    One row is one transaction; `items` holds every item brought back,
--    e.g. [{"item": "Falls", "quantity": 40, "unit": "Dozen"}].
--    Falls are counted in dozens; the wage is paid on the meters of
--    cloth worked (`meters_used` × `rate` per meter).
create table if not exists public.worker_goods_returns (
  id text primary key,
  worker_id text not null references public.workers(id) on delete cascade,
  returned_on date,
  items jsonb not null default '[]',
  meters_used numeric not null default 0,
  rate numeric not null default 0,
  amount numeric not null default 0,
  note text not null default '',
  created_at timestamptz not null default now()
);

-- Safe to re-run: upgrades tables created before these columns existed.
alter table public.worker_goods_returns
  add column if not exists meters_used numeric not null default 0;
alter table public.worker_goods_returns
  add column if not exists items jsonb not null default '[]';
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'worker_goods_returns' and column_name = 'item'
  ) then
    alter table public.worker_goods_returns alter column item drop not null;
  end if;
end $$;

alter table public.worker_goods_returns enable row level security;

drop policy if exists "worker_goods_returns_all" on public.worker_goods_returns;
create policy "worker_goods_returns_all" on public.worker_goods_returns
  for all using (true) with check (true);

create index if not exists worker_goods_returns_worker_id_idx
  on public.worker_goods_returns (worker_id);

-- 4. Money given to workers (salary, wages, advances)
create table if not exists public.worker_payments (
  id text primary key,
  worker_id text not null references public.workers(id) on delete cascade,
  paid_on date,
  amount numeric not null check (amount > 0),
  method text not null default 'Cash' check (method in ('Cash', 'Cheque', 'Bank transfer', 'UPI')),
  reference text not null default '',
  bank_name text not null default '',
  photo_url text,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.worker_payments enable row level security;

drop policy if exists "worker_payments_all" on public.worker_payments;
create policy "worker_payments_all" on public.worker_payments
  for all using (true) with check (true);

create index if not exists worker_payments_worker_id_idx
  on public.worker_payments (worker_id);
