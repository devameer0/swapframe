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
