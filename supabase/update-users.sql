-- Run in Supabase SQL Editor to remove demo accounts and keep only Akshay Traders users
-- https://supabase.com/dashboard/project/qcbpztehbutwlbwjykoy/sql

delete from public.app_users
where username in ('admin', 'worker01', 'worker02', 'worker03');

insert into public.app_users (username, role, password_hash) values
  ('akhilesh', 'Admin', 'akshay348'),
  ('ayush', 'Worker', 'ayush724'),
  ('mohit', 'Worker', 'mohit591')
on conflict (username) do update
set role = excluded.role,
    password_hash = excluded.password_hash;

-- Remove any other accounts not in the list above
delete from public.app_users
where username not in ('akhilesh', 'ayush', 'mohit');
