#!/usr/bin/env node
// Checks that no em dash (—) appears in text a person could actually read:
// string literals, template literals, and JSX text.
//
// Deliberately not a grep. This repo's own comments are full of em dashes
// by house style, so a text-based check would be almost entirely false
// positives — the point is catching it in what ships, not in prose about
// the code. Walking the TypeScript AST and only inspecting literal/JSX-text
// nodes does that correctly, because the walk never visits comment trivia.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";

const ROOTS = ["server/src", "frontend/src"];
const EM_DASH = "—";

function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...collectFiles(full));
    else if ([".ts", ".tsx"].includes(extname(name))) out.push(full);
  }
  return out;
}

function checkFile(path) {
  const text = readFileSync(path, "utf8");
  if (!text.includes(EM_DASH)) return [];

  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const hits = [];
  function visit(node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      if (node.text.includes(EM_DASH)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        hits.push({ line: line + 1, text: node.text.trim().slice(0, 80) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return hits;
}

let found = false;
for (const root of ROOTS) {
  for (const file of collectFiles(root)) {
    for (const hit of checkFile(file)) {
      found = true;
      console.error(`${file}:${hit.line}: em dash in "${hit.text}"`);
    }
  }
}

if (found) {
  console.error("\nEm dash found in user-facing text. Replace it with a comma, period, or parentheses.");
  process.exit(1);
}
console.log("No em dashes in user-facing text.");
