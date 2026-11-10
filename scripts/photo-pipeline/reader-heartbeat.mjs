#!/usr/bin/env node
// reader-heartbeat.mjs — post one subscription reader's heartbeat to record_reader_heartbeat.
//
// subscription-reader-batch.sh used to build this request by splicing the reader's summary into the text of a
// `bash -c` script. The summary's quotes ended the shell string, so the body was never JSON (no heartbeat landed after
// the hand run of 2026-11-08), and its contents were evaluated by the shell: by_type keys are model output read from
// photographed documents, and that process holds the service-role key. Here the summary arrives in the environment
// and is only ever parsed as JSON; nothing in it reaches a shell.
//
// A heartbeat means "the reader ran and reported": when the reader exited non-zero or printed no JSON summary, nothing
// is posted, so the 40-minute watch (assay_subscription_readers) sees a silent reader instead of a fresh row.
//
//   READER_NAME=subscription-frame-classifier READER_SUMMARY='{"frames":20,...}' READER_EXIT=0 READER_ELAPSED_MS=41000 \
//     dotenvx run -- node scripts/photo-pipeline/reader-heartbeat.mjs
//
// Exit 0 when the heartbeat landed (HTTP 200), 1 when it did not, 2 on a bad call, 3 when the reader gave nothing to
// post. Prints one line built from fixed words, the reader name and a status code: never a secret, never reader text.
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const READERS = ['subscription-document-reader', 'subscription-frame-classifier'];
// record_reader_heartbeat refuses a reading over 20 kB of jsonb text, which is longer than compact JSON (a space after
// every ':' and ','); 12 kB compact stays under it.
export const MAX_READING_BYTES = 12000;

/** The reader's summary as an object, or null when there is nothing a heartbeat could honestly carry. */
export function readingFromSummary(summaryText) {
  const text = typeof summaryText === 'string' ? summaryText.trim() : '';
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const bytes = Buffer.byteLength(JSON.stringify(parsed));
  if (bytes <= MAX_READING_BYTES) return parsed;
  // too large to store whole: keep the counts, say what was dropped
  const counts = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
  return { ...counts, summary_reduced: true, summary_bytes: bytes };
}

/**
 * The request body. Throws an Error with code 'bad_call' for an unknown reader, and 'nothing_to_post' when the reader
 * failed (non-zero exit) or printed no JSON object.
 */
export function buildHeartbeatBody({ name, summary, elapsedMs, readerExit }) {
  const fail = (code, message) => Object.assign(new Error(message), { code });
  if (!READERS.includes(name)) throw fail('bad_call', 'unknown reader');
  const exit = Number.parseInt(readerExit ?? '0', 10);
  if (Number.isFinite(exit) && exit !== 0) throw fail('nothing_to_post', `reader exit ${exit}`);
  const reading = readingFromSummary(summary);
  if (!reading) throw fail('nothing_to_post', 'no JSON summary');
  const elapsed = Number.parseInt(elapsedMs ?? '0', 10);
  return { p_jobname: name, p_reading: reading, p_elapsed_ms: Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0 };
}

export async function postHeartbeat({ url, key, body, fetchImpl = fetch, timeoutMs = 20000 }) {
  const res = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/rpc/record_reader_heartbeat`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.status;
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log('heartbeat: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required'); return 2; }
  const name = READERS.includes(process.env.READER_NAME) ? process.env.READER_NAME : 'unknown-reader';
  let body;
  try {
    body = buildHeartbeatBody({ name: process.env.READER_NAME, summary: process.env.READER_SUMMARY, elapsedMs: process.env.READER_ELAPSED_MS, readerExit: process.env.READER_EXIT });
  } catch (e) {
    if (e.code === 'nothing_to_post') { console.log(`heartbeat ${name} not posted: ${e.message}`); return 3; }
    console.log(`heartbeat: ${e.message}`);
    return 2;
  }
  try {
    const status = await postHeartbeat({ url, key, body });
    console.log(`heartbeat ${name} HTTP ${status}`);
    return status === 200 ? 0 : 1;
  } catch (e) {
    console.log(`heartbeat ${name} not sent: ${e.name === 'TimeoutError' ? 'timeout' : 'request failed'}`);
    return 1;
  }
}

// realpath both sides: a symlinked checkout must still run main()
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
