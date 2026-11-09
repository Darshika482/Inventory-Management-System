-- Run this in Supabase Dashboard → SQL Editor, after 15-delete-sale-bills.sql.
-- "Receive old balance" in the Udhaar list: money a customer pays towards
-- their old balance (what they owed from before the app). Saved as a payment
-- without a bill (on account), with its date, cash/UPI and who received it,
-- so the old balance on the customer stays as it was and the history is kept.
-- What they owe = old balance + what is left on bills - these payments.
-- Safe to re-run.

create or replace function public.shop_receive_old_balance(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.app_user_id();
  v_client uuid := nullif(p->>'client_id', '')::uuid;
  v_party_id uuid := nullif(p->>'party_id', '')::uuid;
  v_amount numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  v_mode text := coalesce(nullif(p->>'mode', ''), 'cash');
  v_party public.shop_parties%rowtype;
  v_paid numeric;
begin
  perform public.app_require_role(array['owner']);
  if v_client is null then
    raise exception 'The payment has no id. Reload the app and try again.';
  end if;

  -- The same payment sent twice (slow internet): saved once.
  if exists (select 1 from public.shop_payments where client_id = v_client) then
    select coalesce(sum(amount), 0) into v_paid
      from public.shop_payments
     where party_id = v_party_id and invoice_id is null and direction = 'in';
    return jsonb_build_object('paid_on_account', v_paid, 'already_saved', true);
  end if;

  if v_mode not in ('cash', 'upi') then
    raise exception 'Say whether it was paid in cash or by UPI.';
  end if;
  if v_amount <= 0 then
    raise exception 'The amount must be more than ₹0.';
  end if;

  -- One payment at a time per customer, so two phones cannot both take the last rupee.
  select * into v_party from public.shop_parties where id = v_party_id for update;
  if not found then
    raise exception 'This customer was not found.';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from public.shop_payments
   where party_id = v_party_id and invoice_id is null and direction = 'in';
  if v_amount > v_party.opening_balance - v_paid then
    raise exception 'That is more than the old balance left (₹%).', greatest(v_party.opening_balance - v_paid, 0);
  end if;

  perform set_config('app.user_id', coalesce(v_user::text, ''), true);
  insert into public.shop_payments (client_id, party_id, invoice_id, direction, amount, mode, note, created_by)
  values (v_client, v_party_id, null, 'in', v_amount, v_mode, 'Old balance', v_user);

  return jsonb_build_object('paid_on_account', v_paid + v_amount, 'already_saved', false);
end;
$$;

revoke execute on function public.shop_receive_old_balance(jsonb) from public;
grant execute on function public.shop_receive_old_balance(jsonb) to anon, authenticated;
