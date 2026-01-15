#!/usr/bin/env npx tsx
/**
 * Debug Team Orchestrator
 * Runs the AI debug agents to process bot findings
 * 
 * Usage:
 *   npx tsx tests/bots/agents/run-debug-team.ts              # Run all agents once
 *   npx tsx tests/bots/agents/run-debug-team.ts --watch      # Watch mode (continuous)
 *   npx tsx tests/bots/agents/run-debug-team.ts --agent sentinel  # Run specific agent
 */

import { SentinelAgent } from './SentinelAgent';
import { SherlockAgent } from './SherlockAgent';
import { WatsonAgent } from './WatsonAgent';
import { PatchAgent } from './PatchAgent';

// Parse arguments
const args = process.argv.slice(2);
const watchMode = args.includes('--watch');
const specificAgent = args.includes('--agent') 
  ? args[args.indexOf('--agent') + 1] 
  : null;

// Validate environment
function validateEnv(): void {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
  ];

  const missing = required.filter(key => 
    !process.env[key] && !process.env[`NEXT_PUBLIC_${key}`]
  );

  if (missing.length > 0) {
    console.error('❌ Missing environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    process.exit(1);
  }
}

// Run a single agent
async function runAgent(name: string): Promise<void> {
  let agent;
  
  switch (name) {
    case 'sentinel':
      agent = new SentinelAgent();
      break;
    case 'sherlock':
      agent = new SherlockAgent();
      break;
    case 'watson':
      agent = new WatsonAgent();
      break;
    case 'patch':
      agent = new PatchAgent();
      break;
    default:
      console.error(`Unknown agent: ${name}`);
      return;
  }

  try {
    await agent.execute();
  } catch (error) {
    console.error(`❌ ${name} crashed:`, error);
  }
}

// Run the pipeline
async function runPipeline(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('🤖 DEBUG TEAM - AI Agent Pipeline');
  console.log('═'.repeat(60));
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('─'.repeat(60));

  // Agents run in order: Sentinel → Sherlock → Watson → Patch
  // Each agent reads messages left by the previous one
  
  const agents = ['sentinel', 'sherlock', 'watson', 'patch'];
  const agentsToRun = specificAgent ? [specificAgent] : agents;

  for (const agentName of agentsToRun) {
    console.log(`\n${'━'.repeat(50)}`);
    await runAgent(agentName);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ Pipeline complete');
  console.log('═'.repeat(60) + '\n');
}

// Watch mode - run continuously
async function watchLoop(): Promise<void> {
  console.log('👁️  Watch mode enabled - running continuously\n');
  console.log('Press Ctrl+C to stop\n');

  while (true) {
    await runPipeline();
    
    // Wait before next run
    const waitTime = 60000; // 1 minute
    console.log(`⏳ Next run in ${waitTime / 1000} seconds...\n`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
}

// Main
async function main(): Promise<void> {
  validateEnv();
  
  if (watchMode) {
    await watchLoop();
  } else {
    await runPipeline();
  }
}

main().catch(console.error);
