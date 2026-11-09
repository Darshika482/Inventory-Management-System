-- Run this in Supabase Dashboard → SQL Editor, after 14-staff-edit-sale-bills.sql.
-- The owner (Admin) can delete a sale bill from the bill's ⋮ menu.
-- Safe to re-run.
--
-- What goes with the bill: its lines and its earlier versions (edits).
-- What stays: money received on it later (Receive payment) is kept for the
-- customer as money received on account, so no cash entry is lost.
-- The audit log keeps a copy of the deleted bill.

create or replace function public.shop_delete_sale(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.shop_invoices%rowtype;
  v_kept numeric := 0;
begin
  perform public.app_require_role(array['owner']);
  -- Who deleted it, for the audit log.
  perform set_config('app.user_id', coalesce(public.app_user_id()::text, ''), true);

  select * into v_invoice from public.shop_invoices where id = p_invoice_id for update;
  if not found then
    -- Already deleted (e.g. the tap was sent twice).
    return jsonb_build_object('deleted', false, 'kept_payments', 0);
  end if;
  if v_invoice.bill_type <> 'sale' then
    raise exception 'Only sale bills can be deleted here.';
  end if;

  -- Money received later stays with the customer, on account.
  select coalesce(sum(amount), 0) into v_kept
    from public.shop_payments where invoice_id = p_invoice_id;
  update public.shop_payments set invoice_id = null where invoice_id = p_invoice_id;

  delete from public.shop_invoice_versions where invoice_id = p_invoice_id;
  update public.shop_invoices set converted_from = null where converted_from = p_invoice_id;
  -- The lines go with the bill (on delete cascade).
  delete from public.shop_invoices where id = p_invoice_id;

  return jsonb_build_object('deleted', true, 'kept_payments', v_kept);
end;
$$;

revoke execute on function public.shop_delete_sale(uuid) from public;
grant execute on function public.shop_delete_sale(uuid) to anon, authenticated;
