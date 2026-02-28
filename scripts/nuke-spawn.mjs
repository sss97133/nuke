#!/usr/bin/env node
/**
 * nuke-spawn — visual multi-agent spawner for the Nuke Command Center
 *
 * Queries agent_tasks, spawns claude sessions into tmux panes so you can
 * watch them work. Each agent gets their CLAUDE.md persona + task description.
 *
 * Usage:
 *   dotenvx run -- node scripts/nuke-spawn.mjs                  # spawn all pending into tmux panes
 *   dotenvx run -- node scripts/nuke-spawn.mjs --agent worker   # only worker tasks
 *   dotenvx run -- node scripts/nuke-spawn.mjs --max-tasks 5    # limit to 5
 *   dotenvx run -- node scripts/nuke-spawn.mjs --list           # just show pending, don't spawn
 *   dotenvx run -- node scripts/nuke-spawn.mjs --dry-run        # claim + show, don't execute
 *
 * Requires: tmux session "nuke-cc" running (start with `nuke` command).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

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

// ─── Terminal colors ─────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m',
};

// ─── Supabase ────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

async function claimTask(taskId) {
  const sessionId = `nuke-spawn-${Date.now()}`;
  const { data, error } = await supabase
    .from('agent_tasks')
    .update({
      status: 'in_progress',
      claimed_by: sessionId,
      claimed_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', 'pending')
    .select('id');
  return !error && data?.length > 0;
}

// ─── tmux helpers ────────────────────────────────────────────────────────

function tmuxSessionExists() {
  try {
    execSync(`tmux has-session -t "${SESSION}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

function spawnPane(task) {
  const { id, agent_type, title, description } = task;
  const model = getModel(agent_type);

  // Write prompt to temp file (avoids shell escaping issues)
  const promptFile = join(tmpdir(), `nuke-agent-${id}.txt`);
  const taskPrompt = [
    `ASSIGNED TASK (ID: ${id})`,
    `Title: ${title}`,
    description ? `\nDescription:\n${description}` : '',
    `\nExecute this task completely. When finished:`,
    `1. UPDATE agent_tasks SET status='completed', completed_at=NOW(), result='{"summary":"what you did"}'::jsonb WHERE id='${id}';`,
    `2. Append to DONE.md`,
    `3. Remove yourself from ACTIVE_AGENTS.md`,
  ].filter(Boolean).join('\n');
  writeFileSync(promptFile, taskPrompt);

  // Build persona flag
  const personaFile = join(AGENTS_DIR, agent_type, 'CLAUDE.md');
  const hasPersona = existsSync(personaFile);
  const personaFlag = hasPersona
    ? `--append-system-prompt "$(cat '${personaFile}')"`
    : '';

  // Truncate title for pane label
  const shortTitle = title.length > 45 ? title.slice(0, 42) + '...' : title;

  // Create pane and run agent
  const target = `${SESSION}:${WINDOW}`;

  try {
    execSync(`tmux split-window -t "${target}" -c "${NUKE_DIR}"`);
    execSync(`tmux select-layout -t "${target}" tiled`);

    // Get the newly created pane
    const paneId = execSync(`tmux display-message -t "${target}" -p '#{pane_id}'`)
      .toString().trim();

    // Set pane title
    execSync(`tmux select-pane -t "${paneId}" -T "${agent_type}: ${shortTitle}"`);

    // Build the command — CLAUDECODE= prevents nested session detection
    const cmd = `CLAUDECODE= claude -p "$(cat '${promptFile}')" --model ${model} ${personaFlag}; echo ''; echo '━━━ AGENT COMPLETE ━━━'; rm -f '${promptFile}'; read -p 'Enter to close...'`;

    // Send it (using base64 encoding to avoid escaping issues)
    const b64 = Buffer.from(cmd).toString('base64');
    execSync(`tmux send-keys -t "${paneId}" "eval \\\"\\$(echo '${b64}' | base64 -d)\\\"" Enter`);

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
    const model = getModel(t.agent_type);
    const hasPersona = existsSync(join(AGENTS_DIR, t.agent_type, 'CLAUDE.md'));
    const hint = hasPersona ? '' : ` ${C.yellow}(no persona)${C.reset}`;
    console.log(`  ${C.cyan}[${t.agent_type}]${C.reset} P${t.priority} ${C.dim}[${model}]${C.reset} ${t.title}${hint}`);
  }
  console.log();

  if (LIST_ONLY) return;

  // Spawn each task into a tmux pane
  let spawned = 0;
  let failed = 0;

  for (const task of tasks) {
    const claimed = await claimTask(task.id);
    if (!claimed) {
      console.log(`  ${C.yellow}skip${C.reset} [${task.agent_type}] ${task.title} (already claimed)`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ${C.green}claimed${C.reset} [${task.agent_type}] ${task.title} (dry-run — no pane)`);
      // Unclaim
      await supabase.from('agent_tasks').update({ status: 'pending', claimed_by: null, claimed_at: null, started_at: null }).eq('id', task.id);
      spawned++;
      continue;
    }

    const ok = spawnPane(task);
    if (ok) {
      console.log(`  ${C.green}spawned${C.reset} [${task.agent_type}] ${task.title}`);
      spawned++;
    } else {
      // Unclaim on failure
      await supabase.from('agent_tasks').update({ status: 'pending', claimed_by: null, claimed_at: null, started_at: null }).eq('id', task.id);
      failed++;
    }

    // Small delay between spawns to let tmux settle
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${C.bold}${C.green}━━━ ${spawned} agents spawned${C.reset}${failed > 0 ? `  ${C.red}${failed} failed${C.reset}` : ''}`);
  console.log(`${C.dim}Switch to agents window: Ctrl-B n${C.reset}\n`);
}

main().catch((err) => {
  console.error(`${C.red}fatal: ${err.message}${C.reset}`);
  process.exit(1);
});
