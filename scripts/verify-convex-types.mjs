#!/usr/bin/env node
// verify-convex-types.mjs
//
// The bullet-proof Convex drift gate.
//
// Re-runs the website's type exporter fresh, hashes both the freshly
// exported types and the chatbot repo's committed copy, and exits 1 if
// they differ (with a unified diff). Exits 0 if they match.
//
// This catches the failure mode where someone edits
// convex/audit_chatbot_leads.ts in the website repo but forgets to
// re-run `npm run sync:convex-types` in the chatbot repo. Without this
// gate, the chatbot's tsc happily compiles against stale types until
// runtime, when the schema drift silently drops fields.
//
// Run via:  npm run verify-convex-types
//
// Wire into a pre-commit hook (.husky/pre-commit) to make drift
// impossible to land:
//   cd ~/Documents/audit-chatbot && npm run verify-convex-types
//
// Assumes the website repo lives at `../emvy-website-v2/`. Override
// with WEBSITE_REPO env var.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const WEBSITE_REPO =
  process.env.WEBSITE_REPO || resolve(REPO_ROOT, "../emvy-website-v2");
const SRC = resolve(WEBSITE_REPO, "dist/audit-chatbot-types.d.ts");
const COMMITTED = resolve(
  REPO_ROOT,
  "src/lib/convex-generated/audit-chatbot-types.d.ts",
);

function sha(text) {
  return createHash("sha256").update(text).digest("hex");
}

function unifiedDiff(a, b) {
  // Tiny built-in diff: print each differing chunk. Not pretty for huge
  // files but the generated types file is small (~70 lines).
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const out = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    const x = aLines[i];
    const y = bLines[i];
    if (x === y) continue;
    if (x !== undefined) out.push(`-L${i + 1}: ${x}`);
    if (y !== undefined) out.push(`+L${i + 1}: ${y}`);
  }
  return out.join("\n");
}

function main() {
  // 1. Re-export fresh from the website repo.
  console.log("[verify-convex-types] exporting fresh types from website repo...");
  const exportRes = spawnSync(
    "npm",
    ["run", "--silent", "export:chatbot-types"],
    { cwd: WEBSITE_REPO, stdio: "inherit" },
  );
  if (exportRes.status !== 0) {
    console.error(
      "[verify-convex-types] export failed — fix the website repo first",
    );
    process.exit(1);
  }

  // 2. Check both files exist.
  if (!existsSync(SRC)) {
    console.error(`[verify-convex-types] missing fresh export: ${SRC}`);
    process.exit(1);
  }
  if (!existsSync(COMMITTED)) {
    console.error(
      `[verify-convex-types] missing committed copy: ${COMMITTED}\n` +
        `Run \`npm run sync:convex-types\` first.`,
    );
    process.exit(1);
  }

  // 3. Hash + diff.
  const fresh = readFileSync(SRC, "utf8");
  const committed = readFileSync(COMMITTED, "utf8");
  const freshHash = sha(fresh);
  const committedHash = sha(committed);

  if (freshHash === committedHash) {
    console.log(
      `[verify-convex-types] OK: types in sync (sha256=${freshHash.slice(0, 12)}…)`,
    );
    return;
  }

  // 4. Drift detected. Print diff + remediation steps.
  console.error(
    "\n[verify-convex-types] FAIL: committed types are stale.\n" +
      "  Fresh hash:    " +
      freshHash +
      "\n" +
      "  Committed hash:" +
      committedHash +
      "\n",
  );
  console.error("=== diff (fresh → committed) ===");
  console.error(unifiedDiff(committed, fresh));
  console.error(
    "\n=== fix ===\n" +
      "  Run `npm run sync:convex-types` to copy the fresh types\n" +
      "  into the chatbot repo, then commit. The drift means the\n" +
      "  chatbot's compiled call sites are out of date with the\n" +
      "  server-side validators.\n",
  );
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error("[verify-convex-types] FAILED:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
