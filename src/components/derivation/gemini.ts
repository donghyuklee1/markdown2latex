/**
 * gemini.ts - two ways to reach Gemini, both only when the user clicks Analyze:
 *
 *  - with the user's own key: the browser calls Google directly; the key lives
 *    in this browser's storage and travels only to Google, in a header;
 *  - without one: the site's route (/api/analyze) calls Gemini with the site's
 *    key. It accepts only the document and builds the prompt itself, so it is
 *    not a general-purpose proxy, and it rate-limits each visitor.
 *
 * Either way the answer is validated by `mergeAi` against the offline model.
 */
import { geminiAnswer, geminiRequest, mergeAi, rankModels, type Derivation, type ModelInfo } from "@/lib/derivation";

export type { ModelInfo };

const API = "https://generativelanguage.googleapis.com/v1beta";

export class AiError extends Error {}

async function call(path: string, key: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(API + path, { ...init, headers: { "content-type": "application/json", "x-goog-api-key": key, ...(init?.headers ?? {}) } });
  } catch {
    throw new AiError("Could not reach Google - check your connection.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    const msg = body.error?.message ?? res.statusText;
    if (res.status === 400 && /API key/i.test(msg)) throw new AiError("That API key was rejected. Create one at aistudio.google.com/apikey.");
    if (res.status === 403) throw new AiError("This key cannot use the Gemini API: " + msg);
    if (res.status === 429) throw new AiError("Free-tier rate limit reached - wait a minute and try again.");
    throw new AiError("Gemini error " + res.status + ": " + msg);
  }
  return body;
}

export async function listModels(key: string): Promise<ModelInfo[]> {
  return rankModels(await call("/models?pageSize=200", key));
}

function parse(text: string, base: Derivation): Derivation {
  try {
    return mergeAi(JSON.parse(text), base);
  } catch {
    throw new AiError("Gemini's answer was not valid JSON - try again.");
  }
}

/** With the user's own key, straight from the browser to Google. */
export async function analyzeDerivation(input: string, base: Derivation, key: string, model: string): Promise<Derivation> {
  const body = await call("/models/" + encodeURIComponent(model) + ":generateContent", key, { method: "POST", body: JSON.stringify(geminiRequest(input)) });
  const answer = geminiAnswer(body);
  if ("error" in answer) throw new AiError(answer.error);
  return parse(answer.text, base);
}

/** Whether this deployment has a site key (false on static hosts and locally without one). */
export async function siteAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/analyze", { method: "GET" });
    return res.ok && ((await res.json()) as { configured?: boolean }).configured === true;
  } catch {
    return false;
  }
}

/** Without a key: through the site's own route. */
export async function analyzeViaSite(input: string, base: Derivation): Promise<{ result: Derivation; model: string }> {
  let res: Response;
  try {
    res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }) });
  } catch {
    throw new AiError("Could not reach the server - check your connection.");
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string; model?: string; error?: string };
  if (!res.ok || !body.text) throw new AiError(body.error ?? "Analysis failed (" + res.status + ").");
  return { result: parse(body.text, base), model: body.model ?? "" };
}
