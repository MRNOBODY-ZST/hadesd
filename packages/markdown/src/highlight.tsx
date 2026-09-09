import { createElement, type ReactNode } from "react";
import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import java from "highlight.js/lib/languages/java";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";

const lowlight = createLowlight({ javascript, typescript, java, python, go, rust, bash, json, css, sql, yaml, xml, cpp, c, kotlin, markdown, diff, dockerfile });
lowlight.registerAlias({ javascript: ["js", "jsx"], typescript: ["ts", "tsx"], xml: ["html", "svg"], bash: ["sh", "shell", "zsh"] });
type HighlightNode = { type: string; value?: string; properties?: Record<string, unknown>; children?: HighlightNode[] };
const render = (node: HighlightNode, key: number): ReactNode => node.type === "text" ? node.value : createElement("span", {
  key, className: Array.isArray(node.properties?.className) ? node.properties.className.join(" ") : undefined,
}, node.children?.map(render));
export function highlight(source: string, language?: string): ReactNode {
  // No language guessing and no expensive highlighting of megabyte code blocks.
  if (!language || source.length > 50_000 || !lowlight.registered(language)) return source;
  try { return lowlight.highlight(language, source).children.map((node, index) => render(node as HighlightNode, index)); }
  catch { return source; }
}
