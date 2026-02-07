#!/usr/bin/env npx tsx
/**
 * Persona Bot Orchestrator
 * Loads real commenter personalities from author_personas and runs them
 * as Claude-driven Playwright agents against the site.
 *
 * Usage:
 *   npx tsx tests/bots/run-persona-bots.ts                          # Top 5 personas by comment count
 *   npx tsx tests/bots/run-persona-bots.ts --count 10               # Top 10
 *   npx tsx tests/bots/run-persona-bots.ts --type critic            # Only critics
 *   npx tsx tests/bots/run-persona-bots.ts --username gstroe        # Specific user
 *   npx tsx tests/bots/run-persona-bots.ts --url http://localhost:5173
 *   npx tsx tests/bots/run-persona-bots.ts --headless false         # Show browser
 *   npx tsx tests/bots/run-persona-bots.ts --max-actions 20         # More actions per persona
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PersonaBot } from './personas/PersonaBot';
import { personaRowToBotPersona } from './lib/personaPrompt';
import type { AuthorPersonaRow, BotTestRun } from './types';

// ─── CLI Args ───────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : undefined;
};

const count = parseInt(getArg('count') || '5', 10);
const personaType = getArg('type');
const username = getArg('username');
const baseUrl = getArg('url') || process.env.BOT_BASE_URL || 'https://n-zero.dev';
const headless = getArg('headless') !== 'false';
const maxActions = parseInt(getArg('max-actions') || '15', 10);

// ─── Supabase ───────────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Load Personas ──────────────────────────────────────────

// ─── Synthetic persona factory ──────────────────────────────

const SYNTHETIC_PERSONAS: Record<string, AuthorPersonaRow> = {
  platform_owner: {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'skylar',
    platform: 'nuke',
    primary_persona: 'platform_owner',
    avg_tone_helpful: 0.3,
    avg_tone_technical: 0.8,
    avg_tone_friendly: 0.4,
    avg_tone_confident: 0.9,
    avg_tone_snarky: 0.3,
    expertise_level: 'professional',
    expertise_areas: ['data_pipelines', 'web_scraping', 'collector_cars', 'systems_architecture'],
    total_comments: 999,
    comments_with_questions: 100,
    comments_with_answers: 50,
    comments_with_advice: 200,
    comments_supportive: 30,
    comments_critical: 300,
    avg_comment_length: 40, // terse
    first_seen: '2024-01-01',
    last_seen: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  dev: {
    id: '00000000-0000-0000-0000-000000000002',
    username: 'dev_sim',
    platform: 'nuke',
    primary_persona: 'dev',
    avg_tone_helpful: 0.5,
    avg_tone_technical: 0.95,
    avg_tone_friendly: 0.3,
    avg_tone_confident: 0.7,
    avg_tone_snarky: 0.1,
    expertise_level: 'professional',
    expertise_areas: ['react', 'typescript', 'playwright', 'supabase', 'performance'],
    total_comments: 0,
    comments_with_questions: 0,
    comments_with_answers: 0,
    comments_with_advice: 0,
    comments_supportive: 0,
    comments_critical: 0,
    avg_comment_length: 0,
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
};

async function loadPersonas(): Promise<AuthorPersonaRow[]> {
  // Synthetic persona types don't come from DB
  if (personaType && SYNTHETIC_PERSONAS[personaType]) {
    return [SYNTHETIC_PERSONAS[personaType]];
  }

  // Try author_personas first
  let query = supabase
    .from('author_personas')
    .select('*')
    .order('total_comments', { ascending: false });

  if (username) {
    query = query.eq('username', username);
  } else if (personaType) {
    query = query.eq('primary_persona', personaType);
  }

  query = query.limit(count);

  const { data, error } = await query;

  if (error) {
    console.error('Error loading author_personas:', error.message);
  }

  if (data && data.length > 0) {
    return data;
  }

  // Fallback: aggregate directly from comment_persona_signals
  console.log('   author_personas is empty, aggregating from comment_persona_signals...');
  return await aggregateFromSignals();
}

/**
 * Fallback: build persona rows directly from comment_persona_signals
 */
async function aggregateFromSignals(): Promise<AuthorPersonaRow[]> {
  const typeFilter = personaType
    ? `AND (
        CASE
          WHEN AVG(tone_technical) > 0.6 THEN 'helpful_expert'
          WHEN AVG(tone_snarky) > 0.5 THEN 'critic'
          ELSE 'casual_enthusiast'
        END
      ) = '${personaType}'`
    : '';

  const usernameFilter = username
    ? `AND author_username = '${username}'`
    : '';

  const { data, error } = await supabase.rpc('execute_sql', {
    sql: `
      SELECT
        gen_random_uuid() as id,
        author_username as username,
        platform,
        CASE
          WHEN AVG(tone_technical) > 0.6 AND mode() WITHIN GROUP (ORDER BY expertise_level) IN ('expert','professional')
            THEN 'helpful_expert'
          WHEN mode() WITHIN GROUP (ORDER BY intent) = 'buying' AND bool_or(is_serious_buyer)
            THEN 'serious_buyer'
          WHEN AVG(tone_snarky) > 0.5
            THEN 'critic'
          ELSE 'casual_enthusiast'
        END as primary_persona,
        AVG(tone_helpful)::decimal(3,2) as avg_tone_helpful,
        AVG(tone_technical)::decimal(3,2) as avg_tone_technical,
        AVG(tone_friendly)::decimal(3,2) as avg_tone_friendly,
        AVG(tone_confident)::decimal(3,2) as avg_tone_confident,
        AVG(tone_snarky)::decimal(3,2) as avg_tone_snarky,
        mode() WITHIN GROUP (ORDER BY expertise_level) as expertise_level,
        COUNT(*)::int as total_comments,
        COUNT(*) FILTER (WHERE asks_questions)::int as comments_with_questions,
        COUNT(*) FILTER (WHERE answers_questions)::int as comments_with_answers,
        COUNT(*) FILTER (WHERE gives_advice)::int as comments_with_advice,
        COUNT(*) FILTER (WHERE supports_others)::int as comments_supportive,
        COUNT(*) FILTER (WHERE critiques_others)::int as comments_critical,
        AVG(comment_length)::int as avg_comment_length,
        MIN(extracted_at) as first_seen,
        MAX(extracted_at) as last_seen,
        now() as updated_at
      FROM comment_persona_signals
      WHERE author_username IS NOT NULL
        ${usernameFilter}
        ${typeFilter}
      GROUP BY author_username, platform
      ORDER BY COUNT(*) DESC
      LIMIT ${count}
    `,
  });

  if (error) {
    console.error('Fallback aggregation failed:', error.message);
    return [];
  }

  return (data as AuthorPersonaRow[]) || [];
}

// ─── Run a single persona bot ───────────────────────────────

/**
 * Ensure a bot_personas row exists for this author persona
 * so FK constraints on bot_test_runs and bot_findings are satisfied.
 */
async function ensureBotPersonaRow(botPersona: ReturnType<typeof personaRowToBotPersona>): Promise<string> {
  // Upsert by slug
  const { data, error } = await supabase
    .from('bot_personas')
    .upsert(
      {
        id: botPersona.id,
        slug: botPersona.slug,
        name: botPersona.name,
        description: botPersona.description,
        behavior_profile: botPersona.behavior_profile,
        goals: botPersona.goals,
        patience_level: botPersona.patience_level,
        tech_savviness: botPersona.tech_savviness,
        is_active: true,
      },
      { onConflict: 'slug' },
    )
    .select('id')
    .single();

  if (error) {
    // If upsert failed (e.g. id conflict), try fetching existing
    const { data: existing } = await supabase
      .from('bot_personas')
      .select('id')
      .eq('slug', botPersona.slug)
      .single();
    if (existing) return existing.id;
    throw new Error(`Failed to upsert bot_persona for ${botPersona.slug}: ${error.message}`);
  }

  return data.id;
}

async function runPersonaBot(row: AuthorPersonaRow): Promise<BotTestRun | null> {
  // Convert to BotPersona for the runner
  const botPersona = personaRowToBotPersona(row);

  // Ensure FK target exists in bot_personas
  const personaId = await ensureBotPersonaRow(botPersona);
  botPersona.id = personaId;

  // Create and run the bot
  const bot = new PersonaBot(botPersona, row, {
    maxActions,
  });

  try {
    await bot.execute();
    return await bot.complete();
  } catch (error) {
    console.error(`Bot ${row.username} crashed:`, error);
    return null;
  }
}

// ─── Cross-persona report ───────────────────────────────────

interface FindingRow {
  title: string;
  severity: string;
  finding_type: string;
  page_url: string;
  description: string;
  persona_id: string;
}

async function generateCrossPersonaReport(
  runs: (BotTestRun | null)[],
  personas: AuthorPersonaRow[],
): Promise<void> {
  const successfulRuns = runs.filter((r): r is BotTestRun => r !== null);

  console.log('\n' + '═'.repeat(70));
  console.log('  PERSONA-DRIVEN SITE TEST REPORT');
  console.log('═'.repeat(70));

  // Per-persona summary
  for (let i = 0; i < successfulRuns.length; i++) {
    const run = successfulRuns[i];
    const persona = personas[i];
    if (!persona) continue;

    console.log(`\n  ${persona.username} (${persona.primary_persona})`);
    console.log(`  ${'─'.repeat(40)}`);
    console.log(`  Pages: ${run.pages_visited} | Actions: ${run.actions_performed} | Findings: ${run.bugs_found}`);
  }

  // Fetch all recent findings grouped by severity
  const { data: findings } = await supabase
    .from('bot_findings')
    .select('title, severity, finding_type, page_url, description, persona_id')
    .in('test_run_id', successfulRuns.map(r => r.id))
    .order('severity', { ascending: true });

  if (findings && findings.length > 0) {
    const typedFindings = findings as FindingRow[];

    // Group by severity
    const bySeverity: Record<string, FindingRow[]> = {};
    for (const f of typedFindings) {
      if (!bySeverity[f.severity]) bySeverity[f.severity] = [];
      bySeverity[f.severity].push(f);
    }

    console.log(`\n  ${'─'.repeat(70)}`);
    console.log('  FINDINGS BY SEVERITY\n');

    for (const severity of ['critical', 'high', 'medium', 'low', 'info']) {
      const group = bySeverity[severity];
      if (!group?.length) continue;

      const icon = severity === 'critical' ? '!!!' : severity === 'high' ? ' ! ' : '   ';
      console.log(`  ${icon} ${severity.toUpperCase()} (${group.length}):`);
      for (const f of group) {
        console.log(`      - ${f.title}`);
        if (f.page_url) console.log(`        URL: ${f.page_url}`);
      }
      console.log('');
    }

    // Issues flagged by multiple persona types
    const titleCounts: Record<string, Set<string>> = {};
    for (const f of typedFindings) {
      const key = f.title.substring(0, 60);
      if (!titleCounts[key]) titleCounts[key] = new Set();
      titleCounts[key].add(f.persona_id);
    }

    const multiPersonaIssues = Object.entries(titleCounts).filter(([, v]) => v.size > 1);
    if (multiPersonaIssues.length > 0) {
      console.log(`  CROSS-PERSONA ISSUES (flagged by ${multiPersonaIssues.length > 1 ? 'multiple types' : '2+ personas'}):`);
      for (const [title, personaIds] of multiPersonaIssues) {
        console.log(`      - ${title} (${personaIds.size} personas)`);
      }
      console.log('');
    }
  } else {
    console.log('\n  No findings recorded.\n');
  }

  console.log('═'.repeat(70));
  console.log('  View full results: SELECT * FROM bot_findings ORDER BY created_at DESC');
  console.log('═'.repeat(70) + '\n');
}

// ─── Main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('  Persona-Driven Site Testing');
  console.log('  ' + '─'.repeat(50));
  console.log(`  Target:      ${baseUrl}`);
  console.log(`  Headless:    ${headless}`);
  console.log(`  Count:       ${count}`);
  console.log(`  Max actions: ${maxActions}`);
  if (personaType) console.log(`  Type filter: ${personaType}`);
  if (username) console.log(`  Username:    ${username}`);
  console.log('  ' + '─'.repeat(50) + '\n');

  // Set base URL for bots
  process.env.BOT_BASE_URL = baseUrl;
  process.env.BOT_HEADLESS = headless ? 'true' : 'false';

  // Load personas
  const personas = await loadPersonas();

  if (personas.length === 0) {
    console.error('  No personas found. Run the persona assembly line first:');
    console.error('  scripts/persona-assembly-line.sh');
    console.error('  Then: SELECT aggregate_author_personas();');
    process.exit(1);
  }

  console.log(`  Loaded ${personas.length} persona(s):\n`);
  for (const p of personas) {
    console.log(`    - ${p.username} (${p.primary_persona}) — ${p.total_comments} comments, expertise: ${p.expertise_level}`);
  }
  console.log('');

  // Run bots sequentially
  const results: (BotTestRun | null)[] = [];

  for (const persona of personas) {
    console.log(`\n${'━'.repeat(60)}`);
    const result = await runPersonaBot(persona);
    results.push(result);
    console.log(`${'━'.repeat(60)}\n`);

    // Brief pause between bots
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Cross-persona report
  await generateCrossPersonaReport(results, personas);
}

main().catch(console.error);
