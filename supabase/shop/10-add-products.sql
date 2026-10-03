-- Run this in Supabase Dashboard → SQL Editor.
-- Adds the 21 products from the shop's price list (Thread, Activa, Bahurani,
-- Blouse, Aster, Fall, Dollar, Dori, Fancy, Femina), creating any category that
-- is missing. Safe to re-run: a category or item whose name is already there
-- (any capitals) is left as it is. Nothing is deleted or changed.

-- 0. What is in the shop now (look at this first: if these numbers are not 0,
--    your items are still there and the app just could not see them).
select
  (select count(*) from public.shop_categories) as categories_before,
  (select count(*) from public.shop_items) as items_before;

do $$
declare
  -- name, category, unit, sale rate, purchase rate
  products text[][] := array[
    ['150 mt. Thread',   'Thread',   'pcs',   '0',    '0'],
    ['300mt Thread',     'Thread',   'pcs',   '350',  '330'],
    ['800mt Thread',     'Thread',   'pcs',   '350',  '330'],
    ['Activa 1Mt.',      'Activa',   'metre', '25',   '0'],
    ['Activa pcs',       'Activa',   'pcs',   '17.5', '14.6'],
    ['Activa Than',      'Activa',   'pcs',   '23',   '0'],
    ['Bahurani pcs',     'Bahurani', 'pcs',   '17.5', '14.6'],
    ['Bahurani Than',    'Bahurani', 'pcs',   '24.5', '19'],
    ['Blouse',           'Blouse',   'pcs',   '90',   '0'],
    ['Cotton Aster',     'Aster',    'pcs',   '38',   '34'],
    ['Cotton Fall',      'Fall',     'pcs',   '130',  '125'],
    ['Dollar SF Pack',   'Dollar',   'pcs',   '35',   '28'],
    ['Dollar Than',      'Dollar',   'pcs',   '46',   '0'],
    ['Dollar Vijaydeep', 'Dollar',   'pcs',   '35',   '28'],
    ['Dori',             'Dori',     'pcs',   '15',   '0'],
    ['Fancy 1',          'Fancy',    'pcs',   '65',   '36'],
    ['Fancy 2',          'Fancy',    'pcs',   '23',   '0'],
    ['Fancy Fur',        'Fancy',    'pcs',   '70',   '0'],
    ['Fancy pcs',        'Fancy',    'pcs',   '70',   '0'],
    ['FancyNett',        'Fancy',    'pcs',   '30',   '0'],
    ['Femina pcs',       'Femina',   'pcs',   '12',   '0']
  ];
  p text[];
  v_cat uuid;
  v_order int;
  v_new_cats int := 0;
  v_new_items int := 0;
begin
  foreach p slice 1 in array products loop
    -- Category: the existing one with this name, else a new one at the end.
    select id into v_cat from public.shop_categories where lower(btrim(name)) = lower(p[2]) limit 1;
    if v_cat is null then
      select coalesce(max(sort_order), -1) + 1 into v_order from public.shop_categories;
      insert into public.shop_categories (name, sort_order) values (p[2], v_order) returning id into v_cat;
      v_new_cats := v_new_cats + 1;
    end if;

    -- Item: only if no item has this name yet.
    if not exists (select 1 from public.shop_items where lower(btrim(name)) = lower(p[1])) then
      insert into public.shop_items (category_id, name, unit, sale_rate, purchase_rate)
      values (v_cat, p[1], p[3], p[4]::numeric, p[5]::numeric);
      v_new_items := v_new_items + 1;
    end if;
  end loop;
  raise notice 'Added % new categories and % new items.', v_new_cats, v_new_items;
end;
$$;

-- What is in the shop after.
select
  (select count(*) from public.shop_categories) as categories_after,
  (select count(*) from public.shop_items) as items_after;
