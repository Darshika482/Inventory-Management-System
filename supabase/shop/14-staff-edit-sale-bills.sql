-- Run this in Supabase Dashboard → SQL Editor, after 12-edit-sale-bills.sql.
-- Staff (workers) can change a sale bill too, like the owner (Manager), but
-- only one of the newest sale bills they can see on Sale bills (the same 10
-- that 08-staff-last-10-bills.sql lets them read). Only the owner can still
-- change an item's saved rate. Each save is a new version, as before.
-- Safe to re-run.

create or replace function public.shop_edit_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p->>'invoice_id', '')::uuid;
  v_edit uuid := nullif(p->>'edit_id', '')::uuid;
  v_expected int := coalesce((p->>'expected_version')::int, 0);
  v_user uuid;
  v_invoice public.shop_invoices%rowtype;
  v_done public.shop_invoice_versions%rowtype;
  v_is_gst boolean := coalesce((p->>'is_gst')::boolean, false);
  v_paid numeric := coalesce((p->>'paid_amount')::numeric, 0);
  v_mode text := p->>'payment_mode';
  v_later numeric;
  v_line jsonb;
  v_line_no int := 0;
begin
  perform public.app_require_role(array['owner', 'staff']);
  v_user := public.app_user_id();

  if v_id is null or v_edit is null then
    raise exception 'This change has no bill id. Reload the app and try again.';
  end if;

  -- The same change sent twice (slow internet): answer with what it saved.
  select * into v_done from public.shop_invoice_versions where edit_id = v_edit;
  if found then
    select * into v_invoice from public.shop_invoices where id = v_done.invoice_id;
    return jsonb_build_object('id', v_invoice.id, 'version', v_done.version + 1,
                              'paid_amount', v_invoice.paid_amount, 'already_saved', true);
  end if;

  select * into v_invoice from public.shop_invoices where id = v_id for update;
  if not found then
    raise exception 'This bill was not found. It may still be waiting to upload.';
  end if;
  if v_invoice.bill_type <> 'sale' then
    raise exception 'Only sale bills can be changed here.';
  end if;
  if v_invoice.status <> 'active' then
    raise exception 'A cancelled bill cannot be changed.';
  end if;
  -- Staff: only a bill from their Sale bills list.
  if public.app_role() = 'staff' and v_id not in (select public.shop_recent_sale_ids(10)) then
    raise exception 'This bill is too old to change here. Ask the owner to change it.';
  end if;
  if v_invoice.version <> v_expected then
    raise exception 'This bill was changed on another phone (it is now version %). Open it again and make the change there.', v_invoice.version;
  end if;

  perform public.shop_check_sale(p);

  -- Money received later (Receive payment) stays on the bill.
  select coalesce(sum(amount), 0) into v_later
    from public.shop_payments
   where invoice_id = v_id and direction = 'in';
  if v_paid < v_later then
    raise exception '₹% was received on this bill later, so the amount received cannot be less than that.', v_later;
  end if;

  -- Who did it, for the audit log.
  perform set_config('app.user_id', coalesce(v_user::text, ''), true);

  -- Keep the version being replaced, exactly as it is now.
  insert into public.shop_invoice_versions (invoice_id, version, data, edit_id, changed_by)
  values (
    v_id,
    v_invoice.version,
    to_jsonb(v_invoice) || jsonb_build_object(
      'shop_invoice_items',
      coalesce((select jsonb_agg(to_jsonb(l) order by l.line_no)
                  from public.shop_invoice_items l where l.invoice_id = v_id), '[]'::jsonb)
    ),
    v_edit,
    v_user
  );

  -- The bill keeps its number, date, series and maker.
  update public.shop_invoices set
    party_id = nullif(p->>'party_id', '')::uuid,
    party_name = coalesce(p->>'party_name', ''),
    party_gstin = coalesce(p->>'party_gstin', ''),
    is_gst = v_is_gst,
    is_interstate = coalesce((p->>'is_interstate')::boolean, false),
    rates_include_gst = coalesce((p->>'rates_include_gst')::boolean, true),
    payment_mode = v_mode,
    paid_mode = case when v_mode = 'partial' then p->>'paid_mode' end,
    subtotal = (p->>'subtotal')::numeric,
    discount = coalesce((p->>'discount')::numeric, 0),
    discount_percent = nullif(p->>'discount_percent', '')::numeric,
    cgst = coalesce((p->>'cgst')::numeric, 0),
    sgst = coalesce((p->>'sgst')::numeric, 0),
    igst = coalesce((p->>'igst')::numeric, 0),
    round_off = coalesce((p->>'round_off')::numeric, 0),
    total = (p->>'total')::numeric,
    paid_amount = v_paid,
    version = v_invoice.version + 1,
    edited_at = now(),
    edited_by = v_user,
    updated_by = v_user
  where id = v_id;

  delete from public.shop_invoice_items where invoice_id = v_id;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_line_no := v_line_no + 1;
    insert into public.shop_invoice_items (
      invoice_id, line_no, item_id, item_name, hsn, unit, qty, rate, gst_rate,
      discount_amount, taxable_amount, tax_amount, line_total
    ) values (
      v_id, v_line_no, nullif(v_line->>'item_id', '')::uuid, v_line->>'item_name',
      coalesce(v_line->>'hsn', ''), coalesce(v_line->>'unit', ''),
      (v_line->>'qty')::numeric, (v_line->>'rate')::numeric,
      case when v_is_gst then coalesce((v_line->>'gst_rate')::numeric, 0) else 0 end,
      coalesce((v_line->>'discount_amount')::numeric, 0),
      (v_line->>'taxable_amount')::numeric, coalesce((v_line->>'tax_amount')::numeric, 0),
      (v_line->>'line_total')::numeric
    );

    -- "Update saved rate" ticked for this line: the item list gets the new rate too.
    -- Only the owner may change saved rates.
    if coalesce((v_line->>'update_saved_rate')::boolean, false) and nullif(v_line->>'item_id', '') is not null
       and public.app_role() = 'owner' then
      update public.shop_items
         set sale_rate = (v_line->>'rate')::numeric, updated_by = v_user
       where id = (v_line->>'item_id')::uuid;
    end if;
  end loop;

  return jsonb_build_object('id', v_id, 'version', v_invoice.version + 1,
                            'paid_amount', v_paid, 'already_saved', false);
end;
$$;

revoke execute on function public.shop_edit_sale(jsonb) from public;
grant execute on function public.shop_edit_sale(jsonb) to anon, authenticated;
