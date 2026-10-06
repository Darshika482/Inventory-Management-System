-- Run this in Supabase Dashboard → SQL Editor, after 09-receive-payment.sql.
-- Editing a sale bill: the owner (Manager) changes items, quantities, rates,
-- discount, customer or payment, and the bill keeps its number. Each save
-- makes the next version (KB7PP → KB7PP (v2)); every earlier version is kept
-- in shop_invoice_versions, exactly as it was. Payments received later stay
-- on the bill. Safe to re-run. Nothing is deleted.

-- 1. Which version a bill is on, and who changed it last.
alter table public.shop_invoices add column if not exists version int not null default 1;
alter table public.shop_invoices add column if not exists edited_at timestamptz;
alter table public.shop_invoices add column if not exists edited_by uuid references public.app_users(id) on delete set null;

-- 2. Every earlier version, as it was (the bill row with its lines).
create table if not exists public.shop_invoice_versions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.shop_invoices(id),
  version int not null,
  data jsonb not null,                       -- the bill and its lines, before the change
  edit_id uuid unique not null,              -- made on the phone: the same change sent twice is saved once
  changed_by uuid references public.app_users(id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (invoice_id, version)
);
create index if not exists shop_invoice_versions_invoice_id_idx on public.shop_invoice_versions (invoice_id);

alter table public.shop_invoice_versions enable row level security;
drop policy if exists "shop_invoice_versions_read" on public.shop_invoice_versions;
create policy "shop_invoice_versions_read" on public.shop_invoice_versions
  for select using (public.app_role() is not null);
-- Written only by shop_edit_sale below.

-- 3. The checks a sale must pass; the same ones shop_save_sale makes.
create or replace function public.shop_check_sale(p jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_mode text := p->>'payment_mode';
  v_party_id uuid := nullif(p->>'party_id', '')::uuid;
  v_is_gst boolean := coalesce((p->>'is_gst')::boolean, false);
  v_interstate boolean := coalesce((p->>'is_interstate')::boolean, false);
  v_subtotal numeric := (p->>'subtotal')::numeric;
  v_discount numeric := coalesce((p->>'discount')::numeric, 0);
  v_cgst numeric := coalesce((p->>'cgst')::numeric, 0);
  v_sgst numeric := coalesce((p->>'sgst')::numeric, 0);
  v_igst numeric := coalesce((p->>'igst')::numeric, 0);
  v_round numeric := coalesce((p->>'round_off')::numeric, 0);
  v_total numeric := (p->>'total')::numeric;
  v_paid numeric := coalesce((p->>'paid_amount')::numeric, 0);
  v_lines jsonb := p->'lines';
  v_line jsonb;
  v_sum_taxable numeric := 0;
  v_sum_tax numeric := 0;
  v_sum_discount numeric := 0;
begin
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'A bill needs at least one item.';
  end if;
  if v_mode is null or v_mode not in ('cash', 'upi', 'credit', 'partial') then
    raise exception 'Unknown payment type: %.', v_mode;
  end if;
  if v_mode in ('credit', 'partial') and v_party_id is null then
    raise exception 'An udhaar (credit) bill needs a customer name.';
  end if;
  if v_mode in ('cash', 'upi') and v_paid <> v_total then
    raise exception 'A cash or UPI bill must be fully paid.';
  end if;
  if v_mode = 'credit' and v_paid <> 0 then
    raise exception 'A credit bill cannot have a paid amount. Use part payment instead.';
  end if;
  if v_mode = 'partial' and (v_paid <= 0 or v_paid >= v_total) then
    raise exception 'For a part payment, the paid amount must be more than 0 and less than the total.';
  end if;
  if v_mode = 'partial' and coalesce(p->>'paid_mode', '') not in ('cash', 'upi') then
    raise exception 'Say whether the paid part was cash or UPI.';
  end if;
  if not v_is_gst and (v_cgst <> 0 or v_sgst <> 0 or v_igst <> 0) then
    raise exception 'A bill without GST cannot have GST amounts.';
  end if;
  if v_interstate and (v_cgst <> 0 or v_sgst <> 0) then
    raise exception 'An inter-state bill uses IGST only.';
  end if;
  if not v_interstate and v_igst <> 0 then
    raise exception 'A bill within the state uses CGST and SGST, not IGST.';
  end if;
  if abs(v_round) >= 1 or v_total <> round(v_total) then
    raise exception 'The bill total must be rounded to a whole rupee.';
  end if;
  if v_total <> v_subtotal + v_cgst + v_sgst + v_igst + v_round then
    raise exception 'The bill total does not add up.';
  end if;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    if (v_line->>'qty')::numeric <= 0 then
      raise exception 'Quantity must be more than 0 for %.', v_line->>'item_name';
    end if;
    if (v_line->>'line_total')::numeric <> (v_line->>'taxable_amount')::numeric + coalesce((v_line->>'tax_amount')::numeric, 0) then
      raise exception 'The amount for % does not add up.', v_line->>'item_name';
    end if;
    v_sum_taxable := v_sum_taxable + (v_line->>'taxable_amount')::numeric;
    v_sum_tax := v_sum_tax + coalesce((v_line->>'tax_amount')::numeric, 0);
    v_sum_discount := v_sum_discount + coalesce((v_line->>'discount_amount')::numeric, 0);
  end loop;

  if v_sum_taxable <> v_subtotal then
    raise exception 'The item amounts do not add up to the subtotal.';
  end if;
  if v_sum_tax <> v_cgst + v_sgst + v_igst then
    raise exception 'The GST on the items does not add up to the bill GST.';
  end if;
  if v_sum_discount <> v_discount then
    raise exception 'The discount on the items does not add up to the bill discount.';
  end if;
end;
$$;

-- 4. Save a changed bill as its next version. Owner (Manager) only.
--    p: the bill as shop_save_sale takes it, plus invoice_id, expected_version
--    (the version the phone opened) and edit_id (a new id per change).
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
  perform public.app_require_role(array['owner']);
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
    if coalesce((v_line->>'update_saved_rate')::boolean, false) and nullif(v_line->>'item_id', '') is not null then
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
