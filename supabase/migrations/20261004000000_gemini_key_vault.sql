-- The user's own Gemini API key, kept in their account so their other devices
-- get it. Stored with Supabase Vault (encrypted at rest, decrypted only inside
-- the database); the table holds just a pointer to the vault secret, has RLS
-- on and no policies, so it is reachable only through the two functions
-- below, which act on the caller's own row and nobody else's.

create table if not exists public.user_secrets (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  gemini_secret_id uuid,
  updated_at       timestamptz not null default now()
);
alter table public.user_secrets enable row level security;

create or replace function public.set_gemini_key(new_key text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  select gemini_secret_id into sid from public.user_secrets where user_id = uid;
  if new_key is null or length(trim(new_key)) = 0 then
    if sid is not null then
      delete from vault.secrets where id = sid;
    end if;
    delete from public.user_secrets where user_id = uid;
    return;
  end if;
  if length(new_key) > 200 then
    raise exception 'key too long';
  end if;
  if sid is null then
    sid := vault.create_secret(trim(new_key), 'gemini:' || uid::text, 'Gemini API key');
    insert into public.user_secrets (user_id, gemini_secret_id) values (uid, sid)
      on conflict (user_id) do update set gemini_secret_id = excluded.gemini_secret_id, updated_at = now();
  else
    perform vault.update_secret(sid, trim(new_key));
    update public.user_secrets set updated_at = now() where user_id = uid;
  end if;
end $$;

create or replace function public.get_gemini_key() returns text
language sql stable security definer set search_path = public, vault as $$
  select d.decrypted_secret
    from public.user_secrets u
    join vault.decrypted_secrets d on d.id = u.gemini_secret_id
   where u.user_id = auth.uid();
$$;

revoke execute on function public.set_gemini_key(text) from public, anon;
revoke execute on function public.get_gemini_key() from public, anon;
grant execute on function public.set_gemini_key(text) to authenticated;
grant execute on function public.get_gemini_key() to authenticated;

-- "Delete cloud data" removes the stored key as well.
create or replace function public.delete_my_data() returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.snapshots     where user_id = (select auth.uid());
  delete from public.analyses      where user_id = (select auth.uid());
  delete from public.user_settings where user_id = (select auth.uid());
  perform public.set_gemini_key(null);
end $$;
revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
