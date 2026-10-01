import { check, finish } from "../harness";
import { bytesOf, crc32, readArchive, textOf, untar, unzip, zip } from "../../src/lib/lab/archive";

/** Minimal ustar writer, test-only, so untar is checked against a known layout. */
function tar(files: Array<[string, string]>): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const [name, body] of files) {
    const data = bytesOf(body);
    const h = new Uint8Array(512);
    h.set(bytesOf(name), 0);
    h.set(bytesOf(data.length.toString(8).padStart(11, "0") + "\0"), 124);
    h[156] = 48; // '0'
    h.set(bytesOf("ustar\0" + "00"), 257);
    blocks.push(h);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of blocks) out.set(b, p), (p += b.length);
  return out;
}

async function gzip(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}

async function main() {
  check("crc32 of 'hello'", crc32(bytesOf("hello")).toString(16), "3610a686");

  const files = [{ path: "main.tex", data: bytesOf("\\input{sec/a}") }, { path: "sec/a.tex", data: bytesOf("$\\alpha$ 한글") }];
  const back = await unzip(zip(files));
  check("zip -> unzip round-trips paths and UTF-8 contents", back.map((f) => f.path + "=" + textOf(f.data)).join(" | "), "main.tex=\\input{sec/a} | sec/a.tex=$\\alpha$ 한글");

  const t = tar([["./paper/main.tex", "\\documentclass{article}"], ["paper/fig.txt", "x".repeat(700)]]);
  check("untar reads names, strips ./, honours sizes past one block", untar(t).map((f) => f.path + ":" + f.data.length).join(" "), "paper/main.tex:23 paper/fig.txt:700");

  check("readArchive: .tar.gz", (await readArchive(await gzip(t))).map((f) => f.path).join(","), "paper/main.tex,paper/fig.txt");
  check("readArchive: single gzipped .tex (old arXiv papers)", (await readArchive(await gzip(bytesOf("x")), "2301.0001.gz")).map((f) => f.path + "=" + textOf(f.data)).join(), "2301.0001=x");
  finish("archive");
}
void main();
