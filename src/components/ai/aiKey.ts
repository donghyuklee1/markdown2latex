/**
 * aiKey.ts - the user's own Gemini key: check it, keep it, and switch AI mode.
 *
 * There is no shared key. A visitor pastes their own free key (Google AI
 * Studio); it is checked once (the model list doubles as the check and is
 * cached for the session), kept in this browser, and - when signed in and
 * "keep in my account" is on - stored encrypted in their account so their
 * other devices pick it up. Saving a key turns AI mode on at once: no reload,
 * no extra switch.
 */
import { aiStore } from "@/lib/persistedStore";
import { saveKeyToAccount } from "../account/cloud";
import { AiError, listModels, type ModelInfo } from "../derivation/gemini";

export interface SaveResult {
  models: ModelInfo[];
  /** Whether the key was also stored in the account. */
  synced: boolean;
}

/** Validate, store, turn AI mode on. Throws AiError with a readable message. */
export async function saveKey(raw: string, remember = aiStore.get().remember): Promise<SaveResult> {
  const key = raw.trim();
  if (!/^[\w-]{20,200}$/.test(key)) throw new AiError("That does not look like a Gemini API key (they start with \"AIza\").");
  const models = await listModels(key);
  const prev = aiStore.get();
  const model = prev.model && models.some((m) => m.id === prev.model) ? prev.model : (models[0]?.id ?? "");
  aiStore.set({ apiKey: key, model, mode: true, remember });
  const synced = remember ? await saveKeyToAccount(key) : false;
  return { models, synced };
}

/** Remove the key here (and from the account, when it was kept there). */
export async function forgetKey(): Promise<void> {
  const prev = aiStore.get();
  aiStore.set({ ...prev, apiKey: "", model: "", mode: false });
  if (prev.remember) await saveKeyToAccount(null);
}

/** Keep in the account, or stop doing so (removing the stored copy). */
export async function setRemember(remember: boolean): Promise<void> {
  const prev = aiStore.get();
  aiStore.set({ ...prev, remember });
  if (prev.apiKey) await saveKeyToAccount(remember ? prev.apiKey : null);
}

/** AI mode on/off; on needs a key. */
export function setAiMode(on: boolean): boolean {
  const prev = aiStore.get();
  if (on && !prev.apiKey) return false;
  aiStore.set({ ...prev, mode: on });
  return true;
}

/** The model to use: the chosen one, or the newest Flash this key can use. */
export async function currentModel(): Promise<string> {
  const ai = aiStore.get();
  if (ai.model) return ai.model;
  const model = (await listModels(ai.apiKey))[0]?.id ?? "";
  aiStore.set({ ...aiStore.get(), model });
  return model;
}
