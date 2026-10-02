#!/usr/bin/env node
/**
 * nuke-spawn — visual multi-agent spawner for the Nuke Command Center
 *
 * Queries agent_tasks, spawns claude or codex sessions into tmux panes so you can
 * watch them work. Each agent gets their CLAUDE.md persona + task description.
 *
 * Usage:
 *   dotenvx run -- node scripts/nuke-spawn.mjs                  # spawn all pending into tmux panes
 *   dotenvx run -- node scripts/nuke-spawn.mjs --agent worker   # only worker tasks
 *   dotenvx run -- node scripts/nuke-spawn.mjs --max-tasks 5    # limit to 5
 *   dotenvx run -- node scripts/nuke-spawn.mjs --list           # just show pending, don't spawn
 *   dotenvx run -- node scripts/nuke-spawn.mjs --dry-run        # claim + show, don't execute
 *   dotenvx run -- node scripts/nuke-spawn.mjs --role keys      # coordinator-assigned structural role
 *   --public-work-order attests every selected description/persona is public before Jev export
 *
 * Requires: tmux session "nuke-cc" running (start with `nuke` command).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir, homedir } from 'os';
import { randomUUID } from 'node:crypto';
import { routeTask, hashWorkOrder } from './lib/jev-route.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NUKE_DIR = join(__dirname, '..');
const AGENTS_DIR = join(NUKE_DIR, '.claude', 'agents');

// ─── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const AGENT_FILTER = arg('--agent') || arg('-a');
const DRY_RUN = flag('--dry-run');
const LIST_ONLY = flag('--list');
const MAX_TASKS = parseInt(arg('--max-tasks') || '15');
const SESSION = arg('--session') || 'nuke-cc';
const WINDOW = arg('--window') || 'agents';
const STRUCTURAL_ROLE = arg('--role');
const ROLES = new Set(['cartographer', 'keys', 'time', 'features-cohorts', 'prediction', 'prospector']);
const CLAIM_OWNER = `nuke-spawn-${randomUUID()}`;

const taskSnapshot = (task) => Object.fromEntries(
  ['id', 'title', 'description', 'agent_type', 'priority'].map(key => [key, task[key] ?? null])
);

// ─── Model routing (mirrors ralph-spawn.mjs) ──────────────────────────────

const MODEL_MAP = {
  worker: 'haiku',
  'vp-extraction': 'haiku',
  'vp-orgs': 'haiku',
  'vp-docs': 'haiku',
  'vp-photos': 'haiku',
  'vp-ai': 'sonnet',
  'vp-platform': 'sonnet',
  'vp-vehicle-intel': 'sonnet',
  'vp-deal-flow': 'sonnet',
  cto: 'opus',
  coo: 'opus',
  cfo: 'opus',
  cpo: 'opus',
  cdo: 'opus',
  cwtfo: 'opus',
};

function getModel(agentType) {
  return MODEL_MAP[agentType] || 'sonnet';
}

// Organizational agent_type and structural role are separate. The coordinator
// assigns the role; a missing role requires review rather than a guessed lane.
export function buildTaskPrompt(task, role, persona = '') {
  return [
    persona,
    `ASSIGNED TASK (ID: ${task.id})`,
    `STRUCTURAL ROLE: ${role}`,
    `Title: ${task.title}`,
    task.description ? `\nDescription:\n${task.description}` : '',
    '\nRead AGENTS.md and docs/ledger/theory/data-machine.md plus data-machine-cases.md before working.',
    'Preserve the complete user intent. Map the affected layer, entities, row grain, keys, source, clocks and canonical writer. Use the live atlas before database work.',
    'For computed outputs, show keys, database descriptions, owner, maintenance writer/cadence, executable assay and consumer. Missing operating edges mean partial, not complete. Verify replay and point-in-time correctness where applicable.',
    '\nExecute this task completely. When finished:',
    `1. Confirm acceptance with measured evidence before marking completed. UPDATE agent_tasks SET status='completed', completed_at=NOW(), result='{"summary":"what you did"}'::jsonb WHERE id='${task.id}' AND status='in_progress' AND claimed_by='${CLAIM_OWNER}'; Confirm the update affected your claimed task.`,
    '2. Use claude-log-done and claude-handoff for serialized completion and handoff records.',
    '3. Remove only your own file from .claude/agents/active/.',
  ].filter(Boolean).join('\n');
}

// --static is an explicit operator override, never an automatic error fallback.
export async function routeModel(task, { role = task.structural_role, persona = '', publicWorkOrder = false, staticRoute = false, route = routeTask } = {}) {
  const fallback = getModel(task.agent_type);
  if (!ROLES.has(role)) {
    return { runner: null, model: null, routing: { status: 'needs_review', source: 'policy', reason: 'coordinator must assign a valid structural role' } };
  }
  const taskPrompt = buildTaskPrompt(task, role, persona);
  const workOrder = { title: task.title, description: taskPrompt, role, requirements: { databaseAccess: true, taskId: task.id, taskSnapshot: taskSnapshot(task) }, completionInstructions: '', persona: '', publicWorkOrder };
  if (!staticRoute && publicWorkOrder !== true) {
    return { runner: null, model: null, routing: { status: 'needs_review', source: 'policy', reason: 'public work order attestation required before external routing', taskHash: hashWorkOrder(workOrder), decidedAt: new Date().toISOString() }, taskPrompt, workOrder };
  }
  const r = staticRoute
    ? { status: 'ready', runner: 'claude', model: fallback, modelArg: fallback, source: 'explicit-static', confidence: null, reason: 'operator selected organizational model map', taskHash: hashWorkOrder(workOrder), decidedAt: new Date().toISOString() }
    : await route({ ...workOrder, fallback });
  // Completion itself requires the database. This caller cannot use the bounded
  // Codex route under the router's existing access policy, even if Jev misses it.
  const routing = r.runner === 'codex'
    ? { ...r, status: 'needs_review', runner: null, model: null, modelArg: null, reason: 'task completion requires database access; selected runner is ineligible under current policy' }
    : r;
  return { runner: routing.runner, model: routing.modelArg, routing, taskPrompt, workOrder };
}

export function canDispatch(task) {
  try {
    return typeof task.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.id) &&
      task.routing?.status === 'ready' && task.runner === 'claude' &&
      task.id === task.workOrder?.requirements?.taskId &&
      JSON.stringify(taskSnapshot(task)) === JSON.stringify(task.workOrder.requirements.taskSnapshot) &&
      task.runner === task.routing.runner && task.model === task.routing.modelArg &&
      typeof task.model === 'string' && /^[a-zA-Z0-9._-]+$/.test(task.model) &&
      task.workOrder?.description === task.taskPrompt &&
      task.routing.taskHash === hashWorkOrder(task.workOrder);
  } catch {
    return false;
  }
}

export async function dispatchTask(task, { claim, spawn, release, dryRun = false }) {
  const claimedId = task.id;
  const held = () => ({ status: 'held', reason: task.routing?.status === 'ready' ? 'work order or configuration changed after routing' : task.routing?.reason || 'routing review required' });
  if (!canDispatch(task)) return held();
  const expectedTask = structuredClone(task.workOrder.requirements.taskSnapshot);
  if (!await claim(claimedId, expectedTask)) return { status: 'skip' };
  // A claim is asynchronous. Recheck before execution and release if changed.
  if (!canDispatch(task)) {
    await release(claimedId);
    return held();
  }
  if (dryRun) {
    await release(claimedId);
    return { status: 'dry-run' };
  }
  try {
    if (await spawn(task)) return { status: 'spawned' };
  } catch (error) {
    await release(claimedId);
    throw error;
  }
  await release(claimedId);
  return { status: 'failed' };
}

// ─── Terminal colors ─────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m',
};

// ─── Supabase ────────────────────────────────────────────────────────────

let supabase;

// ─── DB helpers ──────────────────────────────────────────────────────────

async function fetchPendingTasks() {
  let q = supabase
    .from('agent_tasks')
    .select('id, agent_type, priority, title, description')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .limit(MAX_TASKS);
  if (AGENT_FILTER) q = q.eq('agent_type', AGENT_FILTER);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to fetch tasks: ${error.message}`);
  return data || [];
}

export async function claimTask(taskId, expectedTask, { client = supabase, owner = CLAIM_OWNER } = {}) {
  if (expectedTask?.id !== taskId) throw new Error('Claim requires the routed task snapshot');
  let request = client
    .from('agent_tasks')
    .update({
      status: 'in_progress',
      claimed_by: owner,
      claimed_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', 'pending');
  // Refuse a persisted edit between routing and claim, including nullable fields.
  for (const key of ['title', 'description', 'agent_type', 'priority']) {
    request = expectedTask[key] === null ? request.is(key, null) : request.eq(key, expectedTask[key]);
  }
  const { data, error } = await request.select('id');
  if (error) throw new Error(`Failed to claim task: ${error.message}`);
  return data?.length > 0;
}

export async function releaseTask(taskId, { client = supabase, owner = CLAIM_OWNER } = {}) {
  const { data, error } = await client.from('agent_tasks').update({ status: 'pending', claimed_by: null, claimed_at: null, started_at: null })
    .eq('id', taskId).eq('status', 'in_progress').eq('claimed_by', owner).select('id');
  if (error) throw new Error(`Failed to release task: ${error.message}`);
  if (!data?.length) throw new Error('Failed to release task: claim no longer belongs to this launcher');
}

// ─── tmux helpers ────────────────────────────────────────────────────────

function tmuxSessionExists() {
  try {
    execFileSync('tmux', ['has-session', '-t', SESSION], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function spawnPane(task, { execute = execFileSync, write = writeFileSync, temporaryDirectory = tmpdir() } = {}) {
  if (!canDispatch(task)) return false;
  const { id, agent_type, title } = task;
  const model = task.model || getModel(agent_type);

  // Write prompt to temp file (avoids shell escaping issues)
  const promptFile = join(temporaryDirectory, `nuke-agent-${id}.txt`);
  write(promptFile, task.taskPrompt);

  // Truncate title for pane label
  const shortTitle = title.length > 45 ? title.slice(0, 42) + '...' : title;

  // Create pane and run agent
  const target = `${SESSION}:${WINDOW}`;

  try {
    const worktree = join(homedir(), '.worktrees', `nuke-task-${id}`);
    const revision = execute('git', ['rev-parse', 'HEAD'], { cwd: NUKE_DIR }).toString().trim();
    // Preserve failed or unfinished task checkouts; never reset or reuse them.
    execute('git', ['worktree', 'add', '-b', `agent/task-${id}`, worktree, revision], { cwd: NUKE_DIR });
    write(join(temporaryDirectory, `nuke-agent-${id}.route.json`), JSON.stringify({ taskId: id, role: task.workOrder.role, revision, worktree, routing: task.routing }, null, 2));
    // Capture this pane directly; the active pane may change in another session.
    const paneId = execute('tmux', ['split-window', '-P', '-F', '#{pane_id}', '-t', target, '-c', worktree]).toString().trim();
    execute('tmux', ['select-layout', '-t', target, 'tiled']);

    // Set pane title
    execute('tmux', ['select-pane', '-t', paneId, '-T', `${agent_type}: ${shortTitle}`]);

    // Build the command — CLAUDECODE= prevents nested session detection
    const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
    const launch = `CLAUDECODE= claude -p "$(cat ${quote(promptFile)})" --model ${quote(model)}`;
    const cmd = `${launch}; echo ''; echo '━━━ AGENT COMPLETE ━━━'; rm -f '${promptFile}'; read -p 'Enter to close...'`;

    // Send it (using base64 encoding to avoid escaping issues)
    const b64 = Buffer.from(cmd).toString('base64');
    execute('tmux', ['send-keys', '-t', paneId, `eval "$(echo '${b64}' | base64 -d)"`, 'Enter']);

    return true;
  } catch (err) {
    console.error(`${C.red}Failed to spawn pane for ${agent_type}: ${err.message}${C.reset}`);
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`${C.red}Missing env vars. Run with: dotenvx run -- node scripts/nuke-spawn.mjs${C.reset}`);
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log(`\n${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`${C.bold}  nuke-spawn${C.reset}  ${C.dim}visual agent spawner${C.reset}`);
  console.log(`  session: ${C.cyan}${SESSION}${C.reset}  window: ${C.cyan}${WINDOW}${C.reset}`);
  if (AGENT_FILTER) console.log(`  filter: ${C.yellow}${AGENT_FILTER}${C.reset}`);
  console.log(`${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);

  // Check tmux session
  if (!LIST_ONLY && !DRY_RUN && !tmuxSessionExists()) {
    console.error(`${C.red}tmux session "${SESSION}" not found. Run 'nuke' first.${C.reset}`);
    process.exit(1);
  }

  const tasks = await fetchPendingTasks();

  if (tasks.length === 0) {
    console.log(`${C.dim}No pending tasks. Queue is empty.${C.reset}\n`);
    return;
  }

  console.log(`${C.bold}${tasks.length} pending tasks:${C.reset}`);
  for (const t of tasks) {
    const personaFile = join(AGENTS_DIR, t.agent_type, 'CLAUDE.md');
    const hasPersona = existsSync(personaFile);
    Object.assign(t, await routeModel(t, { role: t.structural_role || STRUCTURAL_ROLE, persona: hasPersona ? readFileSync(personaFile, 'utf8') : '', publicWorkOrder: flag('--public-work-order'), staticRoute: flag('--static') }));
    const model = t.model || 'held';
    const hint = hasPersona ? '' : ` ${C.yellow}(no persona)${C.reset}`;
    console.log(`  ${C.cyan}[${t.agent_type}]${C.reset} P${t.priority} ${C.dim}[${model}]${C.reset} ${t.title}${hint}`);
    console.log(`    ${JSON.stringify({ taskId: t.id, role: t.workOrder?.role, routing: t.routing })}`);
  }
  console.log();

  if (LIST_ONLY) return;

  // Spawn each task into a tmux pane
  let spawned = 0;
  let failed = 0;

  for (const task of tasks) {
    const result = await dispatchTask(task, { claim: claimTask, spawn: spawnPane, release: releaseTask, dryRun: DRY_RUN });
    if (result.status === 'held') {
      console.log(`  ${C.yellow}held${C.reset} [${task.agent_type}] ${task.title}: ${result.reason}`);
      continue;
    }
    if (result.status === 'skip') {
      console.log(`  ${C.yellow}skip${C.reset} [${task.agent_type}] ${task.title} (changed or already claimed)`);
      continue;
    }

    if (result.status === 'dry-run') {
      console.log(`  ${C.green}claimed${C.reset} [${task.agent_type}] ${task.title} (dry-run — no pane)`);
      spawned++;
      continue;
    }

    if (result.status === 'spawned') {
      console.log(`  ${C.green}spawned${C.reset} [${task.agent_type}] ${task.title}`);
      spawned++;
    } else {
      failed++;
    }

    // Small delay between spawns to let tmux settle
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${C.bold}${C.green}━━━ ${spawned} agents spawned${C.reset}${failed > 0 ? `  ${C.red}${failed} failed${C.reset}` : ''}`);
  console.log(`${C.dim}Switch to agents window: Ctrl-B n${C.reset}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`${C.red}fatal: ${err.message}${C.reset}`);
    process.exit(1);
  });
}
