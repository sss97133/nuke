#!/usr/bin/env node
/**
 * propose.mjs: ask the local model for new data stacks, validate them strictly, measure each against the live data
 * model (read-only), and record them. No API spend: the model is local (Odysseus workspace, Qwen 3.5 9B).
 *
 *   dotenvx run -q -- node scripts/stacks/propose.mjs            # STACKS_N proposals (default 10) through `ody ask`
 *   STACKS_N=5 node scripts/stacks/propose.mjs --dry-run         # build and print the prompt; ask nothing
 *   STACKS_ASKER=ollama node scripts/stacks/propose.mjs          # same model, straight from the running Ollama server
 *   STACKS_ASKER=auto node scripts/stacks/propose.mjs            # ody first; on any asker failure or empty batch, Ollama for the rest
 *   node scripts/stacks/propose.mjs --registry                   # also write registry-<run>.sql for review (the registry's writer is a migration; nothing is applied)
 *
 * Flow: one atlas pull plus one registry read (cached in the run folder) -> prompt (grammar, top live tables, gaps, names to avoid) -> ask in
 * batches -> extract JSON (one repair retry on bad JSON) -> strict validation -> drop duplicates of the 60 existing stacks
 * and of the registry and earlier proposals -> measure (the registry's rules) -> append to proposals/<UTC>.jsonl and regenerate INDEX.md after every batch.
 * Env: STACKS_N, STACKS_BATCH, STACKS_ASKER (ody|ollama|auto), STACKS_ASK_TIMEOUT_S, STACKS_BUDGET_S, STACKS_FOCUS, STACKS_LOG_DIR,
 *      STACKS_CASES_DOC, STACKS_OLLAMA_MODEL, STACKS_SEEDS=0 (no per-batch seed tables). Exit: 0 at least one proposal recorded, 1 none, 2 usage, 3 asker unavailable.
 */
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AskError, killActive, makeAsker } from './lib/ask.mjs';
import { atlasMeta, atlasSummary, loadAtlas, loadRegistry, pickSeeds, seedDetails } from './lib/atlas.mjs';
import { LOG_ROOT, duplicateOf, ensureDir, nameKey, redact, utcStamp, writeJson } from './lib/common.mjs';
import { DEFAULT_CASES_DOC, loadEarlierProposals, loadExistingStacks } from './lib/existing.mjs';
import { batchSchema, buildPrompt, buildRepairPrompt, extractProposalObjects, validateProposal } from './lib/grammar.mjs';
import { appendRecords, proposalsDir, writeIndex } from './lib/output.mjs';
import { buildIndex, buildRecord, measureNeeds } from './measure.mjs';

const say = (...parts) => console.log('[stacks]', ...parts);
const EARLIER_IN_PROMPT = 40; // names of earlier proposals shown to the model; the code dedupes against all of them

export function parseArgs(argv, env = process.env) {
  const flags = {};
  const o = { registry: false, dryRun: false, help: false, seeds: env.STACKS_SEEDS !== '0' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--registry') o.registry = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-seeds') o.seeds = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (['--n', '--batch', '--asker', '--cases-doc', '--log-dir', '--focus'].includes(a)) flags[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  const int = (value, fallback, lo, hi, label) => {
    const x = value === undefined || value === '' ? fallback : Number(value);
    if (!Number.isInteger(x) || x < lo || x > hi) throw new Error(`${label} must be an integer from ${lo} to ${hi} (got "${value}")`);
    return x;
  };
  o.n = int(flags.n ?? env.STACKS_N, 10, 1, 100, 'STACKS_N');
  o.batch = Math.min(int(flags.batch ?? env.STACKS_BATCH, 5, 1, 10, 'STACKS_BATCH'), o.n);
  o.asker = flags.asker ?? env.STACKS_ASKER ?? 'ody';
  if (!['ody', 'ollama', 'auto'].includes(o.asker)) throw new Error(`STACKS_ASKER must be ody, ollama or auto (got "${o.asker}")`);
  o.askTimeoutMs = int(env.STACKS_ASK_TIMEOUT_S, 600, 10, 3600, 'STACKS_ASK_TIMEOUT_S') * 1000;
  o.budgetMs = int(env.STACKS_BUDGET_S, 1500, 30, 86400, 'STACKS_BUDGET_S') * 1000;
  o.focus = flags.focus ?? env.STACKS_FOCUS ?? null; // optional free text steering every batch, for example "people and reputation"
  o.casesDoc = resolve(flags['cases-doc'] ?? env.STACKS_CASES_DOC ?? DEFAULT_CASES_DOC);
  o.logRoot = resolve(flags['log-dir'] ?? LOG_ROOT);
  return o;
}

/**
 * Validate and deduplicate the elements of one reply. `known` and `taken` are {name} lists; `limit` caps admissions.
 * Returns { admitted: [proposal], rejected: [{name, reason, of?, errors?}], surplus }.
 */
export function admit(items, known, taken, limit) {
  const admitted = [];
  const rejected = [];
  let surplus = 0;
  for (const item of items) {
    const checked = validateProposal(item);
    if (!checked.ok) { rejected.push({ name: typeof item?.name === 'string' ? item.name.slice(0, 80) : null, reason: 'malformed', errors: checked.errors.slice(0, 6) }); continue; }
    const repeat = duplicateOf(checked.value.name, [...known, ...taken, ...admitted]);
    if (repeat) { rejected.push({ name: checked.value.name, reason: 'duplicate', of: repeat.name }); continue; }
    if (admitted.length >= limit) { surplus++; continue; }
    admitted.push(checked.value);
  }
  return { admitted, rejected, surplus };
}

/** One batch: ask, extract, admit; if nothing usable came back, one repair prompt in the same session. */
export async function askBatch({ asker, runDir, tag, k, prompt, known, taken, deadline, askTimeoutMs, rawLog, useSchema }) {
  const session = asker.newSession(tag);
  const messages = [];
  const calls = [];
  const schema = useSchema ? batchSchema(k) : undefined;
  const attempt = async (text, n) => {
    const remaining = deadline - Date.now();
    if (remaining < 15000) throw new AskError('budget', 'run time budget used up', { fatal: true });
    messages.push({ role: 'user', content: text });
    writeFileSync(join(runDir, `prompt-${tag}-a${n}.txt`), text);
    let reply;
    try {
      reply = await asker.ask(session, messages, { timeoutMs: Math.min(askTimeoutMs, remaining), schema });
    } catch (error) {
      if (error instanceof AskError) {
        appendFileSync(rawLog, `\n===== ${asker.via} ${tag} attempt ${n} at ${new Date().toISOString()}: FAILED ${error.kind} =====\n${redact([error.hint, error.detail?.stdout, error.detail?.stderr].filter(Boolean).join('\n'))}\n`);
      }
      throw error;
    }
    messages.push({ role: 'assistant', content: reply.text });
    appendFileSync(rawLog, `\n===== ${asker.via} ${tag} attempt ${n} at ${new Date().toISOString()}: ${reply.ms} ms, ${reply.text.length} chars =====\n${redact(reply.text)}\n`);
    const extracted = extractProposalObjects(reply.text);
    calls.push({ tag, attempt: n, ms: reply.ms, chars: reply.text.length, parsed: extracted.items.length, complete: extracted.complete, problems: extracted.problems, ...reply.meta });
    return extracted;
  };
  let outcome = null;
  try {
    let extracted = await attempt(prompt, 1);
    outcome = admit(extracted.items, known, taken, k);
    const unusable = outcome.admitted.length === 0 && !outcome.rejected.some(r => r.reason === 'duplicate');
    if (unusable) {
      const problem = extracted.items.length === 0 ? (extracted.problems.join('; ') || 'no JSON array found') : 'no element passed validation';
      const errors = outcome.rejected.flatMap(r => (r.errors ?? []).map(e => `${r.name ?? 'element'}: ${e}`));
      extracted = await attempt(buildRepairPrompt({ k, problem, errors }), 2);
      calls[calls.length - 1].repair = true;
      const second = admit(extracted.items, known, taken, k);
      outcome = { admitted: second.admitted, rejected: [...outcome.rejected, ...second.rejected], surplus: second.surplus };
    }
    return { ...outcome, calls };
  } catch (error) {
    error.calls = calls;
    error.rejected = outcome?.rejected ?? [];
    throw error;
  } finally {
    await asker.endSession(session);
  }
}

function acquireLock(logRoot) {
  const path = join(logRoot, '.lock');
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, 'utf8').trim());
    if (pid > 0) {
      try { process.kill(pid, 0); return null; } catch (error) { if (error.code === 'EPERM') return null; }
    }
  }
  writeFileSync(path, String(process.pid));
  return () => { try { if (readFileSync(path, 'utf8').trim() === String(process.pid)) unlinkSync(path); } catch { /* already gone */ } };
}

const dayOfYear = d => Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);

const USAGE = 'usage: node scripts/stacks/propose.mjs [--n N] [--batch K] [--asker ody|ollama|auto] [--dry-run] [--no-seeds] [--registry] [--cases-doc FILE] [--log-dir DIR] [--focus TEXT]';

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  let o;
  try { o = parseArgs(argv, env); } catch (error) { console.error(`propose: ${error.message}\n${USAGE}`); return 2; }
  if (o.help) { console.log(USAGE); return 0; }

  const started = new Date();
  const run = utcStamp(started);
  ensureDir(o.logRoot);
  const release = acquireLock(o.logRoot);
  if (!release) { say('another run holds the lock; nothing to do'); return 0; }
  const runDir = ensureDir(join(o.logRoot, 'runs', run));
  const summary = { run, started_at: started.toISOString(), params: { n: o.n, batch: o.batch, asker: o.asker, ask_timeout_s: o.askTimeoutMs / 1000, budget_s: o.budgetMs / 1000, dry_run: o.dryRun, registry: o.registry },
    atlas: null, existing: null, calls: [], accepted: [], rejected: [], asker_switches: [], fatal: null, interrupted: null, exit_code: null };
  let interrupted = null;
  const onSignal = signal => { interrupted = signal; killActive(); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    say(`run ${run}: n=${o.n} batch=${o.batch} asker=${o.asker} log=${o.logRoot}`);
    const atlas = await (deps.loadAtlas ?? loadAtlas)({ runDir });
    summary.atlas = { ...atlasMeta(atlas), pull_ms: atlas.pull_ms ?? null };
    say(`atlas: ${summary.atlas.objects} relations, ${summary.atlas.atlas_rows} atlas rows, ${summary.atlas.registry_rows} registry rows (pulled ${atlas.pulled_at})`);

    const existing = deps.existing ?? loadExistingStacks(o.casesDoc);
    const earlier = deps.earlier ?? loadEarlierProposals(o.logRoot);
    const registry = await (deps.loadRegistry ?? loadRegistry)({ runDir });
    summary.existing = { doc_found: existing.found, names: existing.stacks.length, earlier_proposals: earlier.length,
      registry_available: registry.available, registry_stacks: registry.stacks.length, registry_substrates: registry.substrates.length };
    if (!registry.available) say(`registry not read (${registry.error ?? 'unavailable'}); existing stacks come from the case ledger only`);
    if (!existing.found) say(`WARNING: case ledger not found at ${o.casesDoc}; existing stacks will not be excluded`);
    else if (existing.stacks.length < 60) say(`WARNING: only ${existing.stacks.length} existing stack names parsed (expected 64); the checkout may predate case ledger 13.2`);
    // Names to avoid: the case ledger's stacks, what the registry holds (it can hold more than the ledger names), earlier proposals.
    const existingNames = [...new Map([...existing.stacks.map(s => s.name), ...registry.stacks.map(s => s.name)].map(n => [nameKey(n), n])).values()];
    const known = [...existingNames.map(name => ({ name })), ...earlier.map(e => ({ name: e.name }))];
    const atlasText = atlasSummary(atlas);
    const index = buildIndex(atlas, registry);

    if (o.dryRun) {
      const prompt = buildPrompt({ k: o.batch, focus: o.focus, atlasText,
        seeds: o.seeds ? seedDetails(atlas, pickSeeds(atlas, { k: o.batch, salt: dayOfYear(started) * 11 + 1 })) : [], existingNames, earlierNames: earlier.slice(0, EARLIER_IN_PROMPT).map(e => e.name) });
      writeFileSync(join(runDir, 'prompt-dry-run.txt'), prompt);
      console.log(prompt);
      say(`dry run: prompt ${prompt.length} chars written to ${join(runDir, 'prompt-dry-run.txt')}; nothing was asked`);
      summary.exit_code = 0;
      return 0;
    }

    const queue = o.asker === 'auto' ? ['ody', 'ollama'] : [o.asker]; // later entries are fallbacks, used only in auto mode
    const build = kind => (deps.makeAsker ?? makeAsker)(kind, { runDir });
    let asker = build(queue.shift());
    const switchAsker = (reason, kind) => {
      const next = queue.shift();
      say(`switching asker ${asker.via} -> ${next} (${kind}: ${reason})`);
      summary.asker_switches.push({ from: asker.via, to: next, kind, reason });
      asker = build(next);
    };
    const outFile = join(proposalsDir(o.logRoot), `${run}.jsonl`);
    const deadline = started.getTime() + o.budgetMs;
    const records = [];
    const maxCalls = 3 * Math.ceil(o.n / o.batch) + 2; // slack: about half of what a 9B model proposes repeats an existing stack; the time budget is the real limit
    let calls = 0, failures = 0, emptyBatches = 0;

    while (calls < maxCalls && records.length < o.n && !interrupted) {
      const b = calls + 1;
      const k = Math.min(o.batch, o.n - records.length);
      const taken = records.map(r => ({ name: r.name }));
      const seeds = o.seeds ? seedDetails(atlas, pickSeeds(atlas, { k, salt: dayOfYear(started) * 11 + b })) : [];
      const prompt = buildPrompt({ k, focus: o.focus, atlasText, seeds, existingNames,
        earlierNames: [...earlier.slice(0, EARLIER_IN_PROMPT).map(e => e.name), ...taken.map(t => t.name)] });
      say(`batch ${b}/${maxCalls}: asking ${asker.via} for ${k} (prompt ${prompt.length} chars; focus: ${o.focus ?? 'none'}; seeds: ${seeds.map(x => x.name).join(', ') || 'none'})`);
      let result;
      try {
        result = await askBatch({ asker, runDir, tag: `b${b}`, k, prompt, known, taken, deadline, askTimeoutMs: o.askTimeoutMs,
          rawLog: join(runDir, `${asker.via}-raw.log`), useSchema: asker.via === 'ollama' });
      } catch (error) {
        summary.calls.push(...(error.calls ?? []).map(c => ({ ...c, via: asker.via })));
        summary.rejected.push(...(error.rejected ?? []).map(r => ({ ...r, batch: b })));
        if (!(error instanceof AskError)) throw error;
        say(`batch ${b}: ${error.kind}: ${error.hint}`);
        if (interrupted) break;
        if (error.kind === 'budget') { summary.fatal = { kind: error.kind, hint: error.hint }; break; } // out of time: a fallback would not help
        if (queue.length) { switchAsker(error.hint, error.kind); continue; } // the failed attempt does not use up a batch
        if (error.fatal) { summary.fatal = { kind: error.kind, hint: error.hint }; break; }
        calls++;
        if (++failures >= 2) { summary.fatal = { kind: 'repeated_failure', hint: `${error.kind}: ${error.hint}` }; break; }
        continue;
      }
      calls++;
      failures = 0;
      summary.calls.push(...result.calls.map(c => ({ ...c, via: asker.via })));
      summary.rejected.push(...result.rejected.map(r => ({ ...r, batch: b })));
      if (!result.admitted.length && !result.rejected.length) { // not one parseable element, even after the repair prompt
        say(`batch ${b}: no usable elements in the reply`);
        if (queue.length) { switchAsker('no parseable elements after a repair prompt', 'no_usable_reply'); continue; }
        if (++emptyBatches >= 2) { summary.fatal = { kind: 'no_usable_replies', hint: 'two batches in a row returned nothing parseable' }; break; }
      } else emptyBatches = 0;
      const measuredAt = new Date().toISOString();
      const fresh = result.admitted.map(proposal => buildRecord({
        proposal, asker: { via: asker.via, model: asker.model }, run, proposedAt: measuredAt, measuredAt, atlas, measured: measureNeeds(index, proposal.needs),
      }));
      appendRecords(outFile, fresh);
      records.push(...fresh);
      if (fresh.length) writeIndex(o.logRoot);
      const timing = result.calls.map(c => `${(c.ms / 1000).toFixed(0)}s${c.repair ? ' repair' : ''}`).join(' + ');
      say(`batch ${b}: ${timing}; admitted ${fresh.length}, rejected ${result.rejected.length}${result.rejected.length ? ` (${[...new Set(result.rejected.map(r => r.reason))].join(', ')})` : ''}`);
      for (const r of fresh) say(`  ${(100 * r.coverage.coverage).toFixed(0).padStart(3)}% covered  ${r.coverage.present}/${r.coverage.partial}/${r.coverage.missing}  ${r.name}`);
    }

    summary.accepted = records.map(r => ({ id: r.id, name: r.name, coverage: r.coverage.coverage, present: r.coverage.present, partial: r.coverage.partial, missing: r.coverage.missing }));
    summary.interrupted = interrupted;
    if (records.length) say(`recorded ${records.length} of ${o.n} -> ${outFile}`);
    if (records.length < o.n) say(`shortfall: ${o.n - records.length} fewer than requested${summary.fatal ? ` (${summary.fatal.kind})` : ''}`);
    if (records.length) say(`index: ${join(o.logRoot, 'INDEX.md')}`);
    if (o.registry && records.length) {
      const { writeToRegistry } = await import('./lib/registry.mjs');
      const outcome = await writeToRegistry(records, { runDir, registry });
      summary.registry = outcome;
      say(`registry: ${outcome.note}`);
    }
    let code = records.length ? 0 : 1;
    if (!records.length && summary.fatal && ['ody_not_running', 'ody_token_missing', 'ody_missing', 'ody_empty_reply', 'ollama_not_running'].includes(summary.fatal.kind)) code = 3;
    if (interrupted) code = 143;
    summary.exit_code = code;
    return code;
  } catch (error) {
    summary.fatal = summary.fatal ?? { kind: 'error', hint: error.message };
    console.error(`propose: ${error.message}`);
    summary.exit_code = 1;
    return 1;
  } finally {
    summary.finished_at = new Date().toISOString();
    try { writeJson(join(runDir, 'run.json'), summary); } catch { /* keep going; the log folder may be read-only */ }
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; });
}
