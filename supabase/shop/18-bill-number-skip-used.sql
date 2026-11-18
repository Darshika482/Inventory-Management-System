-- Run this in Supabase Dashboard → SQL Editor, after 17-backup-restore.sql.
-- Bill uploads, file 18. Safe to re-run.
--
-- Why: a bill whose number was already used (two phones on the same series
-- letter, or bills put back by a restore) was refused on every upload. The app
-- now sends such a bill again without its number, and the server hands out the
-- next number. This makes sure that number is really free: when the counter
-- has fallen behind the bills, it jumps over the numbers already used.

create or replace function public.shop_next_bill_number(p_bill_type text, p_fy text, p_series text default 'A')
returns text
language plpgsql
as $$
declare
  n int;
  v_number text;
begin
  insert into public.shop_counters (bill_type, fy, series, last_number)
  values (p_bill_type, p_fy, p_series, 0)
  on conflict (bill_type, fy, series) do nothing;

  -- The UPDATE locks the counter row, so two calls can never get the same number.
  loop
    update public.shop_counters
       set last_number = last_number + 1
     where bill_type = p_bill_type and fy = p_fy and series = p_series
    returning last_number into n;

    v_number := public.shop_bill_prefix(p_bill_type) || '-' || p_series || '/' || p_fy || '/' || lpad(n::text, 4, '0');

    exit when not exists (
      select 1 from public.shop_invoices
       where bill_type = p_bill_type and fy = p_fy and bill_number = v_number
    );
  end loop;

  return v_number;
end;
$$;

-- Only the save functions hand out numbers (as in 07-shop-role-policies.sql).
revoke execute on function public.shop_next_bill_number(text, text, text) from public, anon, authenticated;

-- Counters that fell behind their bills catch up now.
update public.shop_counters c
   set last_number = m.max_number
  from (
    select bill_type, fy, series, max(split_part(bill_number, '/', 3)::int) as max_number
      from public.shop_invoices
     where bill_number ~ '/[0-9]+$'
     group by bill_type, fy, series
  ) m
 where c.bill_type = m.bill_type and c.fy = m.fy and c.series = m.series
   and c.last_number < m.max_number;
