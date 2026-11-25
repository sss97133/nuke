#!/usr/bin/env node
// Decode-rule producer: reads indexed factory manual chunks (service_manual_chunks) one at a time with the owner's
// subscription CLI and sends every code it finds to vehicle_decode_rule_propose, which keeps a rule only when the
// gate in 20261125120000_decode_rule_proposals_gate.sql passes (factory document, code and printed value within
// 160 characters of the cited chunk, a measured consumer, fills >= 1 reader row and removes none).
// The model's answer is a proposal, never a rule: this script writes nothing else.
//
//   dotenvx run -q -- node scripts/decode-rules/propose-from-chunks.mjs --make Chevrolet --years 1974-1980 \
//     --document <library_documents.id> [--match "VEHICLE IDENTIFICATION|SERIES"] [--limit 20] [--dry-run]
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { client, arg } from '../doubts/db.mjs';
import { runClaudeCli, readCliResult, answerJsonFrom } from '../doubts/readers.mjs';

// Keys with a measured consumer (data_set_candidates_v1). The gate refuses any other key; asking only for these keeps
// the reader inside what can land.
export const RULE_KEYS = {
  vin_series_char: 'the VIN character that names the series / chassis line; value {"series": <as printed>}',
  vin_body_code: 'the VIN character(s) that name the body style; value {"body": <as printed>}',
  vin_engine_char: 'the VIN character that names the engine; value {"engine": <as printed>}',
  vin_plant_char: 'the VIN character that names the assembly plant; value {"plant": <as printed>}',
};

export function taskFor(chunk, make, years) {
  return {
    instructions: [
      `This is one page of a ${make} factory manual (${years[0]}-${years[1]}). List every VIN decode code printed in it.`,
      'Use only the text in "page". Do not use anything you know about these vehicles. If the page prints no VIN code table, answer {"items": []}.',
      'For each code give: rule_key (one of the keys below), code (exactly as printed), value_text (the meaning exactly as printed, copied',
      'character for character from the page, at most 60 characters, and printed near the code), value (an object as described).',
      'Keys: ' + Object.entries(RULE_KEYS).map(([k, d]) => `${k}: ${d}`).join('; '),
      'Answer: {"items": [{"rule_key": "...", "code": "...", "value_text": "...", "value": {...}}]}',
    ].join('\n'),
    page: chunk.content,
  };
}

export function validItems(answer, chunkText) {
  const page = String(chunkText ?? '').toUpperCase().replace(/\s+/g, ' ');
  return (Array.isArray(answer?.items) ? answer.items : []).filter((it) =>
    it && RULE_KEYS[it.rule_key] && typeof it.code === 'string' && it.code.trim() && typeof it.value_text === 'string'
    && it.value_text.trim().length > 0 && it.value_text.length <= 60 && it.value && typeof it.value === 'object' && !Array.isArray(it.value)
    && page.includes(it.value_text.toUpperCase().replace(/\s+/g, ' ').trim()));
}

async function main(argv) {
  const make = arg(argv, '--make');
  const years = (arg(argv, '--years') ?? '').split('-').map(Number);
  const document = arg(argv, '--document');
  const match = arg(argv, '--match', 'VEHICLE IDENTIFICATION|SERIAL NUMBER|VIN ');
  const limit = Math.min(Number(arg(argv, '--limit', '20')), 50);
  const dry = argv.includes('--dry-run');
  if (!make || years.length !== 2 || !years.every(Number.isInteger) || !document) throw new Error('--make, --years YYYY-YYYY and --document are required');

  const db = client();
  const chunks = await db.req(`service_manual_chunks?select=id,page_number,content&document_id=eq.${document}`
    + `&content=imatch.${encodeURIComponent(match)}&order=page_number&limit=${limit}`);
  const out = { chunks: chunks.length, read: 0, items: 0, active: 0, rejected: 0, reasons: {}, errors: 0 };
  for (const c of chunks) {
    const dir = mkdtempSync(join(tmpdir(), 'decode-rule-'));
    try {
      writeFileSync(join(dir, 'task.json'), JSON.stringify(taskFor(c, make, years)));
      const r = readCliResult(await runClaudeCli(dir, process.env));
      if (r.stop) { console.error(r.error); break; }
      if (r.error) { out.errors++; continue; }
      out.read++;
      for (const it of validItems(answerJsonFrom(r.text), c.content)) {
        out.items++;
        if (dry) { console.log(JSON.stringify({ chunk: c.id, page: c.page_number, rule_key: it.rule_key, code: it.code })); continue; }
        const res = await db.rpc('vehicle_decode_rule_propose', {
          p_rule_key: it.rule_key, p_make: make, p_model: null, p_code: it.code.trim().toUpperCase(), p_year_min: years[0], p_year_max: years[1],
          p_value: it.value, p_value_text: it.value_text.trim(), p_citation_chunk_id: c.id, p_proposer: `propose-from-chunks:${r.model ?? 'cli'}`,
        });
        if (res.status === 'active') out.active++; else out.rejected++;
        for (const why of res.reasons ?? []) out.reasons[why] = (out.reasons[why] ?? 0) + 1;
      }
    } catch (e) { out.errors++; console.error(String(e.message ?? e).slice(0, 200)); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify(out));
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
