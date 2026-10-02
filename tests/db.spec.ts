/**
 * The accounts schema (supabase/migrations) run for real in PGlite - Postgres
 * compiled to WebAssembly - with a small stand-in for Supabase's auth schema.
 * Checks the guarantees the app relies on: row-level isolation between users,
 * idempotent upserts, the per-user caps, and "delete my data".
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, finish } from "./harness";

type Row = Record<string, unknown>;

async function main() {
  const db = new PGlite();
  // Minimal stand-in for Supabase's auth schema and roles.
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
    create role authenticated;
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
  `);
  await db.exec(readFileSync(join(process.cwd(), "supabase", "migrations", "20261002000000_accounts.sql"), "utf8"));
  await db.exec(`create role anon;`);
  await db.exec(readFileSync(join(process.cwd(), "supabase", "migrations", "20261003000000_lock_functions.sql"), "utf8"));
  // Stand-in for Supabase Vault: same functions and view; the real one encrypts.
  await db.exec(`
    create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
    create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid
      language sql as $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
    create function vault.update_secret(secret_id uuid, new_secret text default null) returns void
      language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  `);
  await db.exec(readFileSync(join(process.cwd(), "supabase", "migrations", "20261004000000_gemini_key_vault.sql"), "utf8"));
  await db.exec(readFileSync(join(process.cwd(), "supabase", "migrations", "20261005000000_documents.sql"), "utf8"));
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;`);
  const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
  const as = async (uid: string, sql: string, params?: unknown[]) => {
    await db.exec(`reset role; select set_config('request.jwt.sub', '${uid}', false); set role authenticated;`);
    return db.query(sql, params);
  };
  const ok = (name: string, cond: boolean) => check(name, String(cond), "true");

  await as(A, "insert into snapshots (text_hash, doc_title, text) values ('h1','A doc','alpha text')");
  await as(B, "insert into snapshots (text_hash, doc_title, text) values ('h1','B doc','beta text')");
  ok("each user sees only their own rows", (await as(A, "select doc_title from snapshots")).rows.map((r) => (r as { doc_title: string }).doc_title).join() === "A doc");
  ok("user_id defaults to the caller", ((await as(B, "select user_id from snapshots")).rows[0] as Row).user_id === B);
  let threw: boolean = false; try { await as(A, `insert into snapshots (user_id, text_hash, text) values ('${B}','x','spoof')`); } catch { threw = true; }
  ok("cannot write rows as someone else", threw);
  await as(A, "update snapshots set doc_title = 'hacked' where user_id = $1", [B]);
  ok("cannot update someone else's rows", ((await as(B, "select doc_title from snapshots")).rows[0] as Row).doc_title === "B doc");
  await as(A, "insert into snapshots (text_hash, text) values ('h1','alpha text') on conflict (user_id, text_hash) do nothing");
  ok("same text twice is one row (upsert)", ((await as(A, "select count(*)::int n from snapshots")).rows[0] as Row).n === 1);
  ok("preview column generated", ((await as(A, "select preview from snapshots")).rows[0] as Row).preview === "alpha text");
  threw = false; try { await as(A, "insert into snapshots (text_hash, text, reason) values ('h2','t','evil')"); } catch { threw = true; }
  ok("reason is constrained", threw);

  // Cap: insert 520 in one statement, 500 remain; B untouched.
  await as(A, "insert into snapshots (text_hash, text, created_at) select 'k'||g, 't'||g, now() - (g || ' seconds')::interval from generate_series(1,520) g");
  const n = ((await as(A, "select count(*)::int n from snapshots")).rows[0] as Row).n;
  ok("history capped at 500 per user (got " + n + ")", n === 500);
  ok("the cap keeps the newest", ((await as(A, "select count(*)::int n from snapshots where text_hash = 'k1'")).rows[0] as Row).n === 1 && ((await as(A, "select count(*)::int n from snapshots where text_hash = 'k520'")).rows[0] as Row).n === 0);
  ok("other users unaffected by the cap", ((await as(B, "select count(*)::int n from snapshots")).rows[0] as Row).n === 1);

  await as(A, `insert into analyses (input_hash, model, result) values ('i1','m','{"steps":[]}')`);
  await as(A, `insert into user_settings (settings) values ('{"cleanmath:theme:v1":"dark"}') on conflict (user_id) do update set settings = excluded.settings`);
  await as(B, `insert into user_settings (settings) values ('{}')`);
  ok("settings: one row per user, private", ((await as(A, "select count(*)::int n from user_settings")).rows[0] as Row).n === 1);
  await as(A, "select delete_my_data()");
  const left = (await as(A, "select (select count(*) from snapshots)::int s, (select count(*) from analyses)::int a, (select count(*) from user_settings)::int u")).rows[0] as Row;
  ok("delete_my_data removes everything of the caller's", left.s === 0 && left.a === 0 && left.u === 0);
  ok("delete_my_data leaves others alone", ((await as(B, "select count(*)::int n from snapshots")).rows[0] as Row).n === 1 && ((await as(B, "select count(*)::int n from user_settings")).rows[0] as Row).n === 1);
  const plan = (await as(A, "explain select id from snapshots where user_id = auth.uid() order by created_at desc limit 30")).rows.map((r) => (r as Record<string, string>)["QUERY PLAN"]).join(" ");
  ok("history page query uses the (user_id, created_at) index", plan.includes("snapshots_user_recent"));
  // The Gemini key in Vault: per user, reachable only through the two functions.
  const key = async (uid: string) => ((await as(uid, "select get_gemini_key() k")).rows[0] as Row).k;
  await as(A, "select set_gemini_key('AIza-alpha')");
  ok("a saved key comes back to its owner", (await key(A)) === "AIza-alpha");
  ok("nobody else gets it", (await key(B)) === null);
  await as(A, "select set_gemini_key('AIza-beta')");
  await db.exec("reset role;");
  const secretsOfA = ((await db.query("select count(*)::int n from vault.secrets where name = $1", ["gemini:" + A])).rows[0] as Row).n;
  ok("saving again replaces it (one secret)", (await key(A)) === "AIza-beta" && secretsOfA === 1);
  ok("the pointer table is not readable directly", (await as(A, "select count(*)::int n from user_secrets")).rows.length === 1 && ((await as(A, "select count(*)::int n from user_secrets")).rows[0] as Row).n === 0);
  let vaultRead = true;
  try {
    await as(A, "select * from vault.secrets");
  } catch {
    vaultRead = false;
  }
  ok("the vault itself is not readable by users", !vaultRead);
  await as(A, "select set_gemini_key('')");
  ok("an empty key removes it", (await key(A)) === null);
  await db.exec("reset role;");
  ok("and its vault secret is gone", ((await db.query("select count(*)::int n from vault.secrets")).rows[0] as Row).n === 0);
  await as(B, "select set_gemini_key('AIza-b')");
  await as(B, "select delete_my_data()");
  ok("delete_my_data removes the key too", (await key(B)) === null);

  // Documents: private per account, and part of "delete my data".
  await db.exec("reset role;");
  await db.exec(`grant select, insert, update, delete on public.documents to authenticated;`);
  await as(A, "insert into documents (id, title, text, position) values ('d1', 'A notes', 'alpha', 0)");
  await as(B, "insert into documents (id, title, text, position) values ('d1', 'B notes', 'beta', 0)");
  ok("documents: each account sees only its own", ((await as(A, "select string_agg(title, ',') t from documents")).rows[0] as Row).t === "A notes");
  ok("documents: the same tab id in two accounts does not collide", ((await as(B, "select text from documents where id = 'd1'")).rows[0] as Row).text === "beta");
  await as(A, "insert into documents (id, title, text) select 'x' || g, 't', 'x' from generate_series(1, 120) g");
  ok("documents: capped at 100 per account", ((await as(A, "select count(*)::int n from documents")).rows[0] as Row).n === 100);
  await as(A, "select delete_my_data()");
  ok("documents: delete_my_data removes them", ((await as(A, "select count(*)::int n from documents")).rows[0] as Row).n === 0 && ((await as(B, "select count(*)::int n from documents")).rows[0] as Row).n === 1);

  await db.exec("reset role; set role anon;");
  let anonCalled = true;
  try {
    await db.query("select delete_my_data()");
  } catch {
    anonCalled = false;
  }
  await db.exec("reset role;");
  ok("anonymous callers cannot run delete_my_data", !anonCalled);
  let anonKey = true;
  try {
    await db.exec("set role anon;");
    await db.query("select get_gemini_key()");
  } catch {
    anonKey = false;
  }
  await db.exec("reset role;");
  ok("anonymous callers cannot read keys", !anonKey);
  finish("db");
}
void main();
