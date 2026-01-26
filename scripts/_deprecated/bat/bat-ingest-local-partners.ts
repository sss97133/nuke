#!/usr/bin/env node
/**
 * BaT Local Partners end-to-end ingestion (idempotent, resumable)
 *
 * This is the "one command" runner that keeps the data flow consistent:
 * 1) Index local partners -> upsert org rows in `public.businesses`
 * 2) Enrich org profiles (brand assets / contact) via `scrape-multi-source`
 * 3) Import all BaT listings for each partner and link them to the correct org
 *
 * It shells out to the existing scripts so we keep one source of truth.
 *
 * Usage:
 *   npm run ingest:bat-local-partners -- --index --enrich --import
 *   npm run ingest:bat-local-partners -- --dry-run --limit-partners 5
 *
 * Helpful flags:
 * - --dry-run
 * - --skip-index | --skip-enrich | --skip-import
 * - --index-via-edge  (use Edge upsert; requires only anon key for invocation)
 *
 * Pass-through flags (selected):
 * - --limit <n>                 (indexer)
 * - --concurrency <n>           (enrich + import)
 * - --resume-from <n>           (enrich)
 * - --limit-partners <n>        (import)
 * - --resume-from-partner <n>   (import)
 * - --partner-key "<key>"       (import)
 * - --listing-limit <n>         (import)
 * - --max-pages <n>             (import)
 * - --image-batch-size <n>      (import)
 * - --no-json                   (index + import summaries)
 */

import { spawn } from 'child_process';

type Options = {
  dryRun: boolean;
  skipIndex: boolean;
  skipEnrich: boolean;
  skipImport: boolean;
  indexViaEdge: boolean;
  passthrough: string[];
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    dryRun: false,
    skipIndex: false,
    skipEnrich: false,
    skipImport: false,
    indexViaEdge: false,
    passthrough: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (a === '--skip-index') {
      opts.skipIndex = true;
      continue;
    }
    if (a === '--skip-enrich') {
      opts.skipEnrich = true;
      continue;
    }
    if (a === '--skip-import') {
      opts.skipImport = true;
      continue;
    }
    if (a === '--index-via-edge') {
      opts.indexViaEdge = true;
      continue;
    }

    // Anything else: pass-through (including flags + their values)
    opts.passthrough.push(a);
  }

  return opts;
}

async function run(cmd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: process.env });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function hasServiceRoleKey(): boolean {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const indexerArgs: string[] = [];
  const enrichArgs: string[] = [];
  const importArgs: string[] = [];

  // Passthrough is intentionally simple: we forward the same flags to both enrich/import where applicable.
  // (Index flags like --limit/--no-json will be harmless on the others even if ignored.)
  indexerArgs.push(...opts.passthrough);
  enrichArgs.push(...opts.passthrough);
  importArgs.push(...opts.passthrough);

  if (opts.dryRun) {
    // Indexer defaults to dry-run unless explicitly asked to upsert.
    enrichArgs.push('--dry-run');
    importArgs.push('--dry-run');
  }

  console.log('BaT Local Partners: ingest runner');
  console.log(`Mode: ${opts.dryRun ? 'dry-run' : 'execute'}`);
  console.log(`Steps: index=${!opts.skipIndex} enrich=${!opts.skipEnrich} import=${!opts.skipImport}`);

  if (!opts.skipIndex) {
    const useEdge = opts.indexViaEdge || !hasServiceRoleKey();
    const upsertFlag = useEdge ? '--upsert-via-edge' : '--upsert';
    const args = ['run', 'index:bat-local-partners', '--', ...indexerArgs];
    if (!opts.dryRun) args.push(upsertFlag);
    console.log(`\n[1/3] Index local partners (${useEdge ? 'edge upsert' : 'direct upsert'})`);
    await run('npm', args);
  }

  if (!opts.skipEnrich) {
    console.log(`\n[2/3] Enrich org profiles`);
    await run('npm', ['run', 'enrich:bat-local-partners', '--', ...enrichArgs]);
  }

  if (!opts.skipImport) {
    console.log(`\n[3/3] Import partner vehicles`);
    await run('npm', ['run', 'import:bat-local-partner-vehicles', '--', ...importArgs]);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});


