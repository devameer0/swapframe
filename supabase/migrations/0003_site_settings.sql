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
