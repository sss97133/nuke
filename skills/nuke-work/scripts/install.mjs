#!/usr/bin/env node
// Install local workflow instructions; no model calls, services, or permission changes.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const apply = args.includes('--install');
const arg = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (args.includes('--help')) {
  console.log('node skills/nuke-work/scripts/install.mjs [--install] [--home DIR] [--repo DIR]');
  console.log('Default: show planned paths. --install backs up changed local files privately before writing.');
  process.exit(0);
}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--install') continue;
  if (['--home', '--repo'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) { i++; continue; }
  throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const userHome = resolve(arg('--home') || homedir());
const rejectSymlinkAncestors = path => {
  let current = resolve(path);
  while (true) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Refusing symlink target: ${current}`);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
};
rejectSymlinkAncestors(userHome);
const repo = resolve(arg('--repo') || join(userHome, 'nuke'));
const repoRelative = relative(userHome, repo);
if (repoRelative.startsWith('..') || resolve(userHome, repoRelative) !== repo) throw new Error('Repository must be inside the selected home directory.');
if (!existsSync(join(repo, 'AGENTS.md'))) throw new Error('Selected repository must contain AGENTS.md.');
const sourceSkill = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'SKILL.md');
const codexSkill = join(userHome, '.agents', 'skills', 'nuke-work', 'SKILL.md');
const claudeSkill = join(userHome, '.claude', 'skills', 'nuke-work', 'SKILL.md');
const skill = readFileSync(sourceSkill, 'utf8');
const files = new Map([[codexSkill, skill], [claudeSkill, skill]]);
const command = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\n---\n\nRead the installed nuke-work skill at ${claudeSkill}.\nUse the current checkout's AGENTS.md and applicable rules.\n\n${body}\n\nTask arguments: $ARGUMENTS\n`;
const modes = {
  scope: ['Clarify the outcome and implement the next Nuke repair', 'Use Scope mode.'],
  continue: ['Resume Nuke work from its current pickup', 'Use Continue mode.'],
  review: ['Review the exact Nuke change and applicable checks', 'Use Review mode.'],
  ship: ['Complete an authorized Nuke release through checked PR and CI', 'Use Ship mode.'],
  handoff: ['Preserve decisions and next action for the next Nuke agent', 'Use Handoff mode.'],
  status: ['Report current Nuke lane evidence and next action', 'Use Status mode.'],
  deploy: ['Complete an authorized Nuke deployment through its existing CI', 'Use Ship mode. Schema and Edge deployment belong to existing CI; never hand-apply migrations or deploy functions directly.'],
  audit: ['Review the current Nuke diff', 'Use Review mode; review the requested scope, without starting a whole-repository audit.'],
  'pre-commit-audit': ['Check the changed Nuke files before committing', 'Use Review mode. Run applicable installed checks once; preserve the project type ratchet and current design rules.'],
  'audit-and-fix': ['Review and resolve findings in the requested Nuke change', 'Use Review mode, fix substantive in-scope findings, then rerun affected checks.'],
  'audit-and-coordinate': ['Review the current Nuke change and resolve lane overlap', 'Use Review mode. Check relevant entries in the shared LANES.md; preserve others\' work and coordinate overlapping files.'],
  sync: ['Refresh Nuke lane state and preserve a useful pickup', 'Use Status then Handoff mode. Read relevant lane entries and changed files; do not load all historical logs.'],
  qa: ['Verify the requested Nuke user journey', 'Verify the named user journey end to end, including a relevant failure case. If no journey is named, use the current change. Use current frontend rules, not historical styling scans. A whole-platform sweep needs that explicit scope.'],
  health: ['Inspect current health of the affected Nuke subsystem', 'Inspect the named subsystem or current lane. For DB/jobs read the current atlas/job-health rows through sanctioned read tools; avoid full-table counts and unrelated service calls. Report measured time and retrieval limits.'],
  'debug-all': ['Repair the requested Nuke issue set one failure at a time', 'Use Continue mode for the named issue set or current task. Reproduce, repair and prove one user-visible failure at a time. Use existing checks and the PR/CI release path; preserve production holds.'],
  extract: ['Use the current sanctioned Nuke source intake', 'Check the current TOOLS.md/capability owner and retained captures for the supplied source. Use the existing authorized intake. Do not select retired extractors from memory, repeat capture/OCR without a gap, or invoke paid fallback/source activation without its authorization.'],
  library: ['Find or update the relevant Nuke library entry', 'Search within the relevant library subject first. Follow its librarian rules for requested contributions. Use the selected checkout, preserve dated evidence, and avoid line-count or documentation-volume targets.'],
  'deck-revise': ['Revise the requested Nuke deck slide', 'Identify the requested deck and slide from current context; do not assume a historical deck ID. Read the current structured slide and applicable design guidance, preserve unaffected content, and use its existing authorized writer. Preview the changed slide. No raw SQL writes or mandatory per-slide agents.'],
  'deck-coherence': ['Review the requested deck throughline and cited claims', 'Identify the requested deck from context. Read its structured slides and relevant design guidance. Check argument, entities, source coverage and consistency; report exact findings. Use the current agent unless a substantial independent review warrants delegation.'],
  'target-analysis': ['Inspect retained evidence for requested organizations', 'Inspect existing organization identity and attributed brand assets for the requested targets. Retain unresolved identity; most fields or earliest row alone does not establish canonical ownership. Use sanctioned intake for authorized new evidence. Do not mint raw SQL rows, impose a readiness percentage, or make a separate approval step a prerequisite for already-authorized deck work.'],
};
for (const [name, [description, body]] of Object.entries(modes)) {
  files.set(join(repo, '.claude', 'commands', `${name}.md`), command(name, description, body));
}
// Keep the specialized vision procedure, but replace its unmeasured billing/spawn assertions.
const visionPath = join(repo, '.claude', 'commands', 'vision-gate-l4.md');
if (existsSync(visionPath)) {
  let vision = readFileSync(visionPath, 'utf8');
  vision = vision.replace('via free Agent vision (no Anthropic API spend)', 'using the authorized vision review workflow');
  vision = vision.replace(/\*\*Per Skylar's directive:\*\*[^\n]*/, 'Use the current account and source authorization. Subscription usage is metered; do not claim agent vision is free. Delegate only a substantial bounded review, with the exact source and acceptance case.');
  vision = vision.replace('by spawning a vision-capable subagent', 'with a vision-capable agent');
  if (!vision.includes('## Current authorization')) {
    vision = vision.replace(/^(---\n[\s\S]*?\n---\n)/, `$1\n## Current authorization\n\nRead the installed nuke-work skill and current AGENTS.md first. This specialized procedure does not lift source, vision, paid-work or admission holds. Inspect the current sanctioned writer before running prepare or commit; a historical batch recipe does not grant database-write authority.\n`);
  }
  files.set(visionPath, vision);
}
files.set(join(repo, '.claude', 'agents', 'HOW_TO_USE.md'), `# Current agent workflow\n\nRead the selected checkout's AGENTS.md and ${claudeSkill}.\nUse /scope, /continue, /review, /ship, /handoff or /status.\nRegister ownership in the shared .claude/LANES.md and keep one private pickup per lane.\n\nHistorical agent_registry/task records are application data, not automatic assignment or write authority.\nUse current sanctioned readers and writers; never copy credentials into instructions or handoffs.\n`);
const registryPath = join(repo, '.claude', 'agents', 'REGISTRY.md');
if (existsSync(registryPath)) {
  let registry = readFileSync(registryPath, 'utf8');
  registry = registry.replace(/## Quick Commands[\s\S]*?(?=## Active Agent Types)/, '## Current coordination\n\nUse AGENTS.md, the shared .claude/LANES.md and /nuke-work. The inventory below is dated application history, not a mandate to launch agents or write task rows.\n\n');
  registry = registry.replace(/## Workflow[\s\S]*$/, '## Workflow\n\nUse the installed nuke-work skill. Preserve current scope, holds and receipts across handoffs.\n');
  files.set(registryPath, registry);
}
for (const [name, model, effort] of [
  ['nuke-luna', 'gpt-6-luna', 'low'],
  ['nuke-sol', 'gpt-6.1-sol', 'medium'],
  ['nuke-astra', 'gpt-6-astra', 'medium'],
]) {
  files.set(join(userHome, '.codex', `${name}.config.toml`), `# Explicit CLI profile; inherits the base config's permissions and connections.\nmodel = "${model}"\nmodel_reasoning_effort = "${effort}"\n`);
}
// Preflight all targets before writing; a symlink must not redirect a config write.
const changes = [...files].filter(([path, content]) => {
  if (!path.startsWith(`${userHome}/`)) throw new Error(`Target outside selected home: ${path}`);
  rejectSymlinkAncestors(path);
  return !existsSync(path) || readFileSync(path, 'utf8') !== content;
});
const backup = join(userHome, 'nuke-logs', 'agent-workspace', `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
rejectSymlinkAncestors(backup);
if (apply && changes.length) { mkdirSync(backup, { recursive: true, mode: 0o700 }); chmodSync(backup, 0o700); }
for (const [path, content] of changes) {
  if (apply) {
    if (existsSync(path)) {
      const copy = join(backup, path.slice(userHome.length + 1));
      mkdirSync(dirname(copy), { recursive: true, mode: 0o700 });
      writeFileSync(copy, readFileSync(path), { mode: 0o600 });
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  console.log(`${apply ? 'installed' : 'would install'} ${path}`);
}
console.log(`${changes.length} changed files; base config, credentials and permissions unchanged.`);
if (apply && changes.length) console.log(`Private backup: ${backup}`);
