/**
 * gemini.ts - the browser talks to Google's Gemini API directly, with the
 * user's own free API key (Google AI Studio). No server of ours in between:
 * the key lives in this browser's storage and travels only to Google, in a
 * header (never in a URL). Called only when the user clicks Analyze.
 */
import { buildPrompt, mergeAi, RESPONSE_SCHEMA, type Derivation } from "@/lib/derivation";

const API = "https://generativelanguage.googleapis.com/v1beta";

export interface ModelInfo {
  id: string;
  label: string;
}

export class AiError extends Error {}

async function call(path: string, key: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(API + path, { ...init, headers: { "content-type": "application/json", "x-goog-api-key": key, ...(init?.headers ?? {}) } });
  } catch {
    throw new AiError("Could not reach Google - check your connection.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
  if (!res.ok) {
    const msg = body.error?.message ?? res.statusText;
    if (res.status === 400 && /API key/i.test(msg)) throw new AiError("That API key was rejected. Create one at aistudio.google.com/apikey.");
    if (res.status === 403) throw new AiError("This key cannot use the Gemini API: " + msg);
    if (res.status === 429) throw new AiError("Free-tier rate limit reached - wait a minute and try again.");
    throw new AiError("Gemini error " + res.status + ": " + msg);
  }
  return body;
}

/** Newest first, Flash models before Pro (they are the free tier's sweet spot). */
export async function listModels(key: string): Promise<ModelInfo[]> {
  const body = (await call("/models?pageSize=200", key)) as {
    models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
  };
  const usable = (body.models ?? []).filter(
    (m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/i.test(m.name) && !/(image|tts|audio|live|embedding|vision|aqa|learnlm)/i.test(m.name),
  );
  const version = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
  const rank = (n: string) => (/flash/.test(n) && !/lite/.test(n) ? 0 : /flash/.test(n) ? 1 : 2) + (/(preview|exp)/.test(n) ? 0.5 : 0);
  return usable
    .sort((a, b) => version(b.name) - version(a.name) || rank(a.name) - rank(b.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName ?? m.name }));
}

/** Gemini's schema dialect wants upper-case type names. */
function geminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toUpperCase() : geminiSchema(v)]),
    );
  }
  return node;
}

/** Ask Gemini to explain the derivation; the answer is validated against `base`. */
export async function analyzeDerivation(input: string, base: Derivation, key: string, model: string): Promise<Derivation> {
  const body = (await call("/models/" + encodeURIComponent(model) + ":generateContent", key, {
    method: "POST",
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(input, base) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: geminiSchema(RESPONSE_SCHEMA),
      },
    }),
  })) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; promptFeedback?: { blockReason?: string } };
  if (body.promptFeedback?.blockReason) throw new AiError("Gemini declined this input (" + body.promptFeedback.blockReason + ").");
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new AiError("Gemini returned an empty answer (" + (body.candidates?.[0]?.finishReason ?? "no reason") + ").");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiError("Gemini's answer was not valid JSON - try again.");
  }
  return mergeAi(json, base);
}
