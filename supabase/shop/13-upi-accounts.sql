-- Run this in Supabase Dashboard → SQL Editor.
-- The shop can keep more than one UPI account and choose which one's QR goes
-- on bills (Shop settings → UPI QR on bills). Starts with two:
--   1. PNB merchant account, AKSHAY TRADERS, 9131297397m@pnb — on bills.
--      Name and merchant code (8675) are copied from the bank's own QR.
--   2. PhonePe / SBI ··8486, 9300106271@ybl — the one used before.
-- Safe to re-run: once the list is there, it stays as the owner last set it.

alter table public.shop_settings
  add column if not exists upi_accounts jsonb not null default '[]'::jsonb;

update public.shop_settings
   set upi_accounts = '[
         {"id": "pnb", "label": "PNB · Akshay Traders", "upi_id": "9131297397m@pnb",
          "payee_name": "AKSHAY TRADERS", "merchant_code": "8675"},
         {"id": "phonepe-sbi", "label": "PhonePe · SBI ··8486", "upi_id": "9300106271@ybl",
          "payee_name": "", "merchant_code": ""}
       ]'::jsonb,
       upi_id = '9131297397m@pnb'
 where id = 1
   and upi_accounts = '[]'::jsonb;

-- What bills use now.
select upi_id as on_bills, jsonb_array_length(upi_accounts) as saved_accounts
  from public.shop_settings;
