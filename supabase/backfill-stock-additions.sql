-- Run this ONCE in Supabase Dashboard → SQL Editor
-- Backfills stock_additions from existing categories so past items show up

insert into public.stock_additions (id, category_id, category_name, quantity, floor, unit, type, timestamp, created_at)
select
  'sa-backfill-' || id,
  id,
  name,
  initial_stock,
  floor,
  unit,
  'new',
  to_char(created_at at time zone 'Asia/Kolkata', 'Mon DD, YYYY') || ' at ' ||
    to_char(created_at at time zone 'Asia/Kolkata', 'HH12:MI AM'),
  created_at
from public.categories
where initial_stock > 0
on conflict (id) do nothing;
