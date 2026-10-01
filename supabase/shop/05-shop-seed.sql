-- Run this in Supabase Dashboard → SQL Editor, after 04-shop-policies.sql.
-- Main shop sales module, file 5 of 5: starting data.
-- Safe to re-run: existing shop details and counters are left as they are.

insert into public.shop_settings (id, shop_name, state_code)
values (1, 'Akshay Traders', '23')
on conflict (id) do nothing;

-- Sale counter for the current financial year (India time), series A.
insert into public.shop_counters (bill_type, fy, series, last_number)
values ('sale', public.shop_fy_for((now() at time zone 'Asia/Kolkata')::date), 'A', 0)
on conflict (bill_type, fy, series) do nothing;
