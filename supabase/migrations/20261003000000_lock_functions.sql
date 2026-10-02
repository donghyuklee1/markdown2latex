-- Postgres lets PUBLIC execute new functions by default. delete_my_data only
-- ever touches the caller's rows, but anonymous callers have no business
-- calling it at all, and the trigger function is not an API.
revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
revoke execute on function public.trim_user_rows() from public, anon, authenticated;
