import { check, finish } from "./harness";
import { OCR_MIME, ocrPrompt, ocrRequest, parseOcr } from "../src/lib/ocr";

const body = ocrRequest("markdown", "image/png", "AAAA", "gemini-3.8-flash") as { contents: Array<{ parts: Array<Record<string, unknown>> }>; generationConfig: Record<string, unknown> };
check("the image goes inline, before the instructions", JSON.stringify(body.contents[0].parts[0]), '{"inlineData":{"mimeType":"image/png","data":"AAAA"}}');
check("structured JSON output", String(body.generationConfig.responseMimeType) + " " + Object.keys((body.generationConfig.responseSchema as { properties: object }).properties).join(","), "application/json content,title,warnings");
check("deterministic and quick", String(body.generationConfig.temperature) + " " + JSON.stringify(body.generationConfig.thinkingConfig), '0 {"thinkingLevel":"minimal"}');
check("formats ask for different things", [/Markdown/.test(ocrPrompt("markdown")), /document body/.test(ocrPrompt("latex")), /ONLY the mathematical/.test(ocrPrompt("formulas"))].join(","), "true,true,true");
check("never solve or translate", /do not solve, simplify, summarise, translate/.test(ocrPrompt("latex")) ? "yes" : "no", "yes");
check("a user hint is passed on, briefly", ocrPrompt("markdown", "  Korean lecture notes  ").includes("The user adds: Korean lecture notes") ? "yes" : "no", "yes");
check("valid answer", JSON.stringify(parseOcr({ content: " $$E=mc^2$$ ", title: "Energy", warnings: ["blurry corner", 3] })), '{"content":"$$E=mc^2$$","title":"Energy","warnings":["blurry corner"]}');
check("a code fence around the content is removed", parseOcr({ content: "```markdown\n# Notes\n$a$\n```", title: "", warnings: [] })?.content ?? "", "# Notes\n$a$");
check("empty or junk answers are rejected", [parseOcr(null), parseOcr({ content: "  " }), parseOcr({ title: "x" })].map(String).join(","), "null,null,null");
check("accepted types", ["image/png", "image/jpeg", "application/pdf", "image/gif", "text/plain"].map((m) => (OCR_MIME.test(m) ? "y" : "n")).join(""), "yyynn");
finish("ocr");
