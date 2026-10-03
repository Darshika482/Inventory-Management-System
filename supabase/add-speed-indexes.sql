-- Indexes that keep the app's lists fast however many rows they grow to.
-- Each list is read newest first (or by name), page by page; with these the
-- database jumps straight to the right rows instead of sorting the whole table.
--
-- Safe to run more than once, and on a database where some of the optional
-- tables (stock additions, item groups, transport, workers, shop) do not exist yet.
-- Run it in Supabase: SQL Editor -> New query -> paste -> Run.

do $$
declare
  spec text[];
  specs text[][] := array[
    -- table,                  index name,                              columns
    ['withdrawal_logs',        'withdrawal_logs_created_at_idx',        '(created_at desc, id)'],
    ['stock_additions',        'stock_additions_created_at_idx',        '(created_at desc, id)'],
    ['purchase_bills',         'purchase_bills_created_at_idx',         '(created_at desc, id)'],
    ['bill_payments',          'bill_payments_created_at_idx',          '(created_at desc, id)'],
    ['item_groups',            'item_groups_created_at_idx',            '(created_at desc, id)'],
    ['transport_bills',        'transport_bills_created_at_idx',        '(created_at desc, id)'],
    ['transport_payments',     'transport_payments_created_at_idx',     '(created_at desc, id)'],
    ['worker_goods_issues',    'worker_goods_issues_created_at_idx',    '(created_at desc, id)'],
    ['worker_goods_returns',   'worker_goods_returns_created_at_idx',   '(created_at desc, id)'],
    ['worker_payments',        'worker_payments_created_at_idx',        '(created_at desc, id)'],
    ['categories',             'categories_name_idx',                   '(name, id)'],
    ['workers',                'workers_name_idx',                      '(name, id)'],
    ['shop_items',             'shop_items_name_idx',                   '(name, id)'],
    ['shop_parties',           'shop_parties_name_idx',                 '(name, id)'],
    -- Sale bills by date range (the Sale bills page) and the newest few (staff).
    ['shop_invoices',          'shop_invoices_type_date_idx',           '(bill_type, bill_date desc, created_at desc, id)'],
    ['shop_invoices',          'shop_invoices_type_created_idx',        '(bill_type, created_at desc)']
  ];
begin
  foreach spec slice 1 in array specs loop
    if to_regclass('public.' || spec[1]) is not null then
      execute format('create index if not exists %I on public.%I %s', spec[2], spec[1], spec[3]);
    end if;
  end loop;

  -- Udhaar list: only the bills that can still have money to come.
  if to_regclass('public.shop_invoices') is not null then
    create index if not exists shop_invoices_due_idx
      on public.shop_invoices (bill_date, created_at, id)
      where bill_type = 'sale' and status = 'active' and payment_mode in ('credit', 'partial');
  end if;
end $$;
