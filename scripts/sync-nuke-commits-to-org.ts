#!/usr/bin/env npx tsx
/**
 * Sync git commits from the /nuke repo into Nuke Ltd's organization timeline
 * (business_timeline_events). Run from repo root. The contributions map for Nuke
 * will mirror the actual build/commits.
 *
 * Usage:
 *   npx tsx scripts/sync-nuke-commits-to-org.ts [--dry-run] [--max N]
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY for read-only;
 *      inserts require service role or RLS will block).
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_ARG = process.argv.find((a) => a.startsWith('--max='));
const MAX_COMMITS = MAX_ARG ? parseInt(MAX_ARG.split('=')[1], 10) : 2000;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface GitCommit {
  sha: string;
  date: string; // YYYY-MM-DD
  subject: string;
  body: string;
}

function getGitCommits(repoRoot: string, max: number): GitCommit[] {
  const format = '%H%x00%aI%x00%s%x00%b';
  const out = execSync(
    `git log --format=${format} -n ${max}`,
    { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );
  const commits: GitCommit[] = [];
  const parts = out.split('\0');
  for (let i = 0; i + 3 <= parts.length; i += 4) {
    const sha = parts[i].trim();
    const dateStr = parts[i + 1].trim();
    const date = dateStr.slice(0, 10);
    const subject = (parts[i + 2] || '').trim().slice(0, 500);
    const body = (parts[i + 3] || '').trim().slice(0, 2000);
    if (sha && date) commits.push({ sha, date, subject, body });
  }
  return commits;
}

async function main() {
  const repoRoot = process.cwd();
  console.log('Repo root:', repoRoot);
  console.log('Fetching Nuke Ltd business and owner...');

  let { data: business, error: bizErr } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', 'nuke-ltd')
    .limit(1)
    .maybeSingle();

  if (!business?.id) {
    const r = await supabase
      .from('businesses')
      .select('id')
      .ilike('business_name', '%nuke ltd%')
      .limit(1)
      .maybeSingle();
    business = r.data;
    bizErr = r.error;
  }

  if (bizErr || !business?.id) {
    console.error('Could not find Nuke Ltd business:', bizErr?.message || 'no row');
    process.exit(1);
  }

  const businessId = business.id;

  const { data: ownership } = await supabase
    .from('business_ownership')
    .select('owner_id')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .order('acquisition_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  const createdBy = ownership?.owner_id;
  if (!createdBy) {
    console.warn('No active owner for Nuke Ltd; created_by will need to be set. Checking RLS...');
  }

  console.log('Nuke Ltd business_id:', businessId, 'created_by:', createdBy || '(none)');

  const { data: existing } = await supabase
    .from('business_timeline_events')
    .select('metadata')
    .eq('business_id', businessId)
    .eq('event_type', 'commit');

  const existingShas = new Set(
    (existing || []).map((e: any) => e.metadata?.sha).filter(Boolean)
  );
  console.log('Existing commit events:', existingShas.size);

  const commits = getGitCommits(repoRoot, MAX_COMMITS);
  console.log('Git commits (last', MAX_COMMITS, '):', commits.length);

  const toInsert = commits.filter((c) => !existingShas.has(c.sha));
  console.log('New commits to insert:', toInsert.length);
  if (toInsert.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (DRY_RUN) {
    console.log('--dry-run: would insert', toInsert.length, 'events. Sample:', toInsert.slice(0, 3));
    return;
  }

  if (!createdBy) {
    console.error('Cannot insert without created_by (org owner). Add an owner to Nuke Ltd or set created_by in DB.');
    process.exit(1);
  }

  const rows = toInsert.map((c) => ({
    business_id: businessId,
    created_by: createdBy,
    event_type: 'commit',
    event_category: 'growth',
    title: c.subject || `Commit ${c.sha.slice(0, 7)}`,
    description: c.body || null,
    event_date: c.date,
    metadata: {
      sha: c.sha,
      repo: 'nuke',
      source: 'git_sync',
            },
  }));

  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('business_timeline_events').insert(batch);
    if (error) {
      console.error('Insert error:', error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log('Inserted', inserted, '/', rows.length);
  }

  console.log('Done. Inserted', inserted, 'commit events for Nuke Ltd.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
