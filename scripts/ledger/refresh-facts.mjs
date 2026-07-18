#!/usr/bin/env node
/**
 * refresh-facts.mjs — keep the ledger's FACTS fresh so docs/ledger/ can't rot.
 *
 * The ledger has two layers:
 *   FACTS    (this script, cheap, run any time): what's deployed, what the frontend
 *            invokes, which calls are broken, ghost-ref count, fn dirs on disk.
 *   JUDGMENT (strong-model audit): canonical vs dead vs half-built verdicts.
 *
 * This refreshes the facts into docs/ledger/facts.json and prints a DRIFT report —
 * places where reality now contradicts ledger.json's judgment (e.g. a CANONICAL
 * function that is no longer deployed). Drift means the judgment layer needs a
 * re-audit; this script never edits verdicts itself.
 *
 * Usage:  node scripts/ledger/refresh-facts.mjs          # refresh + drift report
 *         npm run ledger:facts
 * Needs:  supabase CLI authed (for the live deploy list); degrades with a warning if not.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT_REF = "qkgaybvrernstplzjaam";
const OUT = path.join(REPO, "docs/ledger/facts.json");

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });

// 1. Edge-function dirs on disk
const fnDirs = readdirSync(path.join(REPO, "supabase/functions"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
  .map((d) => d.name)
  .sort();

// 2. Live deploy list (supabase CLI)
let deployed = null;
try {
  const raw = sh("supabase", ["functions", "list", "--project-ref", PROJECT_REF, "-o", "json"]);
  const start = raw.indexOf("[");
  deployed = JSON.parse(raw.slice(start)).map((f) => f.slug || f.name).sort();
} catch (e) {
  console.error(`WARN: could not fetch deploy list (supabase CLI): ${String(e.message).slice(0, 120)}`);
}

// 3. Functions the frontend invokes (static single-line literals only)
const invokeGrep = sh("git", ["grep", "-rhoE", String.raw`functions\.invoke\(\s*['"][a-z0-9-]+['"]`, "--", "nuke_frontend/src"]);
const invoked = [...new Set(invokeGrep.match(/['"][a-z0-9-]+['"]/g)?.map((s) => s.slice(1, -1)) ?? [])].sort();
// Honesty metric: invoke sites the static pattern can't resolve (variables, template
// literals, multi-line) — these make `invoked`/`broken_calls` an UNDERCOUNT.
let dynamicInvokes = 0;
try {
  const allInvokes = sh("git", ["grep", "-c", "functions.invoke(", "--", "nuke_frontend/src"])
    .trim().split("\n").reduce((n, l) => n + Number(l.split(":").pop() || 0), 0);
  const staticInvokes = invokeGrep.trim().split("\n").filter(Boolean).length;
  dynamicInvokes = Math.max(0, allInvokes - staticInvokes);
} catch { /* counting only */ }

// 4. Broken calls = invoked but not deployed
const brokenCalls = deployed ? invoked.filter((f) => !deployed.includes(f)) : null;

// 5. Ghost-ref errors (dead-table refs on live paths) via the existing guardrail
let ghostErrors = null;
try {
  const g = JSON.parse(sh("node", ["scripts/guardrails/no-dead-asset-references.mjs", "--json"]));
  ghostErrors = g.errors;
} catch (e) {
  // guardrail exits 1 when it finds violations — capture its stdout from the error
  try { ghostErrors = JSON.parse(e.stdout).errors; } catch { console.error("WARN: ghost guardrail unreadable"); }
}

// 6. Drift vs the judgment layer (ledger.json)
const drift = [];
const ledgerPath = path.join(REPO, "docs/ledger/ledger.json");
if (existsSync(ledgerPath) && deployed) {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  for (const a of ledger.assets ?? []) {
    // skip grouped ledger entries ("a/b/c", "a, b") — they aren't single fn names
    if (a.kind !== "edge_function" || a.name.includes(" ") || a.name.includes("/")) continue;
    if (a.verdict === "CANONICAL" && !deployed.includes(a.name) && !fnDirs.includes(a.name))
      drift.push(`CANONICAL fn "${a.name}" is neither deployed nor on disk — verdict stale`);
    if (a.verdict === "DEAD" && deployed.includes(a.name) && invoked.includes(a.name))
      drift.push(`DEAD fn "${a.name}" is deployed AND invoked by the frontend — verdict stale`);
  }
}

const facts = {
  generated_by: "scripts/ledger/refresh-facts.mjs",
  project_ref: PROJECT_REF,
  counts: {
    fn_dirs_on_disk: fnDirs.length,
    deployed: deployed?.length ?? "unknown",
    invoked_by_frontend: invoked.length,
    dynamic_invoke_sites_unresolved: dynamicInvokes,
    broken_frontend_calls: brokenCalls?.length ?? "unknown",
    ghost_ref_errors: ghostErrors ?? "unknown",
  },
  deployed,
  fn_dirs: fnDirs,
  invoked,
  broken_calls: brokenCalls,
  drift,
};
writeFileSync(OUT, JSON.stringify(facts, null, 2) + "\n");

console.log(`facts.json written: ${OUT}`);
console.log(JSON.stringify(facts.counts, null, 2));
if (drift.length) {
  console.log(`\nDRIFT (${drift.length}) — judgment layer contradicted, re-audit these:`);
  drift.forEach((d) => console.log("  - " + d));
} else {
  console.log("\nNo drift detected between facts and ledger verdicts (edge functions).");
}
