import fs from 'fs/promises';
import path from 'path';
import { buildContext, RlmConfig, RlmRunner, CallLogEntry } from './rlm_runner';

type ArgMap = Record<string, string | boolean>;

function parseArgs(argv: string[]): ArgMap {
  const args: ArgMap = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
        i += 1;
      } else {
        args[key] = next;
        i += 2;
      }
    } else {
      i += 1;
    }
  }
  return args;
}

function resolvePath(input: string, baseDir: string): string {
  if (path.isAbsolute(input)) return input;
  return path.resolve(baseDir, input);
}

async function loadConfig(configPath: string): Promise<RlmConfig> {
  const raw = await fs.readFile(configPath, 'utf8');
  return JSON.parse(raw) as RlmConfig;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const configPath = resolvePath(
    typeof args.config === 'string' ? args.config : 'scripts/rlm/rlm.config.json',
    cwd
  );
  const config = await loadConfig(configPath);

  const projectRoot = resolvePath(
    typeof args['project-root'] === 'string' ? args['project-root'] : (config.projectRoot ?? '.'),
    cwd
  );

  const outputPath = resolvePath(
    typeof args.output === 'string' ? args.output : 'scripts/rlm/rlm_context.md',
    cwd
  );

  const basePromptPath =
    typeof args['base-prompt'] === 'string'
      ? resolvePath(args['base-prompt'], cwd)
      : path.join(projectRoot, 'PROMPT.md');

  const goal =
    typeof args.goal === 'string'
      ? args.goal
      : (config.goal ?? 'Summarize long-context documents for Ralph.');

  const dryRun = Boolean(args['dry-run']);

  const contextResult = await buildContext(config, projectRoot);

  let summary = '';
  const logPath = resolvePath('scripts/rlm/rlm_calls.jsonl', cwd);
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  if (!dryRun) {
    const runner = new RlmRunner(config, contextResult.context, async (entry: CallLogEntry) => {
      await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    });
    summary = await runner.summarize(goal);
  } else {
    summary = [
      'Dry run enabled. No Claude calls were made.',
      `Context chars: ${contextResult.totalChars}`,
      `Files included: ${contextResult.files.length}`,
      `Truncated: ${contextResult.truncated ? 'yes' : 'no'}`
    ].join('\n');
  }

  let basePrompt = '';
  try {
    basePrompt = await fs.readFile(basePromptPath, 'utf8');
  } catch {
    basePrompt = '';
  }

  const outputParts = [
    basePrompt.trim(),
    '## RLM_CONTEXT',
    summary.trim(),
    '## RLM_INPUT_FILES',
    ...contextResult.files.map((file) => `- ${file}`)
  ].filter((part) => part.length > 0);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${outputParts.join('\n\n')}\n`, 'utf8');

  const metaPath = resolvePath('scripts/rlm/rlm_context.meta.json', cwd);
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        outputPath,
        projectRoot,
        configPath,
        contextChars: contextResult.totalChars,
        filesIncluded: contextResult.files.length,
        truncated: contextResult.truncated,
        logPath
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`RLM context written to: ${outputPath}`);
  console.log(`Context files included: ${contextResult.files.length}`);
  if (contextResult.truncated) {
    console.warn('Context truncated due to maxTotalChars limit.');
  }
}

main().catch((error) => {
  console.error('RLM CLI failed:', error);
  process.exit(1);
});
