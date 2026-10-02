/**
 * gemini.ts - the browser talks to Google's Gemini API directly with the
 * user's own key (there is no server of ours in between, and no shared key).
 * The key travels only to Google, in a header. Every request is a prompt from
 * lib/derivation (or lib/ocr) with a JSON response schema, and every answer is
 * validated before use. Requests can be cancelled (AbortSignal), so a stale
 * background analysis never wastes the user's quota after the text changes.
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

export async function call(path: string, key: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(API + path, { ...init, headers: { "content-type": "application/json", "x-goog-api-key": key, ...(init?.headers ?? {}) } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
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

/* The model list doubles as the key check; one call per key per session. */
const modelCache = new Map<string, Promise<ModelInfo[]>>();
export function listModels(key: string): Promise<ModelInfo[]> {
  let p = modelCache.get(key);
  if (!p) {
    p = call("/models?pageSize=200", key).then(rankModels);
    p.catch(() => modelCache.delete(key));
    modelCache.set(key, p);
  }
  return p;
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
 * One structured request with the user's own key, straight from the browser
 * to Google. `build(model, thinking)` makes the body. A busy model (503 "high
 * demand", 429, 500) is retried once after a short pause, then the next model
 * in line is tried; a model that rejects the thinking setting is asked again
 * without it. Returns the parsed JSON answer and the model that gave it.
 */
export async function generateJson(build: (model: string, thinking: boolean) => object, key: string, model: string, signal?: AbortSignal): Promise<PartAnswer> {
  let models = [model];
  let last: AiError | null = null;
  for (let i = 0; i < models.length; i++) {
    let thinking = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const body = JSON.stringify(build(models[i], thinking));
        const answer = geminiAnswer(await call("/models/" + encodeURIComponent(models[i]) + ":generateContent", key, { method: "POST", body, signal }));
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
  throw last ?? new AiError("Gemini did not answer.");
}

/** One part of the derivation analysis. */
export function analyzePart(input: string, part: AiPart, key: string, model: string, signal?: AbortSignal): Promise<PartAnswer> {
  return generateJson((m, thinking) => geminiRequest(input, part, m, thinking), key, model, signal);
}
