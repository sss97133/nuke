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
 *   dotenvx run -- node scripts/ralph-spawn.mjs --max-tokens-per-agent 30000
 *   dotenvx run -- node scripts/ralph-spawn.mjs --session-budget 200000
 *   dotenvx run -- node scripts/ralph-spawn.mjs --model sonnet  (overrides all agents)
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

// --model overrides ALL agents when specified (backward-compatible)
const MODEL_OVERRIDE = arg('--model') || null;

// Per-agent token budget. If specified, overrides tier defaults for all agents.
const MAX_TOKENS_PER_AGENT_FLAG = arg('--max-tokens-per-agent');
const MAX_TOKENS_PER_AGENT = MAX_TOKENS_PER_AGENT_FLAG ? parseInt(MAX_TOKENS_PER_AGENT_FLAG) : null;

// Session-level total token cap across all agents. 0 = unlimited.
const SESSION_BUDGET = parseInt(arg('--session-budget') || '0') || 0;

// ─── Model routing ─────────────────────────────────────────────────────────

const MODEL_MAP = {
  // Extraction workers — Haiku (~$0.056/task)
  worker: 'haiku',
  'vp-extraction': 'haiku',
  'vp-orgs': 'haiku',
  'vp-docs': 'haiku',
  'vp-photos': 'haiku',
  // VP/domain leads — Sonnet (~$0.525/task)
  'vp-ai': 'sonnet',
  'vp-platform': 'sonnet',
  'vp-vehicle-intel': 'sonnet',
  'vp-deal-flow': 'sonnet',
  // Executive/strategy — Opus (~$2.25/task)
  cto: 'opus',
  coo: 'opus',
  cfo: 'opus',
  cpo: 'opus',
  cdo: 'opus',
  cwtfo: 'opus',
};

// Default token budgets by tier
const TOKEN_DEFAULTS = {
  haiku: 30000,
  sonnet: 60000,
  opus: 100000,
};

// Hard cap: never run more than 3 Opus agents simultaneously
const OPUS_CONCURRENCY_CAP = 3;

function getAgentModel(agentType) {
  if (MODEL_OVERRIDE) return MODEL_OVERRIDE;
  return MODEL_MAP[agentType] || 'sonnet';
}

function getTokenBudget(model) {
  if (MAX_TOKENS_PER_AGENT !== null) return MAX_TOKENS_PER_AGENT;
  return TOKEN_DEFAULTS[model] || TOKEN_DEFAULTS.sonnet;
}

// For display in header (when using per-agent routing)
const MODEL = MODEL_OVERRIDE || 'per-agent';

// ─── Session-level shared state ────────────────────────────────────────────

const sessionState = {
  totalTokensUsed: 0,
  activeOpusCount: 0,
};

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

async function markComplete(taskId, summary, success = true, tokenUsage = null) {
  const result = {
    ...(summary ? { summary: summary.slice(0, 4000) } : {}),
    ...(tokenUsage || {}),
  };
  await supabase
    .from('agent_tasks')
    .update({
      status: success ? 'completed' : 'failed',
      completed_at: new Date().toISOString(),
      result: Object.keys(result).length > 0 ? result : null,
      error: success ? null : summary,
    })
    .eq('id', taskId);
}

// ─── Single agent runner ───────────────────────────────────────────────────

async function runAgent(task) {
  const { id, agent_type, priority, title, description } = task;
  const sessionId = `ralph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const agentModel = getAgentModel(agent_type);
  const tokenBudget = getTokenBudget(agentModel);
  const isOpus = agentModel === 'opus';

  // ── Opus concurrency cap: wait for a slot ──
  if (isOpus) {
    while (sessionState.activeOpusCount >= OPUS_CONCURRENCY_CAP) {
      log(agent_type, `Opus cap reached (${sessionState.activeOpusCount}/${OPUS_CONCURRENCY_CAP}) — waiting 5s for slot...`, 'warn');
      await new Promise((r) => setTimeout(r, 5000));
    }
    sessionState.activeOpusCount++;
  }

  // Atomic claim
  const claimed = await claimTask(id, sessionId);
  if (!claimed) {
    if (isOpus) sessionState.activeOpusCount--;
    log(agent_type, `skipped (already claimed): ${title}`, 'warn');
    return;
  }

  log(agent_type, `${C.bold}▶ P${priority} [${agentModel}/${tokenBudget}tok]: ${title}${C.reset}`);

  if (DRY_RUN) {
    log(agent_type, `[dry-run] would execute task ${id}`, 'success');
    await supabase.from('agent_tasks').update({ status: 'pending', claimed_by: null, claimed_at: null }).eq('id', id);
    if (isOpus) sessionState.activeOpusCount--;
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
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let budgetExceeded = false;
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
        model: agentModel,
        maxTurns: 100,
        maxTokens: tokenBudget,
        env: { ...process.env, CLAUDECODE: undefined },
      },
    })) {
      if (message.type === 'assistant') {
        turns++;

        // Accumulate token usage from each assistant message
        const usage = message.message?.usage;
        if (usage) {
          totalInputTokens += usage.input_tokens || 0;
          totalOutputTokens += usage.output_tokens || 0;
        }

        // Per-agent token budget check
        const totalSoFar = totalInputTokens + totalOutputTokens;
        if (totalSoFar >= tokenBudget) {
          log(agent_type, `${C.yellow}Token budget exceeded (${totalSoFar}/${tokenBudget}) — stopping agent${C.reset}`, 'warn');
          budgetExceeded = true;
          break;
        }

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

    const tokensUsed = totalInputTokens + totalOutputTokens;
    sessionState.totalTokensUsed += tokensUsed;

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);

    if (budgetExceeded) {
      log(agent_type, `${C.bold}⚠ token budget hit in ${elapsed}s (${turns} turns, ${tokensUsed}/${tokenBudget} tokens)${C.reset}`, 'warn');
      await markComplete(id, 'Token budget exceeded', false, {
        tokens_used: tokensUsed,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      });
    } else {
      log(agent_type, `${C.bold}✓ done in ${elapsed}s (${turns} turns, ${tokensUsed} tokens)${C.reset}`, 'success');
      await markComplete(id, lastText, true, {
        tokens_used: tokensUsed,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      });
    }

  } catch (err) {
    const tokensUsed = totalInputTokens + totalOutputTokens;
    sessionState.totalTokensUsed += tokensUsed;
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
    log(agent_type, `✗ failed after ${elapsed}s: ${err.message}`, 'error');
    await markComplete(id, err.message, false, {
      tokens_used: tokensUsed,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    });
  } finally {
    if (isOpus) sessionState.activeOpusCount--;
  }
}

// ─── Concurrency pool ──────────────────────────────────────────────────────

async function runPool(tasks, concurrency) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (queue.length > 0) {
      // Session budget check: stop pulling tasks if total spend exceeded
      if (SESSION_BUDGET > 0 && sessionState.totalTokensUsed >= SESSION_BUDGET) {
        const remaining = queue.length;
        if (remaining > 0) {
          log('ralph-spawn', `Session budget reached (${sessionState.totalTokensUsed}/${SESSION_BUDGET} tokens used). ${remaining} task(s) remain pending in DB.`, 'warn');
          queue.length = 0; // drain local queue; DB tasks stay pending
        }
        break;
      }

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
  if (MAX_TOKENS_PER_AGENT !== null) console.log(`  max-tokens-per-agent: ${C.cyan}${MAX_TOKENS_PER_AGENT}${C.reset} ${C.dim}(overrides tier defaults)${C.reset}`);
  if (SESSION_BUDGET > 0) console.log(`  session-budget: ${C.cyan}${SESSION_BUDGET}${C.reset} tokens total`);
  if (!MODEL_OVERRIDE) console.log(`  routing: ${C.dim}haiku→workers, sonnet→VPs, opus→C-suite (cap: ${OPUS_CONCURRENCY_CAP} opus concurrent)${C.reset}`);
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
    const model = getAgentModel(t.agent_type);
    const budget = getTokenBudget(model);
    console.log(`  ${color}[${t.agent_type}]${C.reset} P${t.priority}  ${C.dim}[${model}/${budget}tok]${C.reset}  ${t.title}${hint}`);
  }
  console.log();

  if (LIST_ONLY) return;

  await runPool(tasks, CONCURRENCY);

  const totalUsed = sessionState.totalTokensUsed;
  console.log(`\n${C.bold}${C.green}━━━ all done ━━━${C.reset}  ${C.dim}total tokens used: ${totalUsed}${SESSION_BUDGET > 0 ? ` / ${SESSION_BUDGET}` : ''}${C.reset}\n`);
}

main().catch((err) => {
  console.error(`${C.red}fatal: ${err.message}${C.reset}`);
  process.exit(1);
});
