#!/usr/bin/env node
/**
 * ralph-spawn — multi-agent parallel task executor
 *
 * Queries agent_tasks, spawns claude sessions in parallel.
 * Each agent gets their CLAUDE.md persona + task description.
 * Runs N agents concurrently, marks tasks complete when done.
 *
 * Usage:
 *   dotenvx run -- node scripts/ralph-spawn.mjs
 *   dotenvx run -- node scripts/ralph-spawn.mjs --concurrency 8
 *   dotenvx run -- node scripts/ralph-spawn.mjs --agent vp-extraction
 *   dotenvx run -- node scripts/ralph-spawn.mjs --dry-run
 *   dotenvx run -- node scripts/ralph-spawn.mjs --list
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NUKE_DIR = join(__dirname, '..');
const AGENTS_DIR = join(NUKE_DIR, '.claude', 'agents');

// ─── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const CONCURRENCY = parseInt(arg('--concurrency') || arg('-c') || '5');
const AGENT_FILTER = arg('--agent') || arg('-a');
const DRY_RUN = flag('--dry-run');
const LIST_ONLY = flag('--list');
const MAX_TASKS = parseInt(arg('--max-tasks') || '30');
const MODEL = arg('--model') || 'sonnet';

// ─── Supabase ──────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Terminal colors ───────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m', white: '\x1b[37m',
};

const PALETTE = ['cyan', 'magenta', 'blue', 'yellow', 'green', 'white'];
const colorMap = {};
let colorIdx = 0;
const agentColor = (type) => {
  if (!colorMap[type]) colorMap[type] = PALETTE[colorIdx++ % PALETTE.length];
  return C[colorMap[type]];
};

const ts = () => new Date().toLocaleTimeString('en-US', { hour12: false });

function log(agentType, msg, level = 'info') {
  const color = level === 'error' ? C.red : level === 'success' ? C.green : level === 'warn' ? C.yellow : agentColor(agentType);
  const prefix = `${C.dim}${ts()}${C.reset} ${color}[${agentType}]${C.reset}`;
  console.log(`${prefix} ${msg}`);
}

// ─── Agent persona loader ──────────────────────────────────────────────────

function loadAgentPersona(agentType) {
  const path = join(AGENTS_DIR, agentType, 'CLAUDE.md');
  if (existsSync(path)) return readFileSync(path, 'utf8');
  // Fall back to worker persona
  const workerPath = join(AGENTS_DIR, 'worker', 'CLAUDE.md');
  if (existsSync(workerPath)) return readFileSync(workerPath, 'utf8');
  return `You are a ${agentType} agent. Execute the assigned task completely and autonomously.`;
}

// ─── DB helpers ────────────────────────────────────────────────────────────

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

async function claimTask(taskId, sessionId) {
  // Atomic claim: only succeeds if still pending
  const { data, error } = await supabase
    .from('agent_tasks')
    .update({
      status: 'claimed',
      claimed_by: sessionId,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', 'pending')
    .select('id');
  return !error && data?.length > 0;
}

async function markInProgress(taskId) {
  await supabase
    .from('agent_tasks')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', taskId);
}

async function markComplete(taskId, summary, success = true) {
  await supabase
    .from('agent_tasks')
    .update({
      status: success ? 'completed' : 'failed',
      completed_at: new Date().toISOString(),
      result: summary ? { summary: summary.slice(0, 4000) } : null,
      error: success ? null : summary,
    })
    .eq('id', taskId);
}

// ─── Single agent runner ───────────────────────────────────────────────────

async function runAgent(task) {
  const { id, agent_type, priority, title, description } = task;
  const sessionId = `ralph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Atomic claim
  const claimed = await claimTask(id, sessionId);
  if (!claimed) {
    log(agent_type, `skipped (already claimed): ${title}`, 'warn');
    return;
  }

  log(agent_type, `${C.bold}▶ P${priority}: ${title}${C.reset}`);

  if (DRY_RUN) {
    log(agent_type, `[dry-run] would execute task ${id}`, 'success');
    await supabase.from('agent_tasks').update({ status: 'pending', claimed_by: null, claimed_at: null }).eq('id', id);
    return;
  }

  await markInProgress(id);

  const persona = loadAgentPersona(agent_type);

  // Build the task prompt — agent already has full context from persona
  const taskPrompt = [
    `ASSIGNED TASK (ID: ${id})`,
    `Priority: ${priority}`,
    `Title: ${title}`,
    description ? `\nDescription:\n${description}` : '',
    `\nExecute this task completely. When finished, mark it done in the DB:`,
    `UPDATE agent_tasks SET status='completed', completed_at=NOW(), result='{"summary":"brief description of what you did"}'::jsonb WHERE id='${id}';`,
    `Also append to DONE.md and remove yourself from ACTIVE_AGENTS.md when done.`,
  ].filter(Boolean).join('\n');

  let lastText = '';
  let turns = 0;
  const startMs = Date.now();

  try {
    for await (const message of query({
      prompt: taskPrompt,
      options: {
        cwd: NUKE_DIR,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: persona,
        },
        tools: { type: 'preset', preset: 'claude_code' },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['project', 'user'],
        model: MODEL,
        maxTurns: 100,
        env: { ...process.env, CLAUDECODE: undefined },
      },
    })) {
      if (message.type === 'assistant') {
        turns++;
        const blocks = message.message?.content || [];
        for (const block of blocks) {
          if (block.type === 'text' && block.text?.trim()) {
            const preview = block.text.slice(0, 100).replace(/\n+/g, ' ').trim();
            log(agent_type, `  ${C.dim}${preview}${C.reset}`);
            lastText = block.text;
          }
        }
      } else if (message.type === 'result') {
        lastText = typeof message.result === 'string' ? message.result : JSON.stringify(message.result);
      }
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
    log(agent_type, `${C.bold}✓ done in ${elapsed}s (${turns} turns)${C.reset}`, 'success');
    await markComplete(id, lastText, true);

  } catch (err) {
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
    log(agent_type, `✗ failed after ${elapsed}s: ${err.message}`, 'error');
    await markComplete(id, err.message, false);
  }
}

// ─── Concurrency pool ──────────────────────────────────────────────────────

async function runPool(tasks, concurrency) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) await runAgent(task);
    }
  });
  await Promise.all(workers);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`${C.red}Missing env vars. Run with: dotenvx run -- node scripts/ralph-spawn.mjs${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`${C.bold}  ralph-spawn${C.reset}  ${C.dim}multi-agent executor${C.reset}`);
  console.log(`  concurrency: ${C.cyan}${CONCURRENCY}${C.reset}  model: ${C.cyan}${MODEL}${C.reset}  dry-run: ${DRY_RUN ? C.yellow + 'yes' : C.dim + 'no'}${C.reset}`);
  if (AGENT_FILTER) console.log(`  agent filter: ${C.yellow}${AGENT_FILTER}${C.reset}`);
  console.log(`${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);

  const tasks = await fetchPendingTasks();

  if (tasks.length === 0) {
    console.log(`${C.dim}No pending tasks. Queue is empty.${C.reset}\n`);
    return;
  }

  console.log(`${C.bold}${tasks.length} pending tasks:${C.reset}`);
  for (const t of tasks) {
    const color = agentColor(t.agent_type);
    const hasPersona = existsSync(join(AGENTS_DIR, t.agent_type, 'CLAUDE.md'));
    const hint = hasPersona ? '' : ` ${C.yellow}(no persona — using worker)${C.reset}`;
    console.log(`  ${color}[${t.agent_type}]${C.reset} P${t.priority}  ${t.title}${hint}`);
  }
  console.log();

  if (LIST_ONLY) return;

  await runPool(tasks, CONCURRENCY);

  console.log(`\n${C.bold}${C.green}━━━ all done ━━━${C.reset}\n`);
}

main().catch((err) => {
  console.error(`${C.red}fatal: ${err.message}${C.reset}`);
  process.exit(1);
});
