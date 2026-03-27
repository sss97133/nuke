/**
 * Shared environment loader for work order scripts.
 *
 * Resolution order:
 * 1. process.env (already set by `dotenvx run --`)
 * 2. Discovery via import.meta.url (walk up to find .env)
 *
 * Usage:
 *   import { getSupabaseConfig, createSupabase } from './lib/env.mjs';
 *   const { url, key } = getSupabaseConfig();
 *   // or
 *   const supabase = createSupabase();
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

/** Walk up from this file to find the project root (has .env or package.json) */
function findProjectRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  // Walk up at most 5 levels
  for (let i = 0; i < 5; i++) {
    dir = resolve(dir, '..');
    if (existsSync(join(dir, '.env')) || existsSync(join(dir, 'package.json'))) {
      return dir;
    }
  }
  return null;
}

/** Load env vars via dotenvx if not already present */
function ensureEnv() {
  if (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return; // Already loaded (e.g. via `dotenvx run --`)
  }

  const root = findProjectRoot();
  if (!root) {
    throw new Error(
      'Cannot find project root (.env). Run via: cd /path/to/nuke && dotenvx run -- node <script>'
    );
  }

  try {
    const envOutput = execSync(`cd "${root}" && dotenvx run -- env`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    for (const line of envOutput.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const key = line.substring(0, eq);
        const value = line.substring(eq + 1);
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch (e) {
    throw new Error(`Failed to load environment via dotenvx: ${e.message}`);
  }
}

/** Get Supabase URL and service role key */
export function getSupabaseConfig() {
  ensureEnv();
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Run via: dotenvx run -- node <script>'
    );
  }

  return { url, key };
}

/** Create a Supabase client with service role */
export function createSupabase() {
  const { url, key } = getSupabaseConfig();
  return createClient(url, key);
}

/** iMessage chat.db path (macOS only) */
export const CHAT_DB_PATH = join(process.env.HOME, 'Library/Messages/chat.db');

/** Apple epoch offset (2001-01-01 in unix seconds) */
export const APPLE_EPOCH_OFFSET = 978307200;
