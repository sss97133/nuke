#!/usr/bin/env node
/**
 * Question Classify Bulk — High-throughput local classification
 *
 * Reads taxonomy from question_taxonomy, classifies unclassified questions
 * via regex, and writes results in bulk UPDATEs via psql (1000 rows/batch).
 *
 * 100x faster than the edge function because:
 * - Direct DB connection (no REST API overhead per row)
 * - Bulk UPDATE with VALUES clause (1000 rows in one statement)
 * - No edge function wall-clock timeout
 *
 * Usage:
 *   dotenvx run -- node scripts/question-classify-bulk.mjs
 *   dotenvx run -- node scripts/question-classify-bulk.mjs --limit 50000
 *   dotenvx run -- node scripts/question-classify-bulk.mjs --batch 2000
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars. Run with: dotenvx run -- node scripts/question-classify-bulk.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const PSQL_CMD = `PGPASSWORD="${DB_PASSWORD}" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres`;

// Parse args
const args = process.argv.slice(2);
const maxRows = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : Infinity;
const batchSize = args.includes('--batch') ? parseInt(args[args.indexOf('--batch') + 1]) : 1000;

// ─── Load taxonomy and build classifier ─────────────────────────────

async function loadTaxonomy() {
  const { data, error } = await supabase
    .from('question_taxonomy')
    .select('id, l1_category, l2_subcategory, regex_patterns, keywords');

  if (error || !data?.length) throw new Error('Failed to load taxonomy');
  return data;
}

function buildClassifier(taxonomy) {
  // Pre-compile all regex patterns
  const compiled = taxonomy.map(t => {
    const patterns = [];

    // Data-driven patterns
    const dd = t.regex_patterns?.data_driven || [];
    for (const p of dd) {
      try { patterns.push({ regex: new RegExp(p.pattern, 'i'), weight: p.weight || 1.0 }); } catch {}
    }

    // Keyword patterns
    const kb = t.regex_patterns?.keyword_based || [];
    for (const p of kb) {
      try { patterns.push({ regex: new RegExp(p.pattern, 'i'), weight: p.weight || 0.8 }); } catch {}
    }

    return { id: t.id, l1: t.l1_category, l2: t.l2_subcategory, patterns, keywords: t.keywords || [] };
  });

  return function classify(text) {
    const lower = text.toLowerCase();
    let bestId = null, bestL1 = null, bestL2 = null, bestScore = 0;

    for (const t of compiled) {
      let score = 0;
      for (const p of t.patterns) {
        if (p.regex.test(lower)) score += p.weight;
      }
      for (const kw of t.keywords) {
        if (kw.length > 2 && lower.includes(kw.toLowerCase())) score += 0.5;
      }
      if (score > bestScore) {
        bestScore = score;
        bestId = t.id;
        bestL1 = t.l1;
        bestL2 = t.l2;
      }
    }

    const confidence = bestScore > 0 ? bestScore / (bestScore + 1) : 0;
    return { l1: bestL1, l2: bestL2, confidence, method: confidence >= 0.3 ? 'regex_v1' : (bestScore > 0 ? 'regex_v1_low_conf' : 'regex_v1_no_match') };
  };
}

// ─── Fetch + classify + bulk update loop ─────────────────────────────

async function run() {
  console.log('Loading taxonomy...');
  const taxonomy = await loadTaxonomy();
  const classify = buildClassifier(taxonomy);
  console.log(`Loaded ${taxonomy.length} categories with compiled patterns`);

  let totalProcessed = 0;
  let totalClassified = 0;
  const startTime = Date.now();

  while (totalProcessed < maxRows) {
    // Fetch batch of unclassified questions via psql (fast, avoids REST timeout)
    const fetchSize = Math.min(batchSize, maxRows - totalProcessed);
    let rawOutput;
    try {
      rawOutput = execSync(
        `${PSQL_CMD} -t -A -F '|' -c "SELECT id, comment_text FROM auction_comments WHERE has_question = true AND question_classified_at IS NULL LIMIT ${fetchSize}"`,
        { maxBuffer: 50 * 1024 * 1024, timeout: 60000 }
      ).toString();
    } catch (e) {
      console.error('Fetch error:', e.message?.slice(0, 100));
      break;
    }

    const rows = rawOutput.trim().split('\n').filter(Boolean).map(line => {
      const pipeIdx = line.indexOf('|');
      return { id: line.slice(0, pipeIdx), text: line.slice(pipeIdx + 1) };
    }).filter(r => r.text && r.id);

    if (rows.length === 0) {
      console.log('No more unclassified questions.');
      break;
    }

    // Classify each row
    const updates = [];
    let batchClassified = 0;

    for (const row of rows) {
      const result = classify(row.text);
      const l1 = result.l1 && result.confidence >= 0.3 ? result.l1 : null;
      const l2 = result.l2 && result.confidence >= 0.3 ? result.l2 : null;
      if (l1) batchClassified++;

      updates.push({
        id: row.id,
        l1: l1 ? `'${l1}'` : 'NULL',
        l2: l2 ? `'${l2}'` : 'NULL',
        method: `'${result.method}'`,
      });
    }

    // Bulk UPDATE via psql VALUES clause
    const valuesList = updates.map(u =>
      `('${u.id}'::uuid, ${u.l1}, ${u.l2}, NOW(), ${u.method})`
    ).join(',');

    const updateSQL = `UPDATE auction_comments AS ac SET
      question_primary_l1 = v.l1,
      question_primary_l2 = v.l2,
      question_classified_at = v.ts,
      question_classify_method = v.method
    FROM (VALUES ${valuesList}) AS v(id, l1, l2, ts, method)
    WHERE ac.id = v.id`;

    try {
      execSync(`${PSQL_CMD} -c "${updateSQL.replace(/"/g, '\\"')}"`, { timeout: 120000 });
    } catch (e) {
      // If the VALUES clause is too long for shell, split into smaller chunks
      const chunkSize = 200;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        const chunkValues = chunk.map(u => `('${u.id}'::uuid, ${u.l1}, ${u.l2}, NOW(), ${u.method})`).join(',');
        const chunkSQL = `UPDATE auction_comments AS ac SET question_primary_l1 = v.l1, question_primary_l2 = v.l2, question_classified_at = v.ts, question_classify_method = v.method FROM (VALUES ${chunkValues}) AS v(id, l1, l2, ts, method) WHERE ac.id = v.id`;
        try {
          execSync(`${PSQL_CMD} -c "${chunkSQL.replace(/"/g, '\\"')}"`, { timeout: 60000 });
        } catch (e2) {
          console.error(`Chunk update error at ${i}:`, e2.message?.slice(0, 100));
        }
      }
    }

    totalProcessed += rows.length;
    totalClassified += batchClassified;

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = Math.round(totalProcessed / elapsed);
    const pct = Math.round(totalClassified / totalProcessed * 100);
    process.stdout.write(`  ${totalProcessed.toLocaleString()} processed, ${totalClassified.toLocaleString()} classified (${pct}%), ${rate}/s\r`);
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nDone: ${totalProcessed.toLocaleString()} processed, ${totalClassified.toLocaleString()} classified in ${elapsed.toFixed(0)}s (${Math.round(totalProcessed / elapsed)}/s)`);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
