-- Run this in Supabase Dashboard → SQL Editor, after 02-shop-functions.sql.
-- Main shop sales module, file 3 of 5: automatic rules.
-- Safe to re-run.

-- 1. Keep updated_at current
create or replace function public.shop_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shop_settings_touch on public.shop_settings;
create trigger shop_settings_touch before update on public.shop_settings
  for each row execute function public.shop_touch_updated_at();

drop trigger if exists shop_items_touch on public.shop_items;
create trigger shop_items_touch before update on public.shop_items
  for each row execute function public.shop_touch_updated_at();

drop trigger if exists shop_parties_touch on public.shop_parties;
create trigger shop_parties_touch before update on public.shop_parties
  for each row execute function public.shop_touch_updated_at();

drop trigger if exists shop_invoices_touch on public.shop_invoices;
create trigger shop_invoices_touch before update on public.shop_invoices
  for each row execute function public.shop_touch_updated_at();

-- 2. Cost snapshot: a line saved without a cost rate gets one, so profit
--    stays right even after the item's purchase rate changes later.
--    Sale and quotation lines take the item's current purchase rate;
--    a purchase line's cost is its own rate.
create or replace function public.shop_fill_cost_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  if new.cost_rate is not null then
    return new;
  end if;

  select bill_type into v_type from public.shop_invoices where id = new.invoice_id;

  if v_type = 'purchase' then
    new.cost_rate := new.rate;
  else
    select purchase_rate into new.cost_rate from public.shop_items where id = new.item_id;
  end if;

  new.cost_rate := coalesce(new.cost_rate, 0);
  return new;
end;
$$;

drop trigger if exists shop_invoice_items_cost_rate on public.shop_invoice_items;
create trigger shop_invoice_items_cost_rate before insert on public.shop_invoice_items
  for each row execute function public.shop_fill_cost_rate();

-- 3. Purchase rate: a line on a purchase bill sets the item's purchase rate.
create or replace function public.shop_update_purchase_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.item_id is not null and exists (
    select 1 from public.shop_invoices
     where id = new.invoice_id and bill_type = 'purchase' and status = 'active'
  ) then
    update public.shop_items set purchase_rate = new.rate where id = new.item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists shop_invoice_items_purchase_rate on public.shop_invoice_items;
create trigger shop_invoice_items_purchase_rate after insert on public.shop_invoice_items
  for each row execute function public.shop_update_purchase_rate();

-- 4. Audit: every change (and cancel) to a bill, bill line, payment or item
--    is copied to shop_audit_log. Runs as the table owner so the log itself
--    can stay read-only for the app.
create or replace function public.shop_write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_action text := lower(tg_op);
  v_user uuid;
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;

  if tg_op = 'UPDATE' and v_old->>'status' = 'active' and v_new->>'status' = 'cancelled' then
    v_action := 'cancel';
  end if;

  -- Who: set by the save functions, else the row's own updated_by / created_by.
  v_user := coalesce(
    nullif(current_setting('app.user_id', true), '')::uuid,
    nullif(coalesce(v_new, v_old)->>'updated_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'created_by', '')::uuid
  );

  insert into public.shop_audit_log (table_name, record_id, action, old_data, new_data, user_id)
  values (tg_table_name, (coalesce(v_new, v_old)->>'id')::uuid, v_action, v_old, v_new, v_user);

  return coalesce(new, old);
end;
$$;

drop trigger if exists shop_invoices_audit on public.shop_invoices;
create trigger shop_invoices_audit after update or delete on public.shop_invoices
  for each row execute function public.shop_write_audit();

drop trigger if exists shop_invoice_items_audit on public.shop_invoice_items;
create trigger shop_invoice_items_audit after update or delete on public.shop_invoice_items
  for each row execute function public.shop_write_audit();

drop trigger if exists shop_payments_audit on public.shop_payments;
create trigger shop_payments_audit after update or delete on public.shop_payments
  for each row execute function public.shop_write_audit();

drop trigger if exists shop_items_audit on public.shop_items;
create trigger shop_items_audit after update or delete on public.shop_items
  for each row execute function public.shop_write_audit();
