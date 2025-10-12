#!/usr/bin/env node
/*
  Environment Doctor
  - Checks for common misconfigurations that derail testing.
  - Non-destructive, read-only.
*/

const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();

function loadEnvFile(p) {
  try {
    const content = fs.readFileSync(p, 'utf8');
    const lines = content.split(/\r?\n/);
    const env = {};
    for (const line of lines) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      env[k] = v;
    }
    return env;
  } catch {
    return {};
  }
}

function report(title, value) {
  const pad = title.padEnd(28, ' ');
  console.log(`${pad} ${value}`);
}

function main() {
  console.log('=== Environment Doctor ===');

  // Load frontend env files (priority order)
  const feDir = path.join(projectRoot, 'nuke_frontend');
  const envLocal = loadEnvFile(path.join(feDir, '.env.local'));
  const envFile = loadEnvFile(path.join(feDir, '.env'));
  const envExample = loadEnvFile(path.join(feDir, '.env.example'));

  const env = { ...envExample, ...envFile, ...envLocal };

  const VITE_SUPABASE_URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const VITE_SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const VITE_ENABLE_DEBUG = env.VITE_ENABLE_DEBUG || process.env.VITE_ENABLE_DEBUG;

  console.log('\nFrontend (.env/.env.local) checks');
  report('VITE_SUPABASE_URL', VITE_SUPABASE_URL || '(missing)');
  report('VITE_SUPABASE_ANON_KEY', VITE_SUPABASE_ANON_KEY ? '(present)' : '(missing)');
  report('VITE_ENABLE_DEBUG', VITE_ENABLE_DEBUG || 'false');

  const problems = [];

  // Enforce remote-only policy (no localhost) unless explicitly allowed
  if (!VITE_SUPABASE_URL) {
    problems.push('VITE_SUPABASE_URL is missing. The app cannot authenticate.');
  } else {
    const isLocal = /localhost|127\.0\.0\.1|^http:\/\//i.test(VITE_SUPABASE_URL);
    if (isLocal) {
      problems.push('VITE_SUPABASE_URL is pointing to a local instance. Policy is remote-only for parity testing.');
    }
    const looksLikeSupabase = /https:\/\/.*\.supabase\.co$/i.test(VITE_SUPABASE_URL);
    if (!looksLikeSupabase) {
      problems.push('VITE_SUPABASE_URL does not look like a Supabase project URL (https://<id>.supabase.co).');
    }
  }

  if (!VITE_SUPABASE_ANON_KEY) {
    problems.push('VITE_SUPABASE_ANON_KEY is missing. The client cannot connect.');
  }

  console.log('\nOperational SQL configuration');
  const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
  report('SUPABASE_DB_URL', SUPABASE_DB_URL ? '(present)' : '(missing)');
  if (!SUPABASE_DB_URL) {
    problems.push('SUPABASE_DB_URL is not set (needed for npm run db:run / db:seed).');
  }

  console.log('\nRepo layout sanity');
  const helpersDir = path.join(projectRoot, 'supabase', 'sql', 'helpers');
  const seedsDir = path.join(projectRoot, 'supabase', 'sql', 'seeds');
  report('helpers dir', fs.existsSync(helpersDir) ? helpersDir : '(missing)');
  report('seeds dir', fs.existsSync(seedsDir) ? seedsDir : '(missing)');

  console.log('\nSummary');
  if (problems.length === 0) {
    console.log('✅ No critical environment issues detected.');
  } else {
    for (const p of problems) console.log('❌ ' + p);
    console.log('\nRecommended actions:');
    if (problems.some(p => p.includes('VITE_SUPABASE_URL'))) {
      console.log('- Set VITE_SUPABASE_URL to your remote Supabase URL in nuke_frontend/.env.local');
    }
    if (problems.some(p => p.includes('VITE_SUPABASE_ANON_KEY'))) {
      console.log('- Set VITE_SUPABASE_ANON_KEY to the remote project anon key in nuke_frontend/.env.local');
    }
    if (problems.some(p => p.includes('SUPABASE_DB_URL'))) {
      console.log('- Export SUPABASE_DB_URL in your shell for SQL helpers, e.g. postgres://user:pass@host:5432/db');
    }
  }

  console.log('\nTip: Set VITE_ENABLE_DEBUG=false for normal testing (hides debug routes, reduces noise).');
}

main();
