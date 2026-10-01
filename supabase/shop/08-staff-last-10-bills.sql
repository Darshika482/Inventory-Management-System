-- Run this in Supabase Dashboard → SQL Editor, after 07-shop-role-policies.sql.
-- Staff see their shop's 10 most recent sale bills (instead of only today's).
-- The owner still sees every bill. Safe to re-run.

-- The 10 newest sale bills, for signed-in users only.
create or replace function public.shop_recent_sale_ids(p_limit int default 10)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
    from public.shop_invoices
   where bill_type = 'sale'
     and public.app_role() is not null
   order by created_at desc
   limit p_limit;
$$;

grant execute on function public.shop_recent_sale_ids(int) to anon, authenticated;

drop policy if exists "shop_invoices_read" on public.shop_invoices;
create policy "shop_invoices_read" on public.shop_invoices
  for select using (
    public.app_role() = 'owner'
    or (public.app_role() = 'staff' and id in (select public.shop_recent_sale_ids(10)))
  );
