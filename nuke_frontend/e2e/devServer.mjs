// Starts the Vite dev server against the mock Supabase host and waits until it answers.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_HOST } from './mockSupabase.mjs';

const FE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startDevServer(port = Number(process.env.E2E_PORT ?? 4317)) {
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(FE, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: FE,
    env: { ...process.env, VITE_SUPABASE_URL: MOCK_HOST, VITE_SUPABASE_ANON_KEY: 'e2e-anon-key', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite exited early:\n${log}`);
    try { if ((await fetch(base)).ok) return { base, stop: () => child.kill('SIGTERM'), log: () => log }; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  child.kill('SIGTERM');
  throw new Error(`vite did not start in 120 s:\n${log}`);
}
