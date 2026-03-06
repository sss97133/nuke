#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dns from 'dns';

const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) return origLookup(hostname, options, callback);
    if (options && options.all) callback(null, addresses.map(a => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};
const nodeFetch = (await import('node-fetch')).default;
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function padRight(str, len) {
  str = String(str);
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function padLeft(str, len) {
  str = String(str);
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

function formatTable(headers, rows, alignments) {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const colVals = rows.map(r => String(r[i] ?? ''));
    return Math.max(h.length, ...colVals.map(v => v.length));
  });

  // Header line
  const headerLine = headers.map((h, i) => padRight(h, widths[i])).join('  ');
  const separatorLine = widths.map(w => '-'.repeat(w)).join('  ');

  // Data lines
  const dataLines = rows.map(row =>
    row.map((val, i) => {
      const s = String(val ?? '');
      return (alignments && alignments[i] === 'right') ? padLeft(s, widths[i]) : padRight(s, widths[i]);
    }).join('  ')
  );

  return [headerLine, separatorLine, ...dataLines].join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Publication Page Analysis Progress ===\n');

  // 1. Publisher-level breakdown
  const { data: publisherStats, error: err1 } = await supabase.rpc('execute_raw_query', {
    query_text: `
      SELECT
        p.publisher_slug,
        COUNT(*)::int as total_pages,
        COUNT(*) FILTER (WHERE pp.ai_processing_status = 'completed')::int as analyzed,
        COUNT(*) FILTER (WHERE pp.ai_processing_status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE pp.ai_processing_status = 'processing')::int as in_progress,
        COUNT(*) FILTER (WHERE pp.ai_processing_status = 'failed')::int as failed,
        ROUND(100.0 * COUNT(*) FILTER (WHERE pp.ai_processing_status = 'completed') / NULLIF(COUNT(*), 0), 1) as pct_complete,
        COALESCE(SUM(pp.analysis_cost), 0)::numeric(10,4) as total_cost_usd
      FROM publication_pages pp
      JOIN publications p ON pp.publication_id = p.id
      GROUP BY p.publisher_slug
      ORDER BY total_pages DESC
    `
  });

  if (err1) {
    // Fallback: try direct query
    console.error('RPC query failed:', err1.message);
    console.log('Trying fallback query...\n');

    const { data: pages, error: err1b } = await supabase
      .from('publication_pages')
      .select('id, ai_processing_status, analysis_cost, publications!inner(publisher_slug)');

    if (err1b) {
      console.error('Fallback also failed:', err1b.message);
      process.exit(1);
    }

    // Aggregate manually
    const byPublisher = {};
    for (const row of (pages || [])) {
      const slug = row.publications.publisher_slug;
      if (!byPublisher[slug]) {
        byPublisher[slug] = { total: 0, analyzed: 0, pending: 0, in_progress: 0, failed: 0, cost: 0 };
      }
      byPublisher[slug].total++;
      if (row.ai_processing_status === 'completed') byPublisher[slug].analyzed++;
      else if (row.ai_processing_status === 'pending') byPublisher[slug].pending++;
      else if (row.ai_processing_status === 'processing') byPublisher[slug].in_progress++;
      else if (row.ai_processing_status === 'failed') byPublisher[slug].failed++;
      byPublisher[slug].cost += parseFloat(row.analysis_cost || 0);
    }

    const headers = ['Publisher', 'Total', 'Analyzed', 'Pending', 'In Progress', 'Failed', '% Complete', 'Cost ($)'];
    const alignments = ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'];
    const rows = Object.entries(byPublisher)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([slug, s]) => [
        slug,
        s.total,
        s.analyzed,
        s.pending,
        s.in_progress,
        s.failed,
        s.total > 0 ? (100 * s.analyzed / s.total).toFixed(1) + '%' : '0.0%',
        '$' + s.cost.toFixed(4)
      ]);

    console.log('--- By Publisher ---\n');
    console.log(formatTable(headers, rows, alignments));

    const totals = Object.values(byPublisher).reduce((acc, s) => ({
      total: acc.total + s.total,
      analyzed: acc.analyzed + s.analyzed,
      pending: acc.pending + s.pending,
      in_progress: acc.in_progress + s.in_progress,
      failed: acc.failed + s.failed,
      cost: acc.cost + s.cost
    }), { total: 0, analyzed: 0, pending: 0, in_progress: 0, failed: 0, cost: 0 });

    console.log('\n--- Totals ---');
    console.log(`Total pages:   ${totals.total}`);
    console.log(`Analyzed:      ${totals.analyzed}`);
    console.log(`Pending:       ${totals.pending}`);
    console.log(`In progress:   ${totals.in_progress}`);
    console.log(`Failed:        ${totals.failed}`);
    console.log(`% Complete:    ${totals.total > 0 ? (100 * totals.analyzed / totals.total).toFixed(1) : '0.0'}%`);
    console.log(`Total cost:    $${totals.cost.toFixed(4)}`);
  } else {
    // RPC worked — display results
    const stats = publisherStats || [];

    const headers = ['Publisher', 'Total', 'Analyzed', 'Pending', 'In Progress', 'Failed', '% Complete', 'Cost ($)'];
    const alignments = ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'];
    const rows = stats.map(s => [
      s.publisher_slug,
      s.total_pages,
      s.analyzed,
      s.pending,
      s.in_progress,
      s.failed,
      s.pct_complete + '%',
      '$' + parseFloat(s.total_cost_usd).toFixed(4)
    ]);

    console.log('--- By Publisher ---\n');
    console.log(formatTable(headers, rows, alignments));

    // Totals
    const totals = stats.reduce((acc, s) => ({
      total: acc.total + s.total_pages,
      analyzed: acc.analyzed + s.analyzed,
      pending: acc.pending + s.pending,
      in_progress: acc.in_progress + s.in_progress,
      failed: acc.failed + s.failed,
      cost: acc.cost + parseFloat(s.total_cost_usd)
    }), { total: 0, analyzed: 0, pending: 0, in_progress: 0, failed: 0, cost: 0 });

    console.log('\n--- Totals ---');
    console.log(`Total pages:   ${totals.total}`);
    console.log(`Analyzed:      ${totals.analyzed}`);
    console.log(`Pending:       ${totals.pending}`);
    console.log(`In progress:   ${totals.in_progress}`);
    console.log(`Failed:        ${totals.failed}`);
    console.log(`% Complete:    ${totals.total > 0 ? (100 * totals.analyzed / totals.total).toFixed(1) : '0.0'}%`);
    console.log(`Total cost:    $${totals.cost.toFixed(4)}`);
  }

  // 2. Publication extraction status summary
  console.log('\n\n--- Publication Extraction Status ---\n');

  const { data: pubStats, error: err2 } = await supabase.rpc('execute_raw_query', {
    query_text: `
      SELECT extraction_status, COUNT(*)::int as count
      FROM publications
      GROUP BY extraction_status
      ORDER BY count DESC
    `
  });

  if (err2) {
    // Fallback
    const { data: pubs, error: err2b } = await supabase
      .from('publications')
      .select('extraction_status');

    if (err2b) {
      console.error('Failed to query publication statuses:', err2b.message);
    } else {
      const counts = {};
      for (const p of (pubs || [])) {
        const status = p.extraction_status || 'null';
        counts[status] = (counts[status] || 0) + 1;
      }
      const rows = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => [status, count]);

      console.log(formatTable(['Status', 'Count'], rows, ['left', 'right']));
    }
  } else {
    const rows = (pubStats || []).map(s => [s.extraction_status || 'null', s.count]);
    console.log(formatTable(['Status', 'Count'], rows, ['left', 'right']));
  }

  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
