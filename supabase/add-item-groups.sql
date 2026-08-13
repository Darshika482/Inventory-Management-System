-- Run this in Supabase Dashboard → SQL Editor
-- Combines different spellings of the same item on bills (e.g. "Dyed Cloth CT L Titan"
-- and "Dyed Cloth Titan") into one item for the rate analysis page.

create table if not exists public.item_groups (
  id text primary key,
  name text not null,
  -- Normalized (lowercased, single-spaced) bill item names that belong to this group
  members jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.item_groups enable row level security;

drop policy if exists "item_groups_all" on public.item_groups;
create policy "item_groups_all" on public.item_groups
  for all using (true) with check (true);
