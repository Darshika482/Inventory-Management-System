-- Run this in Supabase Dashboard → SQL Editor
-- 1. Lets one payment cover several bills of the same party.
-- 2. Stops the same bill number being saved twice for the same party.
-- Safe to re-run.

-- 1. Combined payments: every bill's share carries the same group_id
alter table public.bill_payments
  add column if not exists group_id text;

create index if not exists bill_payments_group_id_idx on public.bill_payments (group_id);

-- 2. No duplicate bill numbers per party.
-- The app already blocks duplicates; this is a second guard in the database.
-- It is only created when the existing bills have no duplicates — if they do,
-- a notice lists them. Remove or correct those bills, then run this again.
do $$
declare
  dupes text;
begin
  select string_agg(format('%s / bill %s (%s times)', firm, bill, n), E'\n')
    into dupes
  from (
    select min(firm_name) as firm, min(bill_no) as bill, count(*) as n
    from public.purchase_bills
    group by lower(btrim(firm_name)), lower(replace(bill_no, ' ', ''))
    having count(*) > 1
  ) d;

  if dupes is null then
    create unique index if not exists purchase_bills_party_bill_no_uniq
      on public.purchase_bills (lower(btrim(firm_name)), lower(replace(bill_no, ' ', '')));
  else
    raise notice E'Duplicate bill numbers found, unique rule NOT added yet:\n%', dupes;
  end if;
end $$;
