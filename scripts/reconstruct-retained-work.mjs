#!/usr/bin/env node
/** Offline source reconstruction. Input and output are private captured records;
 * no source fetching, database writes, image inference or payment actions.
 * node scripts/reconstruct-retained-work.mjs --input /private/capture.json --out /private/reconstruction.json
 */
import { readFile, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reconstructRetainedWork } from './lib/retained-work-reconstruction.mjs';

export async function run(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (!['--input', '--out'].includes(args[i]) || !args[i + 1] || options[args[i].slice(2)]) throw new Error('expected_input_and_out');
    options[args[i].slice(2)] = args[++i];
  }
  if (!options.input || !options.out) throw new Error('expected_input_and_out');
  const target = path.join(await realpath(path.dirname(path.resolve(options.out))), path.basename(options.out));
  const dir = path.dirname(fileURLToPath(import.meta.url));
  // Refuse any Git checkout, including another worktree: real source data never
  // becomes a checked-in fixture, even when the checkout differs from this one.
  try { execFileSync('git', ['-C', path.dirname(target), 'rev-parse', '--show-toplevel'], { stdio: 'pipe' });
    throw new Error('private_output_outside_git_required');
  } catch (error) { if (error.message === 'private_output_outside_git_required') throw error; }
  const bytes = await readFile(options.input);
  if (bytes.byteLength > 256 * 1024 * 1024) throw new Error('capture_too_large');
  const input = JSON.parse(bytes.toString('utf8'));
  const result = reconstructRetainedWork(input);
  result.receipt = { inputSha256: createHash('sha256').update(bytes).digest('hex'),
    implementationSha256: createHash('sha256').update(await readFile(path.join(dir, 'lib/retained-work-reconstruction.mjs'))).digest('hex'),
    generatedAt: new Date().toISOString() };
  const file = await open(target, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(result, null, 2) + '\n'); } finally { await file.close(); }
  return { output: target, scopeEntries: result.scopeEntries.length, paymentReports: result.paymentReports.length,
    obligations: result.obligations.length, selectedImages: result.imageBacklog.length,
    sourceCoverage: result.coverage.workRecords.state, effects: result.effects };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(error => {
    const code = /^[a-z_]+$/.test(error.message) ? error.message : error.code === 'EEXIST'
      ? 'output_already_exists' : 'invalid_or_unreadable_capture';
    process.stderr.write(`Reconstruction failed: ${code}\n`); process.exitCode = 1;
  });
}
