-- Photo mode: results are images; uploads cap 15 MB images.
update storage.buckets set allowed_mime_types = array['image/png','image/jpeg','image/webp'], file_size_limit = 15728640 where id = 'uploads';
update storage.buckets set allowed_mime_types = array['image/png','image/jpeg','image/webp','video/mp4'], file_size_limit = 52428800 where id = 'results';
update public.site_settings set data = data || jsonb_build_object('max_upload_mb',15,
  'tagline','// RECAST ANY PHOTO','hero_highlight','Their exact shot.',
  'hero_text','Upload a photo and a character image. SwapFrame puts your character into the shot while keeping the original pose, background and lighting.',
  'sections', jsonb_build_array(
    jsonb_build_object('title','01 · Drop a photo','text','JPG, PNG or WebP, up to 15 MB. A clear, front-facing person works best.'),
    jsonb_build_object('title','02 · Pick a character','text','A clear PNG, JPG or WebP of the character whose face you want in the shot.'),
    jsonb_build_object('title','03 · Get the recast','text','Same pose and framing, new character. Download it or find it in your history.')))
  - 'min_seconds' - 'max_seconds' where id = 1;
alter table public.jobs alter column video_path drop not null;

-- Usernames
alter table public.profiles add column if not exists username text;
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$');
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare u text := nullif(trim(new.raw_user_meta_data->>'username'), '');
begin
  if coalesce((select (data->>'signups_open')::boolean from public.site_settings where id = 1), true) = false
     and exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Sign-ups are currently closed';
  end if;
  if u is not null and (u !~ '^[A-Za-z0-9_]{3,20}$' or exists (select 1 from public.profiles where lower(username) = lower(u))) then
    raise exception 'Username is invalid or already taken';
  end if;
  insert into public.profiles (id, email, username) values (new.id, new.email, u) on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.username_available(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select u ~ '^[A-Za-z0-9_]{3,20}$' and not exists (select 1 from public.profiles where lower(username) = lower(u));
$$;
create or replace function public.email_for_username(u text) returns text
language sql stable security definer set search_path = public as $$
  select email from public.profiles where lower(username) = lower(u) limit 1;
$$;
revoke execute on function public.username_available(text), public.email_for_username(text) from public;
grant execute on function public.username_available(text), public.email_for_username(text) to anon, authenticated;

-- Admin: users with auth info
create or replace function public.admin_users() returns table (id uuid, username text, email text, full_name text, role text, banned boolean,
  usage_count int, created_at timestamptz, confirmed_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query select p.id, p.username, coalesce(a.email, p.email)::text, p.full_name, p.role, p.banned, p.usage_count, p.created_at,
    coalesce(a.email_confirmed_at, a.confirmed_at), a.last_sign_in_at
    from public.profiles p left join auth.users a on a.id = p.id order by p.created_at desc;
end $$;

-- Admin: read-only database browser
create or replace function public.admin_tables() returns table (table_name text, row_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare t text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1 loop
    table_name := t; execute format('select count(*) from public.%I', t) into row_count; return next;
  end loop;
end $$;
create or replace function public.admin_table_rows(t text, lim int default 50, off int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname = t) then
    raise exception 'Unknown table'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select * from public.%I limit %s offset %s) x', t, least(greatest(lim,1),200), greatest(off,0)) into r;
  return r;
end $$;
revoke execute on function public.admin_users(), public.admin_tables(), public.admin_table_rows(text,int,int) from public, anon;
grant execute on function public.admin_users(), public.admin_tables(), public.admin_table_rows(text,int,int) to authenticated;
