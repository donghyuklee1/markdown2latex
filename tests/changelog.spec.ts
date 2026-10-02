import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, finish } from "./harness";
import { APP_VERSION, CHANGELOG } from "../src/lib/changelog";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
check("the app's version is package.json's", APP_VERSION, pkg.version);
const n = (v: string) => v.split(".").reduce((a, x) => a * 1000 + Number(x), 0);
check("newest first, versions strictly descending", String(CHANGELOG.every((r, i) => i === 0 || n(CHANGELOG[i - 1].version) > n(r.version))), "true");
check("dates never go forward down the list", String(CHANGELOG.every((r, i) => i === 0 || CHANGELOG[i - 1].date >= r.date)), "true");
check("every release has a title and short notes", String(CHANGELOG.every((r) => r.title && r.notes.length && r.notes.every((x) => x.length <= 120))), "true");
finish("changelog");
