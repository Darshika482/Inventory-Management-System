-- Run this in Supabase Dashboard → SQL Editor, after 01-shop-tables.sql.
-- Main shop sales module, file 2 of 5: bill numbers and saving a sale.
-- Safe to re-run.

-- Financial year (1 April – 31 March) for a date, e.g. 2026-10-01 -> '2026-27'.
create or replace function public.shop_fy_for(d date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from d) >= 4
      then extract(year from d)::int::text || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
    else (extract(year from d)::int - 1)::text || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0')
  end
$$;

create or replace function public.shop_bill_prefix(p_bill_type text)
returns text
language sql
immutable
as $$
  select case p_bill_type when 'sale' then 'S' when 'purchase' then 'P' when 'quotation' then 'Q' end
$$;

-- Hands out the next bill number of a series, e.g. 'S-A/2026-27/0001'.
-- The UPDATE locks the counter row, so two calls can never get the same number.
create or replace function public.shop_next_bill_number(p_bill_type text, p_fy text, p_series text default 'A')
returns text
language plpgsql
as $$
declare
  n int;
begin
  insert into public.shop_counters (bill_type, fy, series, last_number)
  values (p_bill_type, p_fy, p_series, 0)
  on conflict (bill_type, fy, series) do nothing;

  update public.shop_counters
     set last_number = last_number + 1
   where bill_type = p_bill_type and fy = p_fy and series = p_series
  returning last_number into n;

  return public.shop_bill_prefix(p_bill_type) || '-' || p_series || '/' || p_fy || '/' || lpad(n::text, 4, '0');
end;
$$;

-- Saves a sale and all its lines in one go: either everything is saved or nothing is.
--
-- `p` is the bill exactly as the app worked it out (amounts as decimal strings
-- in rupees). Calling it again with the same client_id returns the bill that
-- was already saved instead of saving a second copy, so the app can safely
-- retry after a dropped connection.
--
-- When the device already numbered the bill (it can do that offline), the
-- number is kept and the series counter is moved up to it. When it did not,
-- the next number is handed out here.
create or replace function public.shop_save_sale(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_client_id uuid := (p->>'client_id')::uuid;
  v_existing public.shop_invoices%rowtype;
  v_series text := coalesce(nullif(p->>'series', ''), 'A');
  v_bill_date date := coalesce((p->>'bill_date')::date, (now() at time zone 'Asia/Kolkata')::date);
  v_fy text;
  v_number text := nullif(p->>'bill_number', '');
  v_seq int;
  v_party_id uuid := nullif(p->>'party_id', '')::uuid;
  v_mode text := p->>'payment_mode';
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
  v_user uuid := nullif(p->>'created_by', '')::uuid;
  v_lines jsonb := p->'lines';
  v_line jsonb;
  v_sum_taxable numeric := 0;
  v_sum_tax numeric := 0;
  v_sum_discount numeric := 0;
  v_invoice_id uuid;
  v_line_no int := 0;
begin
  if v_client_id is null then
    raise exception 'This bill has no device id (client_id).';
  end if;

  -- Already saved by an earlier attempt: hand back that bill.
  select * into v_existing from public.shop_invoices where client_id = v_client_id;
  if found then
    return jsonb_build_object('id', v_existing.id, 'bill_number', v_existing.bill_number, 'already_saved', true);
  end if;

  v_fy := coalesce(nullif(p->>'fy', ''), public.shop_fy_for(v_bill_date));
  if v_fy <> public.shop_fy_for(v_bill_date) then
    raise exception 'The bill date % is not in financial year %.', v_bill_date, v_fy;
  end if;

  -- Checks. The app does the GST maths; these make sure what arrives adds up.
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'A bill needs at least one item.';
  end if;
  if v_mode not in ('cash', 'upi', 'credit', 'partial') then
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

  -- Bill number
  if v_number is null then
    v_number := public.shop_next_bill_number('sale', v_fy, v_series);
  else
    if v_number !~ ('^S-' || v_series || '/' || v_fy || '/[0-9]{4,}$') then
      raise exception 'Bill number % does not match series % and year %.', v_number, v_series, v_fy;
    end if;
    v_seq := split_part(v_number, '/', 3)::int;
    insert into public.shop_counters (bill_type, fy, series, last_number)
    values ('sale', v_fy, v_series, v_seq)
    on conflict (bill_type, fy, series)
      do update set last_number = greatest(public.shop_counters.last_number, excluded.last_number);
  end if;

  -- Lets the audit triggers know who made this change.
  perform set_config('app.user_id', coalesce(v_user::text, ''), true);

  insert into public.shop_invoices (
    client_id, bill_type, series, bill_number, fy, bill_date,
    party_id, party_name, party_gstin, is_gst, is_interstate, rates_include_gst,
    payment_mode, paid_mode, subtotal, discount, discount_percent,
    cgst, sgst, igst, round_off, total, paid_amount, notes, created_by, updated_by
  ) values (
    v_client_id, 'sale', v_series, v_number, v_fy, v_bill_date,
    v_party_id, coalesce(p->>'party_name', ''), coalesce(p->>'party_gstin', ''),
    v_is_gst, v_interstate, coalesce((p->>'rates_include_gst')::boolean, true),
    v_mode, case when v_mode = 'partial' then p->>'paid_mode' end,
    v_subtotal, v_discount, nullif(p->>'discount_percent', '')::numeric,
    v_cgst, v_sgst, v_igst, v_round, v_total, v_paid, coalesce(p->>'notes', ''), v_user, v_user
  )
  on conflict (client_id) do nothing
  returning id into v_invoice_id;

  -- Lost a race with another call carrying the same bill: return that one.
  if v_invoice_id is null then
    select * into v_existing from public.shop_invoices where client_id = v_client_id;
    return jsonb_build_object('id', v_existing.id, 'bill_number', v_existing.bill_number, 'already_saved', true);
  end if;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_line_no := v_line_no + 1;
    insert into public.shop_invoice_items (
      invoice_id, line_no, item_id, item_name, hsn, unit, qty, rate, gst_rate,
      discount_amount, taxable_amount, tax_amount, line_total
    ) values (
      v_invoice_id, v_line_no, nullif(v_line->>'item_id', '')::uuid, v_line->>'item_name',
      coalesce(v_line->>'hsn', ''), coalesce(v_line->>'unit', ''),
      (v_line->>'qty')::numeric, (v_line->>'rate')::numeric,
      case when v_is_gst then coalesce((v_line->>'gst_rate')::numeric, 0) else 0 end,
      coalesce((v_line->>'discount_amount')::numeric, 0),
      (v_line->>'taxable_amount')::numeric, coalesce((v_line->>'tax_amount')::numeric, 0),
      (v_line->>'line_total')::numeric
    );

    -- "Update saved rate" was ticked for this line: the item list gets the new rate too.
    if coalesce((v_line->>'update_saved_rate')::boolean, false) and nullif(v_line->>'item_id', '') is not null then
      update public.shop_items
         set sale_rate = (v_line->>'rate')::numeric, updated_by = v_user
       where id = (v_line->>'item_id')::uuid;
    end if;
  end loop;

  return jsonb_build_object('id', v_invoice_id, 'bill_number', v_number, 'already_saved', false);
end;
$$;

-- How often each item was sold in the last 90 days, so the item picker can
-- show the usual items first. Runs with the caller's rights.
create or replace view public.shop_item_sale_counts with (security_invoker = true) as
select l.item_id, count(*)::int as times_sold
  from public.shop_invoice_items l
  join public.shop_invoices i on i.id = l.invoice_id
 where i.bill_type = 'sale'
   and i.status = 'active'
   and l.item_id is not null
   and i.bill_date >= ((now() at time zone 'Asia/Kolkata')::date - 90)
 group by l.item_id;
