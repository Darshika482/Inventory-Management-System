-- Run in Supabase SQL Editor to add floor support to existing categories table
-- https://supabase.com/dashboard/project/qcbpztehbutwlbwjykoy/sql

alter table public.categories
add column if not exists floor text not null default 'First Floor';

alter table public.categories
drop constraint if exists categories_floor_check;

alter table public.categories
add constraint categories_floor_check
check (floor in ('First Floor', 'Second Floor'));

-- Set any null/empty values to First Floor (safety)
update public.categories
set floor = 'First Floor'
where floor is null or floor = '';
