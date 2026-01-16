#!/usr/bin/env npx tsx
/**
 * Quick bot system status check
 * Usage: npx tsx scripts/bot-status.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function status() {
  console.log('\n🤖 BOT TESTING STATUS\n' + '═'.repeat(50));

  // Findings summary
  const { data: findings } = await supabase
    .from('bot_findings')
    .select('status, severity')
    .order('created_at', { ascending: false });

  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  
  for (const f of findings || []) {
    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }

  console.log('\n📋 FINDINGS');
  console.log('  By Status:', byStatus);
  console.log('  By Severity:', bySeverity);

  // Recent bot runs
  const { data: runs } = await supabase
    .from('bot_test_runs')
    .select('id, status, bugs_found, started_at, metadata')
    .order('started_at', { ascending: false })
    .limit(3);

  console.log('\n🏃 RECENT BOT RUNS');
  for (const r of runs || []) {
    const persona = (r.metadata as any)?.persona_slug || 'unknown';
    console.log(`  ${persona}: ${r.status}, ${r.bugs_found} bugs (${new Date(r.started_at).toLocaleString()})`);
  }

  // Recent agent sessions
  const { data: sessions } = await supabase
    .from('debug_agent_sessions')
    .select('status, findings_processed, actions_taken, started_at, agent:debug_agents(name)')
    .order('started_at', { ascending: false })
    .limit(4);

  console.log('\n🔧 RECENT AGENT SESSIONS');
  for (const s of sessions || []) {
    const name = (s.agent as any)?.name || 'unknown';
    console.log(`  ${name}: ${s.findings_processed} processed, ${s.actions_taken} actions`);
  }

  // Pending admin alerts
  const { count } = await supabase
    .from('admin_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .not('metadata->agent', 'is', null);

  console.log('\n⚠️  PENDING ADMIN ALERTS:', count || 0);

  // Unresolved critical/high
  const { data: urgent } = await supabase
    .from('bot_findings')
    .select('title, severity')
    .in('severity', ['critical', 'high'])
    .not('status', 'in', '("fixed","wont_fix","duplicate")');

  if (urgent && urgent.length > 0) {
    console.log('\n🚨 URGENT ISSUES:');
    for (const u of urgent) {
      console.log(`  [${u.severity.toUpperCase()}] ${u.title}`);
    }
  }

  console.log('\n' + '═'.repeat(50) + '\n');
}

status().catch(console.error);
