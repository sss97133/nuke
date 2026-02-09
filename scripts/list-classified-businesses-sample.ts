#!/usr/bin/env npx tsx
/**
 * Fetch a sample of businesses with their type, name, website, description.
 * Run: npx tsx scripts/list-classified-businesses-sample.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
try {
  const path = join(root, '.env');
  if (existsSync(path)) {
    const env = readFileSync(path, 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
} catch {}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const PAGE = 1000;
  let rows: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data: page, error } = await supabase
      .from('businesses')
      .select('id, business_name, business_type, website, description')
      .not('business_name', 'is', null)
      .order('business_type', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(error);
      process.exit(1);
    }
    if (!page?.length) break;
    rows = rows.concat(page);
    if (page.length < PAGE) break;
  }

  const byType: Record<string, typeof rows> = {};
  for (const r of rows) {
    const t = r.business_type || 'null';
    if (!byType[t]) byType[t] = [];
    byType[t].push(r);
  }

  const lines: string[] = [
    '# Sample of classified businesses',
    '',
    '## Counts by type',
    ...Object.entries(byType)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([type, list]) => `- **${type}**: ${list.length}`),
    '',
    '---',
    '',
  ];

  for (const [type, list] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${type} (${list.length})`);
    lines.push('');
    for (const r of list.slice(0, 25)) {
      const name = (r.business_name || '').replace(/\n/g, ' ');
      const web = r.website ? ` | ${r.website}` : '';
      const desc = (r.description || '').slice(0, 120).replace(/\n/g, ' ');
      lines.push(`- **${name}**${web}`);
      if (desc) lines.push(`  - ${desc}${desc.length >= 120 ? '…' : ''}`);
      lines.push('');
    }
    if (list.length > 25) lines.push(`  … and ${list.length - 25} more`, '');
    lines.push('');
  }

  const outPath = join(root, 'scripts', 'data', 'classified-businesses-sample.md');
  mkdirSync(join(root, 'scripts', 'data'), { recursive: true });
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log('Wrote', outPath);
  console.log('\nCounts by type:');
  Object.entries(byType)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([type, list]) => console.log(`  ${type}: ${list.length}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
