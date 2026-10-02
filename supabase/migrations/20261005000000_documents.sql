-- Documents (editor tabs) per account, so they follow the user and so a
-- signed-out device can be wiped without losing anything. One row per tab;
-- keyed and indexed by user; row-level security as everywhere else.

create table if not exists public.documents (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null check (char_length(id) <= 40),
  title       text not null default '' check (char_length(title) <= 200),
  text        text check (text is null or char_length(text) <= 500000),
  position    integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists documents_user_order on public.documents (user_id, position);

alter table public.documents enable row level security;
drop policy if exists "own documents" on public.documents;
create policy "own documents" on public.documents for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- At most 100 documents per account (the editor keeps 12 open).
create or replace function public.trim_user_documents() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.documents d
   where d.user_id = (select auth.uid())
     and d.id in (select id from public.documents
                   where user_id = (select auth.uid())
                   order by updated_at desc offset 100);
  return null;
end $$;
revoke execute on function public.trim_user_documents() from public, anon, authenticated;
drop trigger if exists documents_trim on public.documents;
create trigger documents_trim after insert on public.documents
  for each statement execute function public.trim_user_documents();

-- "Delete cloud data" includes documents.
create or replace function public.delete_my_data() returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.snapshots     where user_id = (select auth.uid());
  delete from public.analyses      where user_id = (select auth.uid());
  delete from public.user_settings where user_id = (select auth.uid());
  delete from public.documents     where user_id = (select auth.uid());
  perform public.set_gemini_key(null);
end $$;
revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
