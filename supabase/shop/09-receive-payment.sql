-- Run this in Supabase Dashboard → SQL Editor, after 08-staff-last-10-bills.sql.
-- "Receive payment" on an udhaar / part-paid bill: records the money in
-- shop_payments and raises the bill's paid amount, in one step. Safe to re-run.

create or replace function public.shop_receive_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.app_user_id();
  v_client uuid := nullif(p->>'client_id', '')::uuid;
  v_amount numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  v_mode text := coalesce(nullif(p->>'mode', ''), 'cash');
  v_invoice public.shop_invoices%rowtype;
  v_existing public.shop_payments%rowtype;
  v_paid numeric;
begin
  if public.app_role() is null then
    raise exception 'Please sign in again, then receive the payment.';
  end if;
  if v_client is null then
    raise exception 'The payment has no id. Reload the app and try again.';
  end if;

  -- The same payment sent twice (slow internet): answer with the first one.
  select * into v_existing from public.shop_payments where client_id = v_client;
  if found then
    select paid_amount into v_paid from public.shop_invoices where id = v_existing.invoice_id;
    return jsonb_build_object('paid_amount', v_paid, 'already_saved', true);
  end if;

  select * into v_invoice
    from public.shop_invoices
   where id = nullif(p->>'invoice_id', '')::uuid
   for update;
  if not found then
    raise exception 'This bill was not found. It may still be waiting to upload.';
  end if;
  if v_invoice.bill_type <> 'sale' or v_invoice.status <> 'active' then
    raise exception 'Payments can only be added to a sale bill that is not cancelled.';
  end if;
  if v_invoice.party_id is null then
    raise exception 'This bill has no customer, so a payment cannot be recorded on it.';
  end if;
  if v_mode not in ('cash', 'upi') then
    raise exception 'Choose Cash or UPI for the payment.';
  end if;
  if v_amount <= 0 then
    raise exception 'The amount must be more than ₹0.';
  end if;
  if v_amount > v_invoice.total - v_invoice.paid_amount then
    raise exception 'The amount is more than the balance left on this bill (₹%).', v_invoice.total - v_invoice.paid_amount;
  end if;

  -- Who did it, for the audit log.
  perform set_config('app.user_id', coalesce(v_user::text, ''), true);

  insert into public.shop_payments (client_id, party_id, invoice_id, direction, amount, mode, note, created_by)
  values (v_client, v_invoice.party_id, v_invoice.id, 'in', v_amount, v_mode, coalesce(p->>'note', ''), v_user);

  update public.shop_invoices
     set paid_amount = paid_amount + v_amount,
         updated_by = v_user
   where id = v_invoice.id
  returning paid_amount into v_paid;

  return jsonb_build_object('paid_amount', v_paid, 'already_saved', false);
end;
$$;

revoke execute on function public.shop_receive_payment(jsonb) from public;
grant execute on function public.shop_receive_payment(jsonb) to anon, authenticated;
