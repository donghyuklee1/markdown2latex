import { check, finish } from "./harness";
import { fallbackModels, geminiRequest, rankModels } from "../src/lib/derivation";

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://site.test/api/analyze", { method: "POST", headers: { host: "site.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function main() {
  delete process.env.GEMINI_API_KEY;
  const route = await import("../src/app/api/analyze/route");
  check("GET: no site key reported", JSON.stringify(await route.GET().json()), '{"configured":false}');
  check("POST without a site key: 501, nothing sent", String((await route.POST(req({ input: "$$a=b$$" }))).status), "501");

  process.env.GEMINI_API_KEY = "server-test-key";
  process.env.GEMINI_MODEL = "gemini-test-flash";
  const sent: Array<{ url: string; body: string; key: string }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: String(init?.body ?? ""), key: new Headers(init?.headers).get("x-goog-api-key") ?? "" });
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"title":"t","steps":[],"variables":[],"ideas":[],"ideaLinks":[]}' }] } }] });
  }) as typeof fetch;

  check("GET: site key reported, never the key itself", JSON.stringify(await route.GET().json()), '{"configured":true}');
  check("cross-origin POST refused", String((await route.POST(req({ input: "$$a=b$$" }, { origin: "https://evil.test" }))).status), "403");
  check("empty input refused", String((await route.POST(req({ input: "  " }))).status), "400");
  check("oversized input refused", String((await route.POST(req({ input: "x".repeat(120_001) }))).status), "413");
  check("arbitrary prompts are not forwarded", String(sent.length), "0");

  const ok = await route.POST(req({ input: "$$E = mc^2$$" }, { origin: "https://site.test", "x-forwarded-for": "1.2.3.4" }));
  const out = (await ok.json()) as { text?: string; model?: string };
  check("same-origin POST answers with Gemini's JSON text", ok.status + " " + out.model + " " + (out.text?.startsWith('{"title"') ? "json" : "?"), "200 gemini-test-flash json");
  const gen = sent.find((x) => x.url.includes(":generateContent"))!;
  check("server key goes to Google in a header", gen.key + " " + gen.url.includes("key="), "server-test-key false");
  check("the prompt is built server-side from the document", gen.body === JSON.stringify(geminiRequest("$$E = mc^2$$", "steps", "gemini-test-flash")) ? "same" : "differs", "same");

  // The visitor already made one request above; burn 6 more so 6 remain.
  for (let i = 0; i < 6; i++) await route.POST(req({ input: "$$a=b$$" }, { "x-forwarded-for": "1.2.3.4" }));
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) codes.push((await route.POST(req({ input: "$$a=b$$" }, { "x-forwarded-for": "1.2.3.4" }))).status);
  check("per-visitor limit: 12 requests (6 two-part analyses) per window, then 429", codes.join(","), "200,200,200,200,200,429");
  check("another visitor is unaffected", String((await route.POST(req({ input: "$$a=b$$" }, { "x-forwarded-for": "5.6.7.8" }))).status), "200");

  // A model under "high demand": one retry, then the next model answers.
  const tried: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("/models?")) return Response.json({ models: [{ name: "models/gemini-test-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-stable-flash", supportedGenerationMethods: ["generateContent"] }] });
    const m = /models\/([^:]+):/.exec(u)![1];
    tried.push(m);
    if (m === "gemini-test-flash") return Response.json({ error: { message: "high demand" } }, { status: 503 });
    return Response.json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
  }) as typeof fetch;
  const fb = await route.POST(req({ input: "$$a=b$$" }, { "x-forwarded-for": "9.9.9.9" }));
  check("503: retried once, then a fallback model answers", fb.status + " " + tried.join(",") + " " + ((await fb.json()) as { model: string }).model, "200 gemini-test-flash,gemini-test-flash,gemini-stable-flash gemini-stable-flash");

  globalThis.fetch = (async (url: string) =>
    String(url).includes("/models?") ? Response.json({ models: [] }) : Response.json({ error: {} }, { status: 503 })) as typeof fetch;
  const busy = await route.POST(req({ input: "$$a=b$$" }, { "x-forwarded-for": "9.9.9.8" }));
  check("every model busy: a clear 503, not a raw Gemini error", busy.status + " " + ((await busy.json()) as { error: string }).error, "503 Gemini is overloaded right now - try again in a minute.");

  // A part is chosen by the client; anything else means "steps".
  let lastBody = "";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes(":generateContent")) lastBody = String(init?.body ?? "");
    return String(url).includes("/models?") ? Response.json({ models: [] }) : Response.json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
  }) as typeof fetch;
  await route.POST(req({ input: "$$a=b$$", part: "glossary" }, { "x-forwarded-for": "7.7.7.1" }));
  check("part: glossary requested", String(lastBody.includes("ideaLinks")), "true");
  await route.POST(req({ input: "$$a=b$$", part: "anything" }, { "x-forwarded-for": "7.7.7.2" }));
  check("part: unknown falls back to steps", String(lastBody.includes("ideaLinks")), "false");

  // A model that refuses the thinking setting is asked again without it.
  const bodies: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/models?")) return Response.json({ models: [] });
    const b = String(init?.body ?? "");
    bodies.push(b);
    return b.includes("thinkingConfig") ? Response.json({ error: { message: "Thinking is not supported by this model." } }, { status: 400 }) : Response.json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
  }) as typeof fetch;
  process.env.GEMINI_MODEL = "gemini-3.9-flash";
  const th = await route.POST(req({ input: "$$a=b$$" }, { "x-forwarded-for": "7.7.7.3" }));
  check("thinking refused: retried without it", th.status + " " + bodies.map((b) => (b.includes("thinkingConfig") ? "T" : "-")).join(""), "200 T-");

  check(
    "fallback order: chosen first, then stable before preview, Flash before Pro",
    fallbackModels("gemini-3.8-flash", [{ id: "gemini-3.8-flash", label: "" }, { id: "gemini-3.5-pro", label: "" }, { id: "gemini-3.5-flash-preview", label: "" }, { id: "gemini-3.5-flash", label: "" }]).join(" "),
    "gemini-3.8-flash gemini-3.5-flash gemini-3.5-pro",
  );

  check(
    "model ranking: newest Flash first, non-text models skipped",
    rankModels({ models: [
      { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    ] }).map((m) => m.id).join(" "),
    "gemini-2.5-flash gemini-2.5-pro gemini-2.0-flash",
  );
  finish("api");
}
void main();
