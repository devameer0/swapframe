-- Security advisor fixes: helper functions should not be callable by anonymous visitors via /rpc.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_my_name(text) from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_banned() from public, anon;
grant execute on function public.is_admin() to authenticated;   -- used inside RLS policies
grant execute on function public.is_banned() to authenticated;  -- used inside RLS policies
grant execute on function public.set_my_name(text) to authenticated;
