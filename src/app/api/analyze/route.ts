/**
 * /api/analyze - "Analyze with Gemini" for visitors without their own key.
 *
 * The site's key (GEMINI_API_KEY, a server-side secret) never reaches the
 * browser. The route takes only the document, builds the derivation prompt
 * itself (lib/derivation.ts), so it cannot be used as a general Gemini proxy,
 * and limits each visitor (per IP, per server instance - best effort) plus a
 * daily total that protects the free quota. Nothing is stored or logged.
 */
import { fallbackModels, geminiAnswer, geminiRequest, rankModels, retryable, type ModelInfo } from "@/lib/derivation";

export const maxDuration = 60;

const API = "https://generativelanguage.googleapis.com/v1beta";
const MAX_INPUT = 120_000;
const PER_VISITOR = { count: 6, windowMs: 10 * 60_000 };
const PER_DAY = Number(process.env.GEMINI_DAILY_LIMIT) || 400;

const visitors = new Map<string, number[]>();
let day = { date: "", count: 0 };
let ranked: ModelInfo[] | null = null;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function allow(ip: string): string | null {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (day.date !== today) day = { date: today, count: 0 };
  if (day.count >= PER_DAY) return "The site's free daily analysis quota is used up - add your own free key (key icon) or try tomorrow.";
  const recent = (visitors.get(ip) ?? []).filter((t) => now - t < PER_VISITOR.windowMs);
  if (recent.length >= PER_VISITOR.count) return "Too many analyses in a short time - wait a few minutes, or add your own free key (key icon).";
  recent.push(now);
  visitors.set(ip, recent);
  if (visitors.size > 5000) visitors.clear();
  day.count++;
  return null;
}

async function models(key: string): Promise<string[]> {
  if (!ranked?.length) {
    const res = await fetch(API + "/models?pageSize=200", { headers: { "x-goog-api-key": key } }).catch(() => null);
    ranked = res?.ok ? rankModels(await res.json().catch(() => ({}))) : [];
  }
  return fallbackModels(process.env.GEMINI_MODEL || ranked[0]?.id || "gemini-flash-latest", ranked);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function GET() {
  return json({ configured: !!process.env.GEMINI_API_KEY });
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json({ error: "This site has no Gemini key - add your own free key (key icon)." }, 501);

  // Same-origin only: other sites cannot spend this quota from their pages.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return json({ error: "Cross-origin requests are not allowed." }, 403);

  const body = (await request.json().catch(() => null)) as { input?: unknown } | null;
  const input = typeof body?.input === "string" ? body.input : "";
  if (!input.trim()) return json({ error: "Nothing to analyse." }, 400);
  if (input.length > MAX_INPUT) return json({ error: "The document is too long for the shared analysis - use your own key for long documents." }, 413);

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const denied = allow(ip);
  if (denied) return json({ error: denied }, 429);

  // A busy model (503 "high demand", 429, 500) gets one retry after a pause,
  // then the next model in line; a retired one (404) is skipped at once.
  const payload = JSON.stringify(geminiRequest(input));
  let lastStatus = 0;
  for (const m of await models(key)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(API + "/models/" + encodeURIComponent(m) + ":generateContent", {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: payload,
        });
      } catch {
        return json({ error: "Could not reach Gemini." }, 502);
      }
      const answer = await res.json().catch(() => ({}));
      if (res.ok) {
        const out = geminiAnswer(answer);
        return "error" in out ? json({ error: out.error }, 502) : json({ text: out.text, model: m });
      }
      lastStatus = res.status;
      if (res.status === 404) {
        ranked = null;
        break;
      }
      if (!retryable(res.status)) return json({ error: "Gemini error " + res.status + "." }, 502);
      if (attempt === 0) await wait(1200 + Math.random() * 800);
    }
  }
  return lastStatus === 429
    ? json({ error: "The site's Gemini quota is busy - try again in a minute, or add your own free key (key icon)." }, 429)
    : json({ error: "Gemini is overloaded right now - try again in a minute." }, 503);
}
