// Shared plumbing for the local stack generator: paths, clocks, the read-only SQL reader,
// secret redaction for audit logs, and name normalization used to deduplicate proposals.
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const LOG_ROOT = process.env.STACKS_LOG_DIR || join(homedir(), 'nuke-logs', 'stacks');
export const Q_SH = join(REPO_ROOT, 'scripts', 'data', 'q.sh');

/** 20261007T003000Z: sortable, filesystem-safe UTC stamp. */
export function utcStamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

// ---------------------------------------------------------------------------------------------
// Read-only database access. Same pattern as scripts/assays/data-model-coverage.mjs: the query
// runs inside BEGIN READ ONLY ... ROLLBACK, so the database itself refuses any write. The
// SELECT-only check below is a second, earlier guard against a future edit.
// ---------------------------------------------------------------------------------------------
const WRITE_WORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|merge|reindex|refresh|comment|lock|listen|notify|set|reset|do)\b/i;

export function assertSelectOnly(sql) {
  const bare = sql.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''").trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(bare)) throw new Error('read-only guard: statement must start with select or with');
  if (bare.includes(';')) throw new Error('read-only guard: one statement only');
  if (WRITE_WORDS.test(bare)) throw new Error('read-only guard: write keyword in statement');
}

export function readonlySql(sql, timeoutS = 45) {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='${timeoutS}s'; SET LOCAL lock_timeout='1s';\n${sql.trim().replace(/;+$/, '')};\nROLLBACK;`;
}

/** Run one SELECT through scripts/data/q.sh (Supabase Management API, 60 s cap) and return its rows. */
export function pg(sql, { timeoutS = 45, run = execFile } = {}) {
  assertSelectOnly(sql);
  return new Promise((resolveRows, reject) => {
    run('bash', [Q_SH, readonlySql(sql, timeoutS)],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 70000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        // Never echo stderr: it can carry environment noise.
        if (error) return reject(new Error(`q.sh failed (${error.killed ? 'timeout' : error.code ?? 'error'})`));
        let rows;
        try { rows = JSON.parse(stdout); } catch { return reject(new Error('q.sh returned non-JSON')); }
        if (!Array.isArray(rows)) return reject(new Error(`database error: ${String(rows?.message ?? 'unknown').slice(0, 300)}`));
        resolveRows(rows);
      });
  });
}

// ---------------------------------------------------------------------------------------------
// Redaction. The audit log keeps the model's raw output; nothing that looks like a credential or a
// person's address may land in it, even if a model echoes something from its own memory.
// ---------------------------------------------------------------------------------------------
const REDACTIONS = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer [redacted]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]'],
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|sbp_[A-Za-z0-9]{16,}|ody_[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{20,})/g, '[redacted-key]'],
  [/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*[=:]\s*\S+/g, '$1=[redacted]'],
  [/\b[A-Fa-f0-9]{40,}\b/g, '[redacted-hex]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]'],
];

export function redact(text) {
  let out = String(text ?? '').replace(/\x1b\[[0-9;]*m/g, ''); // colour codes from wrapper tools
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Words. One tokenizer for both duplicate detection and need resolution so they cannot disagree.
// ---------------------------------------------------------------------------------------------
const STOPWORDS = new Set(['the', 'and', 'for', 'its', 'are', 'with', 'from', 'that', 'this', 'into', 'over', 'under', 'via',
  'per', 'each', 'every', 'was', 'were', 'has', 'have', 'not', 'any', 'all', 'one', 'new', 'than', 'then', 'how', 'who', 'what']);
// Words that appear in table purposes as boilerplate and would make every dimension look half-present.
const BOILERPLATE = new Set(['grain', 'specification', 'data', 'table', 'writer', 'track', 'created', 'drop', 'zero', 'key',
  'canonical', 'system', 'value', 'candidate', 'row', 'uuid', 'date', 'time', 'timestamp', 'count', 'total', 'flag', 'text',
  'json', 'jsonb', 'boolean', 'version', 'column', 'field', 'record', 'type', 'status', 'code', 'name', 'info', 'metadata']);

export function singular(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Lowercased, singularized words of 3+ letters, without stopwords (and boilerplate when asked). */
export function tokens(text, { boilerplate = false } = {}) {
  const out = new Set();
  for (const raw of String(text ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOPWORDS.has(raw)) continue;
    const word = singular(raw);
    if (boilerplate && BOILERPLATE.has(word)) continue;
    out.add(word);
  }
  return out;
}

/** Normalized key of a stack name: sorted content tokens. "Liquidity surface" and "the surface of liquidity" collide. */
export function nameKey(name) {
  const withoutAside = String(name ?? '').replace(/\([^)]*\)/g, ' ');
  return [...tokens(withoutAside)].sort().join(' ');
}

/** Why `name` repeats one of `known` ({name, ...}), or null. Same words, nearly the same words, one name containing the other, or two shared content words that make up most of the shorter name. */
export function duplicateOf(name, known) {
  const mine = tokens(String(name ?? '').replace(/\([^)]*\)/g, ' '));
  const key = [...mine].sort().join(' ');
  for (const other of known) {
    const theirs = tokens(String(other.name ?? '').replace(/\([^)]*\)/g, ' '));
    if (!theirs.size || !mine.size) continue;
    if (key === [...theirs].sort().join(' ')) return other;
    const shared = [...mine].filter(t => theirs.has(t)).length;
    const union = mine.size + theirs.size - shared;
    const small = Math.min(mine.size, theirs.size);
    const large = Math.max(mine.size, theirs.size);
    if (shared / union >= 0.75) return other;
    if (small >= 2 && shared === small && large - small <= 1) return other;
    if (shared >= 2 && shared / small >= 2 / 3) return other; // two content words that make up two thirds of the shorter name
  }
  return null;
}
