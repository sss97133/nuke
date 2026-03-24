#!/usr/bin/env node
/**
 * K5 Blazer Vision — Export Sessions for Claude Direct Analysis
 *
 * Exports grouped photo sessions from osxphotos to /tmp/k5-sessions/
 * for direct analysis by Claude Code's built-in vision (Read tool).
 *
 * This is the FAST PATH — no API keys, no credits, no rate limits.
 * Claude reads the images directly and writes structured analysis to DB.
 *
 * Usage:
 *   dotenvx run -- node scripts/vision-k5-claude-direct.mjs --top 10    # export top 10 sessions
 *   dotenvx run -- node scripts/vision-k5-claude-direct.mjs --date 2024-08-25  # specific date
 *   dotenvx run -- node scripts/vision-k5-claude-direct.mjs --all       # all 127 sessions
 */

import { execSync } from "child_process";
import { mkdirSync, existsSync, readdirSync } from "fs";

const ALBUM = "1977 K5 Chevrolet Blazer";
const OUTPUT_DIR = "/tmp/k5-sessions";
const args = process.argv.slice(2);
const TOP_N = args.includes("--top") ? parseInt(args[args.indexOf("--top") + 1]) : 5;
const SPECIFIC_DATE = args.includes("--date") ? args[args.indexOf("--date") + 1] : null;
const ALL = args.includes("--all");
const PHOTOS_PER_SESSION = 8; // Sweet spot for grouped analysis

async function main() {
  console.log("=".repeat(70));
  console.log("K5 Blazer Vision — Session Export for Claude Direct Analysis");
  console.log("=".repeat(70));

  // Get all photos with dates
  const raw = execSync(`osxphotos query --album "${ALBUM}" --json 2>/dev/null`, {
    maxBuffer: 100 * 1024 * 1024,
    timeout: 60000,
  }).toString();
  const photos = JSON.parse(raw);
  console.log(`Total photos in album: ${photos.length}`);

  // Group by date
  const byDate = {};
  for (const p of photos) {
    const d = (p.date || "").slice(0, 10);
    if (!d) continue;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(p);
  }

  // Sort sessions by size
  let sessions = Object.entries(byDate)
    .map(([date, group]) => ({ date, count: group.length, photos: group }))
    .sort((a, b) => b.count - a.count);

  if (SPECIFIC_DATE) {
    sessions = sessions.filter(s => s.date === SPECIFIC_DATE);
  } else if (!ALL) {
    sessions = sessions.slice(0, TOP_N);
  }

  console.log(`Sessions to export: ${sessions.length}\n`);

  let totalExported = 0;
  for (const session of sessions) {
    const dir = `${OUTPUT_DIR}/${session.date}`;

    // Skip if already exported
    if (existsSync(dir) && readdirSync(dir).filter(f => f.endsWith(".jpeg")).length >= Math.min(PHOTOS_PER_SESSION, session.count)) {
      console.log(`  ${session.date} (${session.count} photos) — already exported, skipping`);
      continue;
    }

    mkdirSync(dir, { recursive: true });

    // Get evenly spaced sample of UUIDs (not just first N)
    const sorted = session.photos.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const step = Math.max(1, Math.floor(sorted.length / PHOTOS_PER_SESSION));
    const sample = [];
    for (let i = 0; i < sorted.length && sample.length < PHOTOS_PER_SESSION; i += step) {
      sample.push(sorted[i]);
    }

    const uuidArgs = sample.map(p => `--uuid ${p.uuid}`).join(" ");
    try {
      execSync(
        `osxphotos export "${dir}" ${uuidArgs} --convert-to-jpeg --jpeg-quality 0.5 --force-update <<< "y" 2>/dev/null`,
        { timeout: 60000, shell: "/bin/zsh" }
      );
      const exported = readdirSync(dir).filter(f => f.endsWith(".jpeg")).length;
      console.log(`  ${session.date} (${session.count} photos) → exported ${exported} samples to ${dir}`);
      totalExported += exported;
    } catch (e) {
      console.log(`  ${session.date} — export failed: ${e.message.slice(0, 80)}`);
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Exported ${totalExported} photos across ${sessions.length} sessions to ${OUTPUT_DIR}/`);
  console.log(`\nNext: Claude reads these directly with the Read tool for vision analysis.`);
  console.log("=".repeat(70));
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
