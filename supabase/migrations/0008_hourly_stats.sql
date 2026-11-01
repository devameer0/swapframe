create or replace function public.admin_hourly_stats(days int default 30) returns table (
  hour timestamptz, signups int, swaps_ok int, swaps_failed int, views int, active_users int, users_before int)
language plpgsql stable security definer set search_path = public as $$
declare st timestamptz := date_trunc('hour', now()) - make_interval(days => least(greatest(days,1),180));
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  with h as (select generate_series(st, date_trunc('hour', now()), interval '1 hour') as hour)
  select h.hour,
    (select count(*) from profiles p where date_trunc('hour', p.created_at) = h.hour)::int,
    (select count(*) from jobs j where date_trunc('hour', j.created_at) = h.hour and j.status = 'succeeded')::int,
    (select count(*) from jobs j where date_trunc('hour', j.created_at) = h.hour and j.status = 'failed')::int,
    (select count(*) from page_views v where date_trunc('hour', v.created_at) = h.hour)::int,
    (select count(distinct u) from (
       select j.user_id u from jobs j where date_trunc('hour', j.created_at) = h.hour
       union select a.id from auth.users a where date_trunc('hour', a.last_sign_in_at) = h.hour
       union select v.user_id from page_views v where date_trunc('hour', v.created_at) = h.hour and v.user_id is not null) s)::int,
    (select count(*) from profiles p where p.created_at < st)::int
  from h order by h.hour;
end $$;
revoke execute on function public.admin_hourly_stats(int) from public, anon;
grant execute on function public.admin_hourly_stats(int) to authenticated;
