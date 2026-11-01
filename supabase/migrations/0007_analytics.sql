create table if not exists public.page_views (
  id bigint generated always as identity primary key,
  path text check (char_length(path) <= 200),
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.page_views enable row level security;
drop policy if exists "pv_insert" on public.page_views;
create policy "pv_insert" on public.page_views for insert to anon, authenticated with check (user_id is null or user_id = auth.uid());
drop policy if exists "pv_admin_select" on public.page_views;
create policy "pv_admin_select" on public.page_views for select using (public.is_admin());
grant insert on public.page_views to anon, authenticated;
create index if not exists page_views_created_idx on public.page_views (created_at);

create or replace function public.admin_daily_stats(days int default 30) returns table (
  day date, signups int, total_users int, swaps_ok int, swaps_failed int, swaps_total int, active_users int, views int, visitors int, banned_total int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  with d as (select generate_series((current_date - (least(greatest(days,1),365) - 1)), current_date, interval '1 day')::date as day)
  select d.day,
    (select count(*) from profiles p where p.created_at::date = d.day)::int,
    (select count(*) from profiles p where p.created_at::date <= d.day)::int,
    (select count(*) from jobs j where j.created_at::date = d.day and j.status = 'succeeded')::int,
    (select count(*) from jobs j where j.created_at::date = d.day and j.status = 'failed')::int,
    (select count(*) from jobs j where j.created_at::date = d.day)::int,
    (select count(distinct u) from (
       select j.user_id u from jobs j where j.created_at::date = d.day
       union select a.id from auth.users a where a.last_sign_in_at::date = d.day
       union select v.user_id from page_views v where v.created_at::date = d.day and v.user_id is not null) s)::int,
    (select count(*) from page_views v where v.created_at::date = d.day)::int,
    (select count(distinct coalesce(v.user_id::text, v.id::text)) from page_views v where v.created_at::date = d.day)::int,
    (select count(*) from profiles p where p.banned)::int
  from d order by d.day;
end $$;
revoke execute on function public.admin_daily_stats(int) from public, anon;
grant execute on function public.admin_daily_stats(int) to authenticated;
