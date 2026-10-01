/**
 * archive.ts - read .tar, .tar.gz, .gz and .zip; write .zip. No dependencies.
 *
 * Research Lab tools take whole projects (an arXiv source package, an Overleaf
 * export, a folder of figures) and some hand one back. Everything here is
 * standard web APIs (DecompressionStream, TextDecoder), so it runs in the
 * browser and under node for the tests - never on a server.
 */

export interface ArchiveFile {
  /** Forward-slash path inside the archive, no leading "./". */
  path: string;
  data: Uint8Array;
}

const utf8 = new TextDecoder("utf-8");
export const textOf = (data: Uint8Array): string => utf8.decode(data);
export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

async function pipe(bytes: Uint8Array, stream: DecompressionStream | CompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
export const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
export const isTar = (b: Uint8Array) => b.length >= 512 && String.fromCharCode(...b.subarray(257, 262)) === "ustar";
export const isPdf = (b: Uint8Array) => String.fromCharCode(...b.subarray(0, 5)) === "%PDF-";

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream("gzip"));
}

const normalizePath = (p: string) => p.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");

/* --------------------------------------------------------------------- tar */

function cstr(b: Uint8Array, start: number, len: number): string {
  let end = start;
  while (end < start + len && b[end] !== 0) end++;
  return utf8.decode(b.subarray(start, end));
}

/** POSIX ustar, with the GNU long-name ('L') and pax ('x' path=) extensions. */
export function untar(bytes: Uint8Array): ArchiveFile[] {
  const files: ArchiveFile[] = [];
  let offset = 0;
  let longName: string | null = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((x) => x === 0)) break; // end-of-archive marker
    const size = parseInt(cstr(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = cstr(header, 345, 155);
    let name = cstr(header, 0, 100);
    if (prefix) name = prefix + "/" + name;
    const dataStart = offset + 512;
    const data = bytes.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = cstr(data, 0, data.length);
      continue;
    }
    if (type === "x") {
      const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(utf8.decode(data));
      if (path) longName = path[1];
      continue;
    }
    if (type === "0" || type === "\0" || type === "7") {
      files.push({ path: normalizePath(longName ?? name), data: data.slice() });
    }
    longName = null;
  }
  return files;
}

/* --------------------------------------------------------------------- zip */

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Reads stored and deflated entries via the central directory (no zip64). */
export async function unzip(bytes: Uint8Array): Promise<ArchiveFile[]> {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-directory record)");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const files: ArchiveFile[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("Corrupt zip central directory");
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue; // directory entry
    const dataStart = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await pipe(raw, new DecompressionStream("deflate-raw"));
    else throw new Error("Unsupported zip compression in " + name);
    files.push({ path: normalizePath(name), data });
  }
  return files;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Write a zip with every entry stored (uncompressed). Images are already
 * compressed and .tex is small, so deflating again buys little; stored entries
 * keep this synchronous and dependency-free. Overleaf's "Upload Zip" reads it.
 */
export function zip(files: ReadonlyArray<ArchiveFile>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const w16 = (v: DataView, o: number, x: number) => v.setUint16(o, x, true);
  const w32 = (v: DataView, o: number, x: number) => v.setUint32(o, x >>> 0, true);

  for (const f of files) {
    const name = enc.encode(normalizePath(f.path));
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    w32(lv, 0, 0x04034b50);
    w16(lv, 4, 20);
    w16(lv, 6, 0x0800); // UTF-8 names
    w16(lv, 8, 0);
    w32(lv, 14, crc);
    w32(lv, 18, f.data.length);
    w32(lv, 22, f.data.length);
    w16(lv, 26, name.length);
    local.set(name, 30);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    w32(cv, 0, 0x02014b50);
    w16(cv, 4, 20);
    w16(cv, 6, 20);
    w16(cv, 8, 0x0800);
    w32(cv, 16, crc);
    w32(cv, 20, f.data.length);
    w32(cv, 24, f.data.length);
    w16(cv, 28, name.length);
    w32(cv, 42, offset);
    cen.set(name, 46);

    chunks.push(local, f.data);
    central.push(cen);
    offset += local.length + f.data.length;
  }

  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  w32(ev, 0, 0x06054b50);
  w16(ev, 8, files.length);
  w16(ev, 10, files.length);
  w32(ev, 12, cenSize);
  w32(ev, 16, offset);

  const out = new Uint8Array(offset + cenSize + 22);
  let p = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/* ------------------------------------------------------------ auto-detect */

/**
 * Whatever came in - .zip, .tar, .tar.gz, or a lone gzipped file (arXiv serves
 * single-file papers as a gzipped .tex) - as a flat list of files.
 */
export async function readArchive(bytes: Uint8Array, fallbackName = "main.tex"): Promise<ArchiveFile[]> {
  if (isZip(bytes)) return unzip(bytes);
  if (isTar(bytes)) return untar(bytes);
  if (isGzip(bytes)) {
    const inner = await gunzip(bytes);
    if (isTar(inner)) return untar(inner);
    return [{ path: fallbackName.replace(/\.gz$/, ""), data: inner }];
  }
  return [{ path: fallbackName, data: bytes }];
}

/** Read files a user picked or dropped, expanding any archives among them. */
export async function readUploads(files: ReadonlyArray<File>): Promise<ArchiveFile[]> {
  const out: ArchiveFile[] = [];
  for (const file of files) {
    const data = new Uint8Array(await file.arrayBuffer());
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (isZip(data) || isTar(data) || (isGzip(data) && /\.(tgz|tar\.gz)$/i.test(file.name))) {
      out.push(...(await readArchive(data, file.name)));
    } else {
      out.push({ path: normalizePath(rel), data });
    }
  }
  return out;
}
