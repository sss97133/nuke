#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AssayError, runQuestionnaireAssay } from './lib/jev-questionnaire-assay.mjs';

export function parseArgs(args) {
  const options = { run: false };
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--run') { if (options.run) throw new AssayError('duplicate_run_flag'); options.run = true; }
    else if (['--bank', '--records', '--out'].includes(name)) {
      const key = name.slice(2);
      if (options[key] || !args[index + 1] || args[index + 1].startsWith('--')) throw new AssayError('invalid_file_argument');
      options[key] = args[++index];
    } else throw new AssayError('unknown_argument');
  }
  if (!options.bank || !options.records || !options.out) throw new AssayError('bank_records_out_required');
  return options;
}
async function readJson(path) {
  try {
    const handle = await open(path, 'r');
    try {
      if ((await handle.stat()).size > 2_000_000) throw new AssayError('input_file_too_large');
      return JSON.parse(await handle.readFile('utf8'));
    } finally { await handle.close(); }
  } catch (error) { throw error instanceof AssayError ? error : new AssayError('input_file_unreadable_or_invalid_json'); }
}
export async function main(args = process.argv.slice(2), deps = {}) {
  let output;
  try {
    const options = parseArgs(args);
    const [bank, records] = await Promise.all([readJson(options.bank), readJson(options.records)]);
    // Validate before opening an artifact; no provider call occurs on malformed input.
    await runQuestionnaireAssay({ bank, records });
    // Exclusive creation refuses overwrites/symlinks and proves output is writable before spending.
    try { output = await open(options.out, 'wx', 0o600); } catch { throw new AssayError('output_exists_or_unwritable'); }
    await output.chmod(0o600);
    const report = await runQuestionnaireAssay({ bank, records, run: options.run,
      apiKey: options.run ? (deps.apiKey ?? process.env.TYPESAFE_API_KEY ?? '') : '', fetchImpl: deps.fetchImpl ?? globalThis.fetch });
    await output.writeFile(JSON.stringify(report, null, 2) + '\n');
    (deps.print ?? console.log)(JSON.stringify(report.summary));
    return report.summary.failed_records > 0 ? 1 : 0;
  } catch (error) {
    const code = error instanceof AssayError ? error.code : 'assay_failed';
    (deps.print ?? console.log)(JSON.stringify({ success: false, error: code }));
    return 1;
  } finally { await output?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
