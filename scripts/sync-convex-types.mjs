#!/usr/bin/env node
// sync-convex-types.mjs
//
// Copies the freshly-exported Convex types from the website repo into
// the audit chatbot repo. The exported file lives at
// `<website-repo>/dist/audit-chatbot-types.d.ts` after running
// `npm run export:chatbot-types` in the website repo. We copy it to
// `src/lib/convex-generated/audit-chatbot-types.d.ts` and print a
// summary of the diff (line count + added/removed field names) so the
// operator can see at a glance what changed.
//
// Run via:  npm run sync:convex-types
//
// Sibling: scripts/verify-convex-types.mjs (the bullet-proof drift
// gate — diffs freshly-exported vs committed copy and exits 1 on
// mismatch). Run `verify-convex-types` before commit.
//
// Assumes the website repo lives at `../emvy-website-v2/` (the
// documented sibling path). Override with WEBSITE_REPO env var.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const WEBSITE_REPO =
  process.env.WEBSITE_REPO || resolve(REPO_ROOT, "../emvy-website-v2");
const SRC = resolve(WEBSITE_REPO, "dist/audit-chatbot-types.d.ts");
const DEST = resolve(
  REPO_ROOT,
  "src/lib/convex-generated/audit-chatbot-types.d.ts",
);

function extractFieldNames(text) {
  // Pull "name: string" / "name?:" out of the type literal. Good enough
  // for the summary; doesn't have to be a full TS parser.
  const matches = text.match(/(\w+)(?:\?)?\s*:/g) || [];
  return matches
    .map((m) => m.replace(/\?/g, "").replace(":", "").trim())
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .sort();
}

function summaryForFn(text, fnName) {
  // The type body lives between `=` and `;`. Extract and report field set.
  const aliasRe = new RegExp(
    `AuditChatbotLeads${fnName}Args\\s*=\\s*([\\s\\S]*?);`,
  );
  const m = text.match(aliasRe);
  if (!m) return null;
  return extractFieldNames(m[1]);
}

function main() {
  if (!existsSync(SRC)) {
    console.error(
      `[sync-convex-types] ${SRC} not found.\n` +
        `Run \`npm run export:chatbot-types\` in ${WEBSITE_REPO} first.`,
    );
    process.exit(1);
  }

  const newContent = readFileSync(SRC, "utf8");
  const oldContent = existsSync(DEST) ? readFileSync(DEST, "utf8") : "";

  if (newContent === oldContent) {
    console.log("[sync-convex-types] no changes — types already in sync");
    return;
  }

  mkdirSync(dirname(DEST), { recursive: true });
  writeFileSync(DEST, newContent);

  const oldLines = oldContent.split("\n").length;
  const newLines = newContent.split("\n").length;
  console.log(
    `[sync-convex-types] wrote ${DEST}\n` +
      `[sync-convex-types] ${oldLines} → ${newLines} lines`,
  );

  // Diff the field sets per function. Reports which fields were
  // added/removed on each mutation/query.
  const fnNames = ["Create", "Update", "Get", "List", "GetStats", "MarkReviewed"];
  for (const fn of fnNames) {
    const oldFields = oldContent ? summaryForFn(oldContent, fn) : [];
    const newFields = summaryForFn(newContent, fn);
    if (!newFields) continue;
    const oldSet = new Set(oldFields || []);
    const newSet = new Set(newFields);
    const added = [...newSet].filter((k) => !oldSet.has(k));
    const removed = [...oldSet].filter((k) => !newSet.has(k));
    if (added.length || removed.length) {
      console.log(
        `[sync-convex-types] ${fn}: ` +
          `+[${added.join(", ")}] -[${removed.join(", ")}]`,
      );
    }
  }

  console.log("\nNext: run `npm run verify-convex-types` to confirm sync.");
}

try {
  main();
} catch (err) {
  console.error("[sync-convex-types] FAILED:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
