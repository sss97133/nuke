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
// A reader can report in and read nothing (2026-11-10: frames 20, read 0 on every fire, for days, while the watch was
// green because a row arrived). So when a reader took photos and read none, the heartbeat carries zero_read_since and
// zero_read_fires forward from its previous row; a fire that read something ends the run, an idle fire (no frames)
// leaves it as it was. assay_photo_reading_flow raises on a long run.
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

const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The reading with the zero-read run carried forward. `previous` is the reader's last stored reading (or null when it
 * could not be read: the run then starts now, which delays an alarm but never invents a longer run).
 *   took photos, read none   zero_read_since = previous run's start or now; zero_read_fires = previous + 1
 *   read at least one        both removed
 *   idle (no frames)         both kept as they were
 */
export function withZeroReadRun(reading, previous, nowIso) {
  const frames = count(reading.frames), read = count(reading.read);
  const prevSince = typeof previous?.zero_read_since === 'string' && !Number.isNaN(Date.parse(previous.zero_read_since)) ? previous.zero_read_since : null;
  const prevFires = prevSince ? Math.max(0, Math.trunc(count(previous.zero_read_fires) ?? 0)) : 0;
  const { zero_read_since: _s, zero_read_fires: _f, ...rest } = reading;  // the reader does not set these itself
  if (frames !== null && frames > 0 && read === 0) return { ...rest, zero_read_since: prevSince ?? nowIso, zero_read_fires: prevFires + 1 };
  if (frames === 0 && prevSince) return { ...rest, zero_read_since: prevSince, zero_read_fires: prevFires };
  return rest;
}

/** The reader's last stored reading, or null (no row yet, or the read failed). */
export async function previousReading({ url, key, name, fetchImpl = fetch, timeoutMs = 10000 }) {
  try {
    const res = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/job_assay_readings?jobname=eq.${encodeURIComponent(name)}&select=reading`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 200) return null;
    const rows = await res.json();
    const r = Array.isArray(rows) ? rows[0]?.reading : null;
    return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
  } catch {
    return null;
  }
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
  body.p_reading = withZeroReadRun(body.p_reading, await previousReading({ url, key, name }), new Date().toISOString());
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
