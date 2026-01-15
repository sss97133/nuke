#!/usr/bin/env npx tsx
/**
 * Bot Test Orchestrator
 * Runs multiple bot personas to find bugs and UX issues
 * 
 * Usage:
 *   npx tsx tests/bots/run-bots.ts                    # Run all bots
 *   npx tsx tests/bots/run-bots.ts --persona casual   # Run specific persona
 *   npx tsx tests/bots/run-bots.ts --headless false   # Show browser
 */

import { createClient } from '@supabase/supabase-js';
import { CasualBrowserBot } from './personas/CasualBrowser';
import { ImpatientUserBot } from './personas/ImpatientUser';
import { ConfusedUserBot } from './personas/ConfusedUser';
import type { BotPersona, BotTestRun } from './types';

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : undefined;
};

const selectedPersona = getArg('persona');
const headless = getArg('headless') !== 'false';
const baseUrl = getArg('url') || process.env.BOT_BASE_URL || 'https://n-zero.dev';

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables:');
  console.error('   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Bot class mapping
const BOT_CLASSES: Record<string, typeof CasualBrowserBot | typeof ImpatientUserBot | typeof ConfusedUserBot> = {
  'casual_browser': CasualBrowserBot,
  'impatient_ian': ImpatientUserBot,
  'confused_carl': ConfusedUserBot,
};

async function loadPersonas(): Promise<BotPersona[]> {
  const query = supabase
    .from('bot_personas')
    .select('*')
    .eq('is_active', true);

  if (selectedPersona) {
    query.eq('slug', selectedPersona);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to load personas:', error);
    process.exit(1);
  }

  return data || [];
}

async function runBot(persona: BotPersona): Promise<BotTestRun | null> {
  const BotClass = BOT_CLASSES[persona.slug];
  
  if (!BotClass) {
    console.warn(`⚠️  No bot implementation for persona: ${persona.slug}`);
    return null;
  }

  const bot = new BotClass(persona);
  
  try {
    await bot.execute();
    return await bot.complete();
  } catch (error) {
    console.error(`❌ Bot ${persona.name} crashed:`, error);
    return null;
  }
}

async function generateReport(runs: (BotTestRun | null)[]): Promise<void> {
  const successfulRuns = runs.filter((r): r is BotTestRun => r !== null);
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 BOT TEST REPORT');
  console.log('═'.repeat(60));
  
  let totalFindings = 0;
  let criticalFindings = 0;
  
  for (const run of successfulRuns) {
    console.log(`\n${run.metadata?.persona_slug || 'Unknown'}:`);
    console.log(`   Pages: ${run.pages_visited}`);
    console.log(`   Actions: ${run.actions_performed}`);
    console.log(`   Bugs found: ${run.bugs_found}`);
    totalFindings += run.bugs_found;
  }
  
  // Get critical findings
  const { data: findings } = await supabase
    .from('bot_findings')
    .select('*')
    .eq('severity', 'critical')
    .eq('status', 'new');
  
  criticalFindings = findings?.length || 0;
  
  console.log('\n' + '─'.repeat(60));
  console.log(`Total findings: ${totalFindings}`);
  console.log(`Critical (needs immediate attention): ${criticalFindings}`);
  
  if (criticalFindings > 0) {
    console.log('\n🚨 CRITICAL FINDINGS:');
    for (const finding of findings || []) {
      console.log(`   • ${finding.title}`);
      console.log(`     URL: ${finding.page_url}`);
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log('View full results in Admin Dashboard → Bot Reports');
  console.log('═'.repeat(60) + '\n');
}

async function main(): Promise<void> {
  console.log('🤖 Bot Test Orchestrator');
  console.log('─'.repeat(40));
  console.log(`Target: ${baseUrl}`);
  console.log(`Headless: ${headless}`);
  console.log(`Persona filter: ${selectedPersona || 'all'}`);
  console.log('─'.repeat(40) + '\n');

  // Load personas from database
  const personas = await loadPersonas();
  
  if (personas.length === 0) {
    console.error('❌ No active personas found');
    process.exit(1);
  }

  console.log(`Found ${personas.length} persona(s) to run:\n`);
  personas.forEach(p => console.log(`   • ${p.name} (${p.slug})`));
  console.log('');

  // Run bots sequentially (could be parallelized for different environments)
  const results: (BotTestRun | null)[] = [];
  
  for (const persona of personas) {
    console.log(`\n${'━'.repeat(50)}`);
    const result = await runBot(persona);
    results.push(result);
    console.log(`${'━'.repeat(50)}\n`);
    
    // Small delay between bots
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Generate summary report
  await generateReport(results);
}

main().catch(console.error);
