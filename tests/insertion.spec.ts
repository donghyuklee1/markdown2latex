import { check, finish } from "./harness";
import { isInMath, planInsertion } from "../src/lib/insertion";

const apply = (value: string, caret: number, template: string, kind: "inline" | "display", selEnd = caret) => {
  const p = planInsertion(value, caret, selEnd, template, kind);
  const out = value.slice(0, caret) + p.text + value.slice(selEnd);
  return out.slice(0, p.caret) + "|" + out.slice(p.caret);
};

check("inside $...$ is maths, around it is not", [isInMath("a $x$ b", 3), isInMath("a $x$ b", 2), isInMath("a $x$ b", 5)].join(","), "true,false,false");
check("inside an environment is maths", String(isInMath("\\begin{align}\nx\n\\end{align}", 15)), "true");

check("symbol in prose becomes inline maths", apply("rate is ", 8, "\\alpha ", "inline"), "rate is $\\alpha|$");
check("symbol inside maths goes in bare", apply("$x + $", 5, "\\alpha ", "inline"), "$x + \\alpha |$");
check("a selection is wrapped, in prose too", apply("so x is", 3, "\\hat{@}", "inline", 4), "so $\\hat{x|}$ is");
check("snippet mid-line in prose becomes its own display block", apply("Result: done", 8, "a = b", "display"), "Result: \n$$\na = b\n$$|\ndone");
check("snippet on an empty line needs no extra breaks", apply("A\n\nB", 2, "a = b", "display"), "A\n$$\na = b\n$$|\nB");
check("snippet inside a display block goes in bare", apply("$$\n\n$$", 3, "a = b", "display"), "$$\na = b|\n$$");
check("a snippet with its own environment is not wrapped again", apply("x", 1, "\\begin{align*}\na &= b\n\\end{align*}", "display"), "x\n\\begin{align*}\na &= b\n\\end{align*}|");
check("a snippet that already has dollars is not wrapped again", apply("", 0, "$a$", "inline"), "$a$|");
check("an inline span never glues to a neighbouring word", apply("Theclassifier", 3, "\\theta ", "inline"), "The $\\theta|$ classifier");
finish("insertion");
