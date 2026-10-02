-- markdown2Latex accounts: history, analyses and preferences per user.
--
-- Scaling notes
--  * Every table leads with user_id and every query filters on it, so each
--    user reads a small slice through an index, whatever the total size.
--  * Row-level security is the access control: the browser talks to the
--    database directly with the public anon key, and a user can only ever see
--    or change their own rows. Policies use (select auth.uid()) so Postgres
--    evaluates it once per statement, not once per row.
--  * Writes are idempotent upserts keyed by content hash, so retries and the
--    same text saved twice never create duplicates.
--  * History is capped per user by a trigger, so no account grows unbounded.

create table if not exists public.snapshots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text_hash   text not null check (char_length(text_hash) <= 40),
  doc_title   text not null default '' check (char_length(doc_title) <= 200),
  text        text not null check (char_length(text) <= 200000),
  preview     text generated always as (left(text, 240)) stored,
  reason      text not null default 'idle' check (reason in ('idle', 'copy', 'replace')),
  created_at  timestamptz not null default now(),
  unique (user_id, text_hash)
);
create index if not exists snapshots_user_recent on public.snapshots (user_id, created_at desc);

create table if not exists public.analyses (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  input_hash  text not null check (char_length(input_hash) <= 40),
  model       text not null default '' check (char_length(model) <= 80),
  result      jsonb not null check (pg_column_size(result) <= 400000),
  created_at  timestamptz not null default now(),
  primary key (user_id, input_hash)
);
create index if not exists analyses_user_recent on public.analyses (user_id, created_at desc);

create table if not exists public.user_settings (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb check (pg_column_size(settings) <= 400000),
  updated_at  timestamptz not null default now()
);

alter table public.snapshots     enable row level security;
alter table public.analyses      enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "own snapshots" on public.snapshots;
create policy "own snapshots" on public.snapshots for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own analyses" on public.analyses;
create policy "own analyses" on public.analyses for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Keep the newest 500 snapshots and 200 analyses per user. Runs per statement
-- (a batch of inserts trims once) and only touches that user's rows.
create or replace function public.trim_user_rows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'snapshots' then
    delete from public.snapshots s
     where s.user_id = (select auth.uid())
       and s.id in (select id from public.snapshots
                     where user_id = (select auth.uid())
                     order by created_at desc offset 500);
  else
    delete from public.analyses a
     where a.user_id = (select auth.uid())
       and a.input_hash in (select input_hash from public.analyses
                             where user_id = (select auth.uid())
                             order by created_at desc offset 200);
  end if;
  return null;
end $$;

drop trigger if exists snapshots_trim on public.snapshots;
create trigger snapshots_trim after insert on public.snapshots
  for each statement execute function public.trim_user_rows();
drop trigger if exists analyses_trim on public.analyses;
create trigger analyses_trim after insert on public.analyses
  for each statement execute function public.trim_user_rows();

-- "Delete my cloud data" in the app: one call removes everything of the caller's.
create or replace function public.delete_my_data() returns void
language sql security invoker set search_path = public as $$
  delete from public.snapshots     where user_id = (select auth.uid());
  delete from public.analyses      where user_id = (select auth.uid());
  delete from public.user_settings where user_id = (select auth.uid());
$$;
grant execute on function public.delete_my_data() to authenticated;
