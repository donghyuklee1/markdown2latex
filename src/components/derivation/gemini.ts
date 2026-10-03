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
    /** Google's own message, kept for the details line. */
    readonly detail = "",
    /** How long Google asked us to wait (ms), when it said. */
    readonly retryAfter = 0,
  ) {
    super(message);
  }
}

/** Retry-After header, or the RetryInfo "34s" Google puts in a 429's details. */
function retryAfterMs(res: Response, body: unknown): number {
  const h = Number(res.headers.get("retry-after"));
  if (h > 0) return h * 1000;
  const details = ((body as { error?: { details?: Array<{ retryDelay?: string }> } }).error?.details ?? []).find((d) => d.retryDelay);
  const m = /^(\d+(?:\.\d+)?)s$/.exec(details?.retryDelay ?? "");
  return m ? Number(m[1]) * 1000 : 0;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keys that Google only accepted as a bearer token (remembered for the session). */
const bearerKeys = new Set<string>();

export async function call(path: string, key: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  const send = (bearer: boolean) =>
    fetch(API + path, {
      ...init,
      headers: { "content-type": "application/json", ...(bearer ? { authorization: "Bearer " + key } : { "x-goog-api-key": key }), ...(init?.headers ?? {}) },
    });
  try {
    res = await send(bearerKeys.has(key));
    // Newer "AQ." credentials: if the API-key header is refused, try them as a bearer token once.
    if ((res.status === 401 || res.status === 403) && !bearerKeys.has(key) && key.startsWith("AQ.")) {
      const again = await send(true);
      if (again.ok) bearerKeys.add(key);
      if (again.ok || again.status !== 401) res = again;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new AiError("Could not reach Google - check your connection.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    const msg = body.error?.message ?? res.statusText;
    const after = retryAfterMs(res, body);
    if (res.status === 400 && /API key/i.test(msg)) throw new AiError("That API key was rejected. Create one at aistudio.google.com/apikey.", 400, msg);
    if (res.status === 403) throw new AiError("This key cannot use the Gemini API: " + msg, 403, msg);
    if (res.status === 429) throw new AiError("Free-tier limit reached for this model.", 429, msg, after);
    if (res.status === 503 || res.status === 500 || res.status === 504) throw new AiError(res.status === 504 ? "Gemini took too long to answer." : "Gemini is overloaded right now.", res.status, msg, after);
    throw new AiError("Gemini error " + res.status + ": " + msg, res.status, msg);
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

/** Progress, for "Gemini 3.8 Flash is busy - trying Gemini 2.5 Flash...". */
export type StatusFn = (message: string) => void;

const pretty = (id: string) =>
  id
    .replace(/^gemini-/, "Gemini ")
    .replace(/-(\d{3}|preview.*|exp.*)$/, "")
    .replace(/-/g, " ")
    .replace(/\b(flash|pro|lite)\b/g, (w) => w[0].toUpperCase() + w.slice(1));

/**
 * One structured request with the user's own key, straight from the browser
 * to Google. `build(model, thinking)` makes the body.
 *
 * When a model is busy (503 / 500 / 504 / 429) it gets a second try after a
 * pause - Google's own Retry-After when it gives one, otherwise ~1.5 s with
 * jitter - and then the next model in line (lib/derivation fallbackModels:
 * one per other model family, so a busy family is left quickly). A model that
 * rejects the thinking setting is asked again without it. Only when every
 * model has failed does this throw, naming the models it tried and Google's
 * own message.
 */
export async function generateJson(
  build: (model: string, thinking: boolean) => object,
  key: string,
  model: string,
  signal?: AbortSignal,
  onStatus?: StatusFn,
): Promise<PartAnswer> {
  let models = [model];
  const tried: string[] = [];
  let last: AiError | null = null;
  for (let i = 0; i < models.length; i++) {
    let thinking = true;
    tried.push(models[i]);
    if (i > 0) onStatus?.(pretty(models[i - 1]) + " is busy - trying " + pretty(models[i]) + "...");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const body = JSON.stringify(build(models[i], thinking));
        const answer = geminiAnswer(await call("/models/" + encodeURIComponent(models[i]) + ":generateContent", key, { method: "POST", body, signal }));
        if ("error" in answer) throw new AiError(answer.error);
        return { json: parse(answer.text), model: models[i] };
      } catch (e) {
        if (e instanceof AiError && thinking && rejectsThinking(e.status, e.detail || e.message)) {
          thinking = false;
          continue;
        }
        if (!(e instanceof AiError) || !(retryable(e.status) || e.status === 404)) throw e;
        last = e;
        if (e.status === 404 || attempt > 0) break; // retired, or busy twice: next model
        const pause = Math.min(8000, e.retryAfter || 1200 + Math.random() * 900);
        onStatus?.(pretty(models[i]) + " is busy - retrying in " + Math.ceil(pause / 1000) + " s...");
        await wait(pause);
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      }
    }
    if (i === 0) models = fallbackModels(model, await listModels(key).catch(() => []));
  }
  const names = tried.map(pretty).join(", ");
  if (last?.status === 429)
    throw new AiError("Your free-tier limit is used up on " + names + ". Wait a minute, or choose another model.", 429, last.detail);
  throw new AiError(
    tried.length > 1 ? "Gemini is overloaded - " + names + " all failed. Try again in a minute, or choose another model." : (last?.message ?? "Gemini did not answer."),
    last?.status ?? 0,
    last?.detail ?? "",
  );
}

/** One part of the derivation analysis. */
export function analyzePart(input: string, part: AiPart, key: string, model: string, signal?: AbortSignal, onStatus?: StatusFn): Promise<PartAnswer> {
  return generateJson((m, thinking) => geminiRequest(input, part, m, thinking), key, model, signal, onStatus);
}
