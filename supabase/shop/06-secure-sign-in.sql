-- Run this in Supabase Dashboard → SQL Editor, after 05-shop-seed.sql.
-- Secure sign-in, file 6. Safe to re-run.
--
-- Before: the app read app_users (with plain-text passwords) straight from
-- the browser and compared the password there. Anyone with the app key could
-- read every password.
--
-- After:
--   * passwords are stored as bcrypt hashes (old plain-text ones are hashed
--     here, and any plain text written later is hashed automatically);
--   * app_users can no longer be read with the app key; a view exposes only
--     id, username and role;
--   * signing in goes through app_login(), which checks the password inside the
--     database and returns a session token the app sends with every request
--     (header "x-app-session");
--   * app_role() reads that token, so row-level security can tell the owner
--     (Admin) from staff (Worker).
--
-- Usernames and passwords stay the same. Deploy the matching app version at
-- the same time: older app versions cannot sign in after this runs.

create extension if not exists pgcrypto with schema extensions;

-- 1. Hash passwords -----------------------------------------------------------

create or replace function public.app_hash_password()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- bcrypt hashes start with $2; anything else is a plain-text password.
  if new.password_hash is not null and new.password_hash !~ '^\$2[abxy]\$' then
    new.password_hash := extensions.crypt(new.password_hash, extensions.gen_salt('bf'));
  end if;
  return new;
end;
$$;

drop trigger if exists app_users_hash_password on public.app_users;
create trigger app_users_hash_password before insert or update of password_hash on public.app_users
  for each row execute function public.app_hash_password();

update public.app_users
   set password_hash = password_hash
 where password_hash !~ '^\$2[abxy]\$';

-- 2. Sessions -----------------------------------------------------------------

create table if not exists public.app_sessions (
  token text primary key default encode(extensions.gen_random_bytes(32), 'hex'),
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);

create index if not exists app_sessions_user_id_idx on public.app_sessions (user_id);

-- Only the functions below touch sessions.
alter table public.app_sessions enable row level security;

-- 3. Lock app_users -----------------------------------------------------------

alter table public.app_users enable row level security;
drop policy if exists "app_users_select" on public.app_users;

-- Names and roles only (used for "who made this bill" and the staff list).
create or replace view public.app_user_list as
  select id, username, role from public.app_users;
grant select on public.app_user_list to anon, authenticated;

-- 4. Sign in / out ------------------------------------------------------------

create or replace function public.app_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_token text;
begin
  select * into v_user from public.app_users where lower(username) = lower(btrim(p_username));
  if not found or v_user.password_hash is null
     or v_user.password_hash <> extensions.crypt(p_password, v_user.password_hash) then
    return null;
  end if;

  delete from public.app_sessions where expires_at < now();
  insert into public.app_sessions (user_id) values (v_user.id) returning token into v_token;

  return jsonb_build_object(
    'token', v_token,
    'user', jsonb_build_object('id', v_user.id, 'username', v_user.username, 'role', v_user.role)
  );
end;
$$;

create or replace function public.app_logout(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.app_sessions where token = p_token;
$$;

-- 5. Who is calling -----------------------------------------------------------

create or replace function public.app_session_token()
returns text
language sql
stable
as $$
  select nullif(coalesce(current_setting('request.headers', true), '{}')::json->>'x-app-session', '');
$$;

-- The signed-in app user, or null.
create or replace function public.app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id
    from public.app_sessions s
   where s.token = public.app_session_token()
     and s.expires_at > now();
$$;

-- 'owner' (Admin), 'staff' (Worker), or null when not signed in.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case u.role when 'Admin' then 'owner' when 'Worker' then 'staff' end
    from public.app_sessions s
    join public.app_users u on u.id = s.user_id
   where s.token = public.app_session_token()
     and s.expires_at > now();
$$;

create or replace function public.app_require_role(p_roles text[])
returns void
language plpgsql
stable
as $$
begin
  if public.app_role() is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;
  if not (public.app_role() = any (p_roles)) then
    raise exception 'Only the owner can do this.' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.app_login(text, text) to anon, authenticated;
grant execute on function public.app_logout(text) to anon, authenticated;
