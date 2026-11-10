#!/usr/bin/env node
// reader-heartbeat.mjs — post one subscription reader's heartbeat to record_reader_heartbeat.
//
// subscription-reader-batch.sh used to build this request by splicing the reader's summary into the text of a
// `bash -c` script. The summary's quotes ended the shell string, so the body was never JSON (no heartbeat landed after
// the hand run of 2026-11-08), and its contents were evaluated by the shell: by_type keys are model output read from
// photographed documents, and that process holds the service-role key. Here the summary arrives in the environment
// and is only ever parsed as JSON; nothing in it reaches a shell.
//
//   READER_NAME=subscription-frame-classifier READER_SUMMARY='{"frames":20,...}' READER_ELAPSED_MS=41000 \
//     dotenvx run -- node scripts/photo-pipeline/reader-heartbeat.mjs
//
// Exit 0 when the heartbeat landed (HTTP 200), 1 when it did not, 2 on a bad call. Prints one line, never a secret.
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const READERS = ['subscription-document-reader', 'subscription-frame-classifier'];
export const MAX_READING_BYTES = 20000; // record_reader_heartbeat refuses a reading over 20 kB

/** The reading to store: the reader's summary when it is a JSON object, otherwise a statement of what arrived. */
export function readingFromSummary(summaryText) {
  const text = typeof summaryText === 'string' ? summaryText.trim() : '';
  if (!text) return { error: 'no_summary' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'summary_not_json', summary_bytes: Buffer.byteLength(text), summary_excerpt: text.slice(0, 200) };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'summary_not_object', summary_type: Array.isArray(parsed) ? 'array' : typeof parsed };
  }
  const bytes = Buffer.byteLength(JSON.stringify(parsed));
  if (bytes > MAX_READING_BYTES) return { error: 'summary_too_large', summary_bytes: bytes };
  return parsed;
}

/** The request body, or a thrown Error naming what is wrong with the call. */
export function buildHeartbeatBody({ name, summary, elapsedMs }) {
  if (!READERS.includes(name)) throw new Error(`unknown reader ${JSON.stringify(name ?? null)}`);
  const elapsed = Number.parseInt(elapsedMs ?? '0', 10);
  return {
    p_jobname: name,
    p_reading: readingFromSummary(summary),
    p_elapsed_ms: Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0,
  };
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
  let body;
  try {
    body = buildHeartbeatBody({ name: process.env.READER_NAME, summary: process.env.READER_SUMMARY, elapsedMs: process.env.READER_ELAPSED_MS });
  } catch (e) {
    console.log(`heartbeat: ${e.message}`);
    return 2;
  }
  try {
    const status = await postHeartbeat({ url, key, body });
    console.log(`heartbeat ${body.p_jobname} HTTP ${status}${body.p_reading.error ? ` (${body.p_reading.error})` : ''}`);
    return status === 200 ? 0 : 1;
  } catch (e) {
    console.log(`heartbeat ${body.p_jobname} not sent: ${e.name === 'TimeoutError' ? 'timeout' : 'request failed'}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
