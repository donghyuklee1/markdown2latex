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
import { fallbackModels, geminiAnswer, geminiRequest, rankModels, rejectsThinking, retryable, type AiPart, type ModelInfo } from "@/lib/derivation";

export type { ModelInfo };

const API = "https://generativelanguage.googleapis.com/v1beta";

export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    if (res.status === 400 && /API key/i.test(msg)) throw new AiError("That API key was rejected. Create one at aistudio.google.com/apikey.", 400);
    if (res.status === 403) throw new AiError("This key cannot use the Gemini API: " + msg, 403);
    if (res.status === 429) throw new AiError("Free-tier rate limit reached - wait a minute and try again.", 429);
    if (res.status === 503 || res.status === 500 || res.status === 504) throw new AiError("Gemini is overloaded right now - try again in a minute.", res.status);
    throw new AiError("Gemini error " + res.status + ": " + msg, res.status);
  }
  return body;
}

export async function listModels(key: string): Promise<ModelInfo[]> {
  return rankModels(await call("/models?pageSize=200", key));
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("Gemini's answer was not valid JSON - try again.");
  }
}

export interface PartAnswer {
  json: unknown;
  model: string;
}

/**
 * One part of the analysis with the user's own key, straight from the browser
 * to Google. A busy model (503 "high demand", 429, 500) is retried once after a
 * short pause, then the next model in line is tried; a model that rejects the
 * thinking setting is asked again without it.
 */
export async function analyzePart(input: string, part: AiPart, key: string, model: string): Promise<PartAnswer> {
  let models = [model];
  let last: AiError | null = null;
  for (let i = 0; i < models.length; i++) {
    let thinking = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const body = JSON.stringify(geminiRequest(input, part, models[i], thinking));
        const answer = geminiAnswer(await call("/models/" + encodeURIComponent(models[i]) + ":generateContent", key, { method: "POST", body }));
        if ("error" in answer) throw new AiError(answer.error);
        return { json: parse(answer.text), model: models[i] };
      } catch (e) {
        if (e instanceof AiError && thinking && rejectsThinking(e.status, e.message)) {
          thinking = false;
          continue;
        }
        if (!(e instanceof AiError) || !(retryable(e.status) || e.status === 404)) throw e;
        last = e;
        if (e.status === 404 || attempt > 0) break; // retired, or busy twice: next model
        await wait(700 + Math.random() * 600);
      }
    }
    if (i === 0) models = fallbackModels(model, await listModels(key).catch(() => []));
  }
  throw last ?? new AiError("Analysis failed.");
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

/** One part without a key of the user's own: through the site's route. */
export async function analyzePartViaSite(input: string, part: AiPart): Promise<PartAnswer> {
  let res: Response;
  try {
    res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input, part }) });
  } catch {
    throw new AiError("Could not reach the server - check your connection.");
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string; model?: string; error?: string };
  if (!res.ok || !body.text) throw new AiError(body.error ?? "Analysis failed (" + res.status + ").", res.status);
  return { json: parse(body.text), model: body.model ?? "" };
}
