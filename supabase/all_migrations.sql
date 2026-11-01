-- SwapFrame: all migrations in order. Safe to paste into the Supabase SQL editor and re-run.

-- ===== supabase/migrations/0001_init.sql =====
-- SwapFrame schema: jobs table + private storage buckets, all protected by RLS.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  status text not null default 'queued' check (status in ('queued','starting','processing','succeeded','failed','canceled')),
  video_path text not null,
  image_path text not null,
  output_path text,
  prediction_id text,
  error text,
  consent boolean not null default false check (consent = true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_user_idx on public.jobs(user_id, created_at desc);
alter table public.jobs enable row level security;

drop policy if exists "jobs_select_own" on public.jobs;
create policy "jobs_select_own" on public.jobs for select using (auth.uid() = user_id);
drop policy if exists "jobs_insert_own" on public.jobs;
create policy "jobs_insert_own" on public.jobs for insert with check (auth.uid() = user_id);
drop policy if exists "jobs_delete_own" on public.jobs;
create policy "jobs_delete_own" on public.jobs for delete using (auth.uid() = user_id);
-- No update policy for users: status/output are written only by the edge function (service role).

-- Buckets (private). Files live under "<user_id>/..." so policies can check ownership.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
 ('uploads','uploads', false, 104857600, array['video/mp4','video/quicktime','video/webm','image/png','image/jpeg','image/webp']),
 ('results','results', false, 524288000, array['video/mp4'])
on conflict (id) do nothing;

drop policy if exists "uploads_rw_own" on storage.objects;
create policy "uploads_rw_own" on storage.objects for all
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "results_read_own" on storage.objects;
create policy "results_read_own" on storage.objects for select
  using (bucket_id = 'results' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== supabase/migrations/0002_admin.sql =====
-- SwapFrame admin: profiles, roles, bans, credits. Run after 0001_init.sql.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user','admin')),
  banned boolean not null default false,
  credits integer not null default 5 check (credits >= 0),
  usage_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Auto-create a profile on sign up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
-- Backfill existing users
insert into public.profiles (id, email) select id, email from auth.users on conflict (id) do nothing;

-- Helpers (security definer so they can be used inside RLS without recursion)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
create or replace function public.is_banned() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select banned from public.profiles where id = auth.uid()), false);
$$;

-- profiles policies: users read their own row; only admins read all / update / delete.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete" on public.profiles for delete using (public.is_admin());

-- jobs: admins see/delete everything; banned users cannot insert.
drop policy if exists "jobs_select_own" on public.jobs;
create policy "jobs_select_own" on public.jobs for select using (auth.uid() = user_id or public.is_admin());
drop policy if exists "jobs_insert_own" on public.jobs;
create policy "jobs_insert_own" on public.jobs for insert with check (auth.uid() = user_id and not public.is_banned());
drop policy if exists "jobs_delete_own" on public.jobs;
create policy "jobs_delete_own" on public.jobs for delete using (auth.uid() = user_id or public.is_admin());

-- storage: banned users cannot upload; admins can read all objects in both buckets.
drop policy if exists "uploads_rw_own" on storage.objects;
create policy "uploads_rw_own" on storage.objects for all
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text and not public.is_banned());
drop policy if exists "admin_read_all" on storage.objects;
create policy "admin_read_all" on storage.objects for select
  using (bucket_id in ('uploads','results') and public.is_admin());

-- ===== supabase/migrations/0003_site_settings.sql =====
-- SwapFrame site settings + editable content. Run after 0002_admin.sql.
alter table public.profiles add column if not exists full_name text;

create table if not exists public.site_settings (
  id int primary key default 1 check (id = 1),         -- single row
  data jsonb not null default '{}'::jsonb,             -- see src/settings.js DEFAULTS for keys
  updated_at timestamptz not null default now()
);
insert into public.site_settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;
alter table public.site_settings enable row level security;
drop policy if exists "settings_public_read" on public.site_settings;
create policy "settings_public_read" on public.site_settings for select using (true);
drop policy if exists "settings_admin_update" on public.site_settings;
create policy "settings_admin_update" on public.site_settings for update using (public.is_admin()) with check (public.is_admin() and id = 1);

-- Server-side sign-up gate: when signups_open = false, new sign-ups are rejected
-- (except when no admin exists yet, so you can always bootstrap the first admin).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select (data->>'signups_open')::boolean from public.site_settings where id = 1), true) = false
     and exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Sign-ups are currently closed';
  end if;
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;

-- Users may edit only their own display name (role/credits/banned stay admin-only).
create or replace function public.set_my_name(n text) returns void
language sql security definer set search_path = public as $$
  update public.profiles set full_name = left(n, 80) where id = auth.uid();
$$;

-- Broadcast settings changes to open browsers (main site re-themes live).
do $$ begin
  alter publication supabase_realtime add table public.site_settings;
exception when others then null; end $$;

-- ===== supabase/migrations/0004_free_unlimited.sql =====
-- SwapFrame is free and unlimited: credits are no longer used (column kept, nullable, for optional future use).
alter table public.profiles alter column credits drop not null;
alter table public.profiles alter column credits set default null;
alter table public.profiles drop constraint if exists profiles_credits_check;
update public.profiles set credits = null;

-- Default site settings: monochrome palette + Figtree, unlimited swaps, 2–20s clips (free HF Space max is 20s).
-- Merges defaults under any existing values; only replaces the old lime/cyan palette. Safe to re-run.
update public.site_settings
set data = jsonb_build_object(
  'theme','dark','primary','#ffffff','accent','#a6a6a6','font','figtree',
  'daily_limit',0,'min_seconds',2,'max_seconds',20,'max_upload_mb',100,
  'signups_open',true,'maintenance_mode',false
) || (case when coalesce(data->>'primary','#b6ff3b') = '#b6ff3b'
           then data - 'theme' - 'primary' - 'accent' - 'font' - 'daily_limit' - 'min_seconds' - 'max_seconds'
           else data end),
updated_at = now()
where id = 1;

-- ===== supabase/migrations/0005_harden_functions.sql =====
-- Security advisor fixes: helper functions should not be callable by anonymous visitors via /rpc.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_my_name(text) from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_banned() from public, anon;
grant execute on function public.is_admin() to authenticated;   -- used inside RLS policies
grant execute on function public.is_banned() to authenticated;  -- used inside RLS policies
grant execute on function public.set_my_name(text) to authenticated;
