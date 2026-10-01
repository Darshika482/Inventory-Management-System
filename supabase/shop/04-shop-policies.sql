-- Run this in Supabase Dashboard → SQL Editor, after 03-shop-triggers.sql.
-- Main shop sales module, file 4 of 5: row level security.
-- Safe to re-run.
--
-- KNOWN GAP (agreed for Phase 1): the app signs people in against app_users,
-- not Supabase Auth, so the database cannot tell the owner from staff. These
-- policies match the rest of the app (open to the app key); owner-only actions
-- are hidden in the app instead. Before Phase 3, sign-in moves to Supabase
-- Auth and these policies get replaced with real owner / staff rules.

alter table public.shop_settings enable row level security;
alter table public.shop_categories enable row level security;
alter table public.shop_items enable row level security;
alter table public.shop_parties enable row level security;
alter table public.shop_counters enable row level security;
alter table public.shop_invoices enable row level security;
alter table public.shop_invoice_items enable row level security;
alter table public.shop_payments enable row level security;
alter table public.shop_audit_log enable row level security;
alter table public.shop_monthly_summary enable row level security;
alter table public.shop_backup_log enable row level security;

-- Shop details: read and edit, never add or remove (there is exactly one row).
drop policy if exists "shop_settings_select" on public.shop_settings;
create policy "shop_settings_select" on public.shop_settings for select using (true);
drop policy if exists "shop_settings_update" on public.shop_settings;
create policy "shop_settings_update" on public.shop_settings for update using (true) with check (true);

drop policy if exists "shop_categories_all" on public.shop_categories;
create policy "shop_categories_all" on public.shop_categories for all using (true) with check (true);

drop policy if exists "shop_items_all" on public.shop_items;
create policy "shop_items_all" on public.shop_items for all using (true) with check (true);

drop policy if exists "shop_parties_all" on public.shop_parties;
create policy "shop_parties_all" on public.shop_parties for all using (true) with check (true);

-- Counters: read by the app to start a device's numbering, moved by the save function.
drop policy if exists "shop_counters_all" on public.shop_counters;
create policy "shop_counters_all" on public.shop_counters for all using (true) with check (true);

-- Bills are never deleted (they are cancelled), so no delete policy.
drop policy if exists "shop_invoices_select" on public.shop_invoices;
create policy "shop_invoices_select" on public.shop_invoices for select using (true);
drop policy if exists "shop_invoices_insert" on public.shop_invoices;
create policy "shop_invoices_insert" on public.shop_invoices for insert with check (true);
drop policy if exists "shop_invoices_update" on public.shop_invoices;
create policy "shop_invoices_update" on public.shop_invoices for update using (true) with check (true);

drop policy if exists "shop_invoice_items_select" on public.shop_invoice_items;
create policy "shop_invoice_items_select" on public.shop_invoice_items for select using (true);
drop policy if exists "shop_invoice_items_insert" on public.shop_invoice_items;
create policy "shop_invoice_items_insert" on public.shop_invoice_items for insert with check (true);
drop policy if exists "shop_invoice_items_update" on public.shop_invoice_items;
create policy "shop_invoice_items_update" on public.shop_invoice_items for update using (true) with check (true);

drop policy if exists "shop_payments_select" on public.shop_payments;
create policy "shop_payments_select" on public.shop_payments for select using (true);
drop policy if exists "shop_payments_insert" on public.shop_payments;
create policy "shop_payments_insert" on public.shop_payments for insert with check (true);
drop policy if exists "shop_payments_update" on public.shop_payments;
create policy "shop_payments_update" on public.shop_payments for update using (true) with check (true);

-- Audit log, monthly summary and backup log: read only for the app.
-- (The audit trigger and the backup function write to them with owner rights.)
drop policy if exists "shop_audit_log_select" on public.shop_audit_log;
create policy "shop_audit_log_select" on public.shop_audit_log for select using (true);

drop policy if exists "shop_monthly_summary_select" on public.shop_monthly_summary;
create policy "shop_monthly_summary_select" on public.shop_monthly_summary for select using (true);

drop policy if exists "shop_backup_log_select" on public.shop_backup_log;
create policy "shop_backup_log_select" on public.shop_backup_log for select using (true);
