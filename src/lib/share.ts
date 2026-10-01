/**
 * share.ts - shareable links that carry the input in the URL fragment.
 *
 * The fragment (`#...`) is never sent in an HTTP request, so a shared snippet
 * goes from one browser to another without touching any server - including
 * whichever one hosts this site. The text is deflate-compressed and base64url
 * encoded, which keeps a typical LLM answer to a few hundred characters.
 *
 * CompressionStream is a standard web API (every current browser, and Node 18+
 * for the tests); there is no DOM access here.
 */

export const SHARE_PREFIX = "#s=";

/** Shared links stop being practical past this; most chat apps truncate them. */
export const SHARE_MAX_CHARS = 100_000;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(src: string): Uint8Array {
  const b64 = src.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Text -> `#s=...` fragment. */
export async function encodeShare(text: string): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw"));
  return SHARE_PREFIX + toBase64Url(packed);
}

/** `#s=...` fragment -> text, or null when the hash is not a (valid) share. */
export async function decodeShare(hash: string): Promise<string | null> {
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  try {
    const bytes = await pipe(fromBase64Url(hash.slice(SHARE_PREFIX.length)), new DecompressionStream("deflate-raw"));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Truncated by a chat app, mangled by a mail client: report, never throw.
    return null;
  }
}
