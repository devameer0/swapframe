-- Admin analytics: bucket raw event timestamps by any interval (seconds) over a range.
create or replace function public.admin_bucket_stats(bucket_seconds int, since timestamptz default null) returns table (
  bucket timestamptz, signups int, swaps_ok int, swaps_failed int, views int, signins int, active_users int, users_before int)
language plpgsql stable security definer set search_path = public as $$
declare b int := greatest(bucket_seconds, 60);
        st timestamptz := coalesce(since, (select min(created_at) from profiles), now() - interval '30 days');
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  with ev as (
    select 's'::text k, p.created_at ts, p.id u from profiles p where p.created_at >= st
    union all select case j.status when 'succeeded' then 'o' when 'failed' then 'f' else 'j' end, j.created_at, j.user_id from jobs j where j.created_at >= st
    union all select 'v', v.created_at, v.user_id from page_views v where v.created_at >= st
    union all select 'i', a.last_sign_in_at, a.id from auth.users a where a.last_sign_in_at >= st
  ), bk as (select to_timestamp(floor(extract(epoch from ts) / b) * b) bt, k, u from ev)
  select bt,
    count(*) filter (where k = 's')::int, count(*) filter (where k = 'o')::int, count(*) filter (where k = 'f')::int,
    count(*) filter (where k = 'v')::int, count(*) filter (where k = 'i')::int,
    count(distinct u) filter (where k <> 's')::int,
    (select count(*) from profiles p where p.created_at < st)::int
  from bk group by bt order by bt;
end $$;
revoke execute on function public.admin_bucket_stats(int, timestamptz) from public, anon;
grant execute on function public.admin_bucket_stats(int, timestamptz) to authenticated;
