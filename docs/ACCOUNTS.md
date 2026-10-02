# Accounts: Google / GitHub sign-in and cloud sync

Signing in is optional. Without an account everything still works and is saved
in the browser; with one, a user's **history** (snapshots), **analyses** and
**preferences** (theme, palette, font size, cleaning options, snippets) follow
them to every device. The Gemini API key is never synced.

## How it scales

- **No server of ours in the path.** The browser talks to Supabase directly
  (PostgREST over HTTPS). Supabase pools database connections, so a burst of
  users is a burst of small HTTP requests, not of connections.
- **Every user is a separate slice.** All tables lead with `user_id`, every
  query filters on it, and the history page query is served by the
  `(user_id, created_at desc)` index - a user's request costs the same with
  ten users or a million.
- **Row-level security is the access control.** The public anon key in the
  page can only do what the policies allow: a user reads and writes their own
  rows, nothing else (`tests/db.spec.ts` runs the real schema to prove it).
- **Local first.** The app never waits on the network. Snapshots are queued,
  deduplicated by content hash, uploaded in batches of 25 a few seconds after
  they are taken, and retried with exponential backoff (2 s ... 5 min) when
  offline. Preferences are pushed 2.5 s after a change and pulled on focus.
- **Bounded growth.** Uploads are idempotent upserts; a trigger keeps each
  user's newest 500 snapshots and 200 analyses.
- **Lazy.** Visitors who never sign in never download the Supabase library.

## Setup (once, about 10 minutes)

1. **Create a Supabase project** at <https://supabase.com/dashboard> (free tier
   is fine). In *SQL Editor*, paste and run
   `supabase/migrations/20261002000000_accounts.sql`.
2. **URLs.** *Authentication -> URL Configuration*: set **Site URL** to
   `https://markdown2latex.vercel.app` and add these **Redirect URLs**:
   `https://markdown2latex.vercel.app/**`, `http://localhost:3000/**`.
3. **GitHub.** <https://github.com/settings/developers> -> *New OAuth App*.
   Homepage `https://markdown2latex.vercel.app`, callback
   `https://<project-ref>.supabase.co/auth/v1/callback`. Copy the client ID and
   a new client secret into Supabase *Authentication -> Sign In / Providers ->
   GitHub*, and enable it.
4. **Google.** <https://console.cloud.google.com/apis/credentials> ->
   *Create credentials -> OAuth client ID -> Web application*. Authorised
   JavaScript origin `https://markdown2latex.vercel.app`; redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`. (First time: set up the
   OAuth consent screen, scopes `email`, `profile`, `openid`.) Paste the ID and
   secret into Supabase's *Google* provider and enable it.
5. **Vercel env vars** (*Settings -> Project Settings -> API* in Supabase has both):
   ```bash
   vercel env add NEXT_PUBLIC_SUPABASE_URL production       # https://<ref>.supabase.co
   vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production  # the "anon public" key
   ```
   These are public by design (they are in every page); row-level security is
   what protects the data. Redeploy - `NEXT_PUBLIC_*` values are built in.

For local development put the same two lines in `.env.local`.
