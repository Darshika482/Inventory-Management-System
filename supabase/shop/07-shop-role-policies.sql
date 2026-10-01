-- Run this in Supabase Dashboard → SQL Editor, after 06-secure-sign-in.sql.
-- Main shop sales module, file 7: who may see and change what. Safe to re-run.
--
-- Owner (Admin): everything.
-- Staff (Worker): make sales, add customers, take payments, print, and see
--   today's bills and payments. Cannot change items, rates, settings or saved
--   bills, and cannot see older bills, profit or the audit log.
--
-- Bills and payments are never written to the tables directly: the save,
-- cancel and payment functions check the role and the numbers first.
-- The godown stock tables are not touched here.

-- Today in India
create or replace function public.shop_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- Remove the earlier open rules (from the first version of file 4).
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
     where schemaname = 'public' and tablename like 'shop\_%'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Shop details
create policy "shop_settings_read" on public.shop_settings
  for select using (public.app_role() is not null);
create policy "shop_settings_owner_update" on public.shop_settings
  for update using (public.app_role() = 'owner') with check (public.app_role() = 'owner');

-- Categories and items: everyone signed in reads, the owner changes.
create policy "shop_categories_read" on public.shop_categories
  for select using (public.app_role() is not null);
create policy "shop_categories_owner_write" on public.shop_categories
  for all using (public.app_role() = 'owner') with check (public.app_role() = 'owner');

create policy "shop_items_read" on public.shop_items
  for select using (public.app_role() is not null);
create policy "shop_items_owner_write" on public.shop_items
  for all using (public.app_role() = 'owner') with check (public.app_role() = 'owner');

-- Customers: staff can add (quick add on the bill), only the owner changes.
create policy "shop_parties_read" on public.shop_parties
  for select using (public.app_role() is not null);
create policy "shop_parties_add" on public.shop_parties
  for insert with check (public.app_role() is not null);
create policy "shop_parties_owner_update" on public.shop_parties
  for update using (public.app_role() = 'owner') with check (public.app_role() = 'owner');

-- Bill number counters: read to start a phone's numbering.
create policy "shop_counters_read" on public.shop_counters
  for select using (public.app_role() is not null);

-- Bills, lines and payments: owner sees all, staff sees today's.
create policy "shop_invoices_read" on public.shop_invoices
  for select using (
    public.app_role() = 'owner'
    or (public.app_role() = 'staff' and bill_date = public.shop_today())
  );

create policy "shop_invoice_items_read" on public.shop_invoice_items
  for select using (exists (select 1 from public.shop_invoices i where i.id = invoice_id));

create policy "shop_payments_read" on public.shop_payments
  for select using (
    public.app_role() = 'owner'
    or (public.app_role() = 'staff' and payment_date = public.shop_today())
  );

-- Owner only
create policy "shop_audit_log_owner_read" on public.shop_audit_log
  for select using (public.app_role() = 'owner');
create policy "shop_monthly_summary_owner_read" on public.shop_monthly_summary
  for select using (public.app_role() = 'owner');
create policy "shop_backup_log_owner_read" on public.shop_backup_log
  for select using (public.app_role() = 'owner');

-- Numbers are handed out only inside the save functions.
revoke execute on function public.shop_next_bill_number(text, text, text) from public, anon, authenticated;
