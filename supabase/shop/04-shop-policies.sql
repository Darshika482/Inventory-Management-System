-- Run this in Supabase Dashboard → SQL Editor, after 03-shop-triggers.sql.
-- Main shop sales module, file 4: switch on row level security.
-- Safe to re-run.
--
-- With RLS on and no rules yet, the app key cannot read or change any shop_*
-- table. The owner / staff rules are added by 07-shop-role-policies.sql,
-- once 06-secure-sign-in.sql has set up signing in.

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
