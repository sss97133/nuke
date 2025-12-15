import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PROJECT_ROOT = path.resolve(process.cwd());
const SRC_ROOT = path.join(PROJECT_ROOT, "src");

const DEFAULT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".vercel",
  "coverage",
]);

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    json: args.has("--json"),
    fail: args.has("--fail"),
    verbose: args.has("--verbose"),
    fix: args.has("--fix"),
  };
}

async function* walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      yield* walkFiles(full);
    } else if (ent.isFile()) {
      if (!DEFAULT_EXTS.has(path.extname(ent.name))) continue;
      yield full;
    }
  }
}

function lineNumberAt(text, idx) {
  // 1-based
  let line = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function collectMatches(filePath, text) {
  const rel = path.relative(PROJECT_ROOT, filePath);

  const rules = [
    {
      id: "white-bg-glass",
      severity: "error",
      why: "Hardcoded white glass backgrounds break dark mode",
      re: /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.(?:95|9|85|8|75|7)\s*\)/g,
    },
    {
      id: "white-bg-solid",
      severity: "error",
      why: "Hardcoded white background breaks dark mode",
      re: /(?:background|backgroundColor)\s*:\s*['"](?:#fff\b|#ffffff\b|white)['"]/g,
    },
    {
      id: "light-bg-solid",
      severity: "warn",
      why: "Hardcoded near-white background often reads as white in dark mode; prefer theme tokens",
      re: /(?:background|backgroundColor)\s*:\s*['"](?:#f5f5f5\b|#fafafa\b|#f3f4f6\b|#f9fafb\b|#eeeeee\b|#e5e5e5\b|#f0f0f0\b)['"]/gi,
    },
    {
      id: "white-border-solid",
      severity: "warn",
      why: "Hardcoded white border may create bright strokes in dark mode",
      re: /border(?:Color)?\s*:\s*['"](?:#fff\b|#ffffff\b|white)['"]/g,
    },
    {
      id: "tailwind-bg-white",
      severity: "warn",
      why: "Tailwind bg-white relies on remap; consider tokens",
      re: /\bbg-white\b/g,
    },
    {
      id: "tailwind-text-gray-900",
      severity: "warn",
      why: "Tailwind text-gray-* relies on remap; consider tokens",
      re: /\btext-gray-(?:900|800|700)\b/g,
    },
    {
      id: "tailwind-border-gray",
      severity: "warn",
      why: "Tailwind border-gray-* relies on remap; consider tokens",
      re: /\bborder-gray-(?:200|300|400)\b/g,
    },
  ];

  const results = [];
  for (const rule of rules) {
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const line = lineNumberAt(text, m.index);
      results.push({
        file: rel,
        line,
        rule: rule.id,
        severity: rule.severity,
        match: m[0],
        why: rule.why,
      });
    }
  }
  return results;
}

async function main() {
  const { json, fail, verbose, fix } = parseArgs(process.argv);
  // Allow piping to tools like `head` without crashing on EPIPE
  process.stdout.on("error", (err) => {
    if (err && err.code === "EPIPE") process.exit(0);
  });

  const fixableExts = new Set([".ts", ".tsx", ".js", ".jsx"]);
  const fixSummary = { filesChanged: 0, replacements: 0 };

  const matches = [];
  for await (const file of walkFiles(SRC_ROOT)) {
    let text = await fs.readFile(file, "utf8");

    if (fix && fixableExts.has(path.extname(file))) {
      const before = text;

      // Replace common hardcoded light-only backgrounds with theme tokens.
      // Keep this intentionally conservative: only obvious white/glass.
      const replacements = [
        // white glass -> var(--surface-glass)
        [
          /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.(?:95|9|85|8|75|7)\s*\)/g,
          "var(--surface-glass)",
        ],
        // backgroundColor: 'white' / '#fff' / '#ffffff' -> var(--surface)
        [
          /(backgroundColor)\s*:\s*(['"])(?:white|#fff\b|#ffffff\b)\2/g,
          "$1: $2var(--surface)$2",
        ],
        // background: 'white' / '#fff' / '#ffffff' -> var(--surface)
        [
          /(background)\s*:\s*(['"])(?:white|#fff\b|#ffffff\b)\2/g,
          "$1: $2var(--surface)$2",
        ],
        // Common near-white backgrounds -> tokens
        [
          /(backgroundColor)\s*:\s*(['"])(?:#fafafa\b|#f9fafb\b|#f5f5f5\b|#f3f4f6\b)\2/gi,
          "$1: $2var(--bg)$2",
        ],
        [
          /(background)\s*:\s*(['"])(?:#fafafa\b|#f9fafb\b|#f5f5f5\b|#f3f4f6\b)\2/gi,
          "$1: $2var(--bg)$2",
        ],
        [
          /(backgroundColor)\s*:\s*(['"])(?:#eeeeee\b|#e5e5e5\b|#f0f0f0\b)\2/gi,
          "$1: $2var(--surface)$2",
        ],
        [
          /(background)\s*:\s*(['"])(?:#eeeeee\b|#e5e5e5\b|#f0f0f0\b)\2/gi,
          "$1: $2var(--surface)$2",
        ],
      ];

      for (const [re, out] of replacements) {
        const prev = text;
        text = text.replace(re, out);
        if (text !== prev) {
          // best-effort count: count occurrences in prev
          const m = prev.match(re);
          if (m) fixSummary.replacements += m.length;
        }
      }

      if (text !== before) {
        await fs.writeFile(file, text, "utf8");
        fixSummary.filesChanged += 1;
      }
    }

    const m = collectMatches(file, text);
    if (m.length) matches.push(...m);
  }

  const counts = matches.reduce(
    (acc, m) => {
      acc.total++;
      acc.bySeverity[m.severity] = (acc.bySeverity[m.severity] ?? 0) + 1;
      acc.byRule[m.rule] = (acc.byRule[m.rule] ?? 0) + 1;
      return acc;
    },
    { total: 0, bySeverity: {}, byRule: {} }
  );

  const payload = { root: PROJECT_ROOT, counts, matches };

  if (json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    if (fix) {
      process.stdout.write(
        `theme-audit --fix: changed ${fixSummary.filesChanged} file(s), applied ~${fixSummary.replacements} replacement(s)\n\n`
      );
    }
    process.stdout.write(
      `theme-audit: ${counts.total} findings (errors: ${counts.bySeverity.error ?? 0}, warnings: ${counts.bySeverity.warn ?? 0})\n`
    );
    const topRules = Object.entries(counts.byRule)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [rule, n] of topRules) process.stdout.write(`- ${rule}: ${n}\n`);
    process.stdout.write("\n");

    const show = verbose ? matches : matches.slice(0, 80);
    for (const m of show) {
      process.stdout.write(
        `${m.severity.toUpperCase()} ${m.file}:${m.line} [${m.rule}] ${m.match}\n`
      );
    }
    if (!verbose && matches.length > show.length) {
      process.stdout.write(`... ${matches.length - show.length} more (use --verbose)\n`);
    }
  }

  const errorCount = counts.bySeverity.error ?? 0;
  if (fail && errorCount > 0) process.exitCode = 1;
}

await main();


