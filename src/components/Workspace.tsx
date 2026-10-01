"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ControlBar from "./ControlBar";
import CopyButton from "./CopyButton";
import MathInput from "./MathInput";
import MathOutput from "./MathOutput";
import { useToast } from "./Toast";
import { cleanMathDetailed, DEFAULT_OPTIONS, type ConfigOptions } from "@/lib/cleaner";
import { DEFAULT_TEXT, EXAMPLES } from "@/lib/defaultText";

const STORAGE_KEY = "cleanmath:options:v1";

/** Clipboard write with a fallback for browsers that refuse the async API. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

export default function Workspace() {
  const [input, setInput] = useState(DEFAULT_TEXT);
  const [options, setOptions] = useState<ConfigOptions>(DEFAULT_OPTIONS);
  const [copied, setCopied] = useState(false);
  const [exampleIdx, setExampleIdx] = useState(0);
  const copiedTimer = useRef<number | undefined>(undefined);
  const toast = useToast();

  // Preferences are restored after mount so the server and client render the
  // same first paint.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setOptions({ ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<ConfigOptions>) });
    } catch {
      /* private mode, corrupt JSON: defaults are fine */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    } catch {
      /* nothing to do: the app works without persistence */
    }
  }, [options]);

  // The whole engine is synchronous and fast enough to run on every keystroke,
  // so there is no debounce to make the preview lag behind the caret.
  const { output, issues, blocks } = useMemo(() => cleanMathDetailed(input, options), [input, options]);

  const copy = useCallback(async () => {
    if (!output) {
      toast("Nothing to copy yet", "info");
      return;
    }
    const ok = await writeClipboard(output);
    if (!ok) {
      toast("Copy failed - select the code and press Cmd/Ctrl+C", "error");
      return;
    }
    setCopied(true);
    toast("Clean LaTeX copied");
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  }, [output, toast]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void copy();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copy]);

  const nextExample = EXAMPLES[(exampleIdx + 1) % EXAMPLES.length];
  const loadExample = useCallback(() => {
    const idx = (exampleIdx + 1) % EXAMPLES.length;
    setExampleIdx(idx);
    setInput(EXAMPLES[idx].text);
    toast(EXAMPLES[idx].label, "info");
  }, [exampleIdx, toast]);

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-2.5 p-3 sm:p-4 lg:min-h-0">
      <ControlBar options={options} onChange={setOptions} blocks={blocks} issues={issues} />

      <div className="grid flex-1 gap-2.5 lg:min-h-0 lg:grid-cols-2">
        <MathInput
          value={input}
          onChange={setInput}
          issues={issues}
          onLoadExample={loadExample}
          nextExampleLabel={nextExample.label}
        />

        <div className="flex min-h-0 flex-col gap-2.5">
          <MathOutput output={output} />
          <div className="shrink-0">
            <CopyButton onCopy={copy} copied={copied} disabled={!output} charCount={output.length} />
          </div>
        </div>
      </div>
    </main>
  );
}
