-- Run this in Supabase Dashboard → SQL Editor, after 16-receive-old-balance.sql.
-- Backup and restore, file 17. Safe to re-run.
--
-- Backups themselves need nothing here: the app reads the records and sends
-- them to Telegram. This file is only for Restore (Shop settings → Backup and
-- restore → Restore from a backup file).
--
-- app_restore_rows(table, rows) puts back the records from a backup file that
-- the table does not have. A record that is already there (same id, or same
-- bill client_id) is skipped and never changed; nothing is ever deleted. So
-- restoring the same file twice adds nothing the second time.
--
-- Only the owner can run it, and only on the tables listed below.

create or replace function public.app_restore_rows(p_table text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array[
    'shop_settings', 'shop_categories', 'shop_items', 'shop_parties', 'shop_counters',
    'shop_invoices', 'shop_invoice_items', 'shop_payments', 'shop_invoice_versions',
    'shop_monthly_summary',
    'categories', 'withdrawal_logs', 'stock_additions', 'item_groups',
    'purchase_bills', 'bill_payments', 'transport_bills', 'transport_payments',
    'workers', 'worker_goods_issues', 'worker_goods_returns', 'worker_payments'
  ];
  v_cols text;
  v_sql text;
  v_added int := 0;
  v_n int;
  v_failed int := 0;
  v_error text;
  v_row jsonb;
  v_fk record;
begin
  perform public.app_require_role(array['owner']);

  if not (p_table = any (allowed)) then
    raise exception 'This list cannot be restored: %', p_table using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('added', 0, 'failed', 0, 'error', null);
  end if;
  if to_regclass('public.' || p_table) is null then
    return jsonb_build_object(
      'added', 0,
      'failed', jsonb_array_length(p_rows),
      'error', format('Table %s does not exist yet. Run its SQL file first.', p_table)
    );
  end if;

  -- The table's columns that the backup has. Columns added after the backup
  -- was made get their usual default.
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = p_table
     and c.is_generated = 'NEVER'
     and (p_rows -> 0) ? c.column_name;
  if v_cols is null then
    raise exception 'The backup records do not match the table %', p_table;
  end if;

  -- A link that the app itself empties when its target is deleted ("made by"
  -- a user, a bill line's item) is emptied here too when the target is gone,
  -- e.g. restoring into a fresh database where the users have new ids. The
  -- record still goes back instead of being refused.
  for v_fk in
    select a.attname::text as col, con.confrelid::regclass::text as ref_table, ra.attname::text as ref_col
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
      join pg_attribute ra on ra.attrelid = con.confrelid and ra.attnum = con.confkey[1]
     where con.conrelid = format('public.%I', p_table)::regclass
       and con.contype = 'f'
       and con.confdeltype = 'n'
       and array_length(con.conkey, 1) = 1
  loop
    execute format(
      'select coalesce(jsonb_agg(case
          when r ->> %1$L is not null and not exists (select 1 from %2$s t where t.%3$I::text = r ->> %1$L)
          then jsonb_set(r, array[%1$L], ''null''::jsonb)
          else r end order by ord), ''[]''::jsonb)
         from jsonb_array_elements($1) with ordinality as e(r, ord)',
      v_fk.col, v_fk.ref_table, v_fk.ref_col
    )
    into p_rows
    using p_rows;
  end loop;

  v_sql := format(
    'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing',
    p_table, v_cols, v_cols, p_table
  );

  begin
    execute v_sql using p_rows;
    get diagnostics v_added = row_count;
  exception when others then
    -- One bad record (e.g. pointing at something that is gone) must not stop
    -- the rest: go one by one and count the ones that cannot go back.
    v_added := 0;
    for v_row in select value from jsonb_array_elements(p_rows) loop
      begin
        execute v_sql using jsonb_build_array(v_row);
        get diagnostics v_n = row_count;
        v_added := v_added + v_n;
      exception when others then
        v_failed := v_failed + 1;
        v_error := sqlerrm;
      end;
    end loop;
  end;

  return jsonb_build_object('added', v_added, 'failed', v_failed, 'error', v_error);
end;
$$;

revoke all on function public.app_restore_rows(text, jsonb) from public;
grant execute on function public.app_restore_rows(text, jsonb) to anon, authenticated;
