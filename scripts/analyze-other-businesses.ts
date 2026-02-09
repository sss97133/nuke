#!/usr/bin/env npx tsx
/**
 * Analyze businesses currently classified as "other" to discover real categories.
 * Outputs: name, website, description snippet so we can define new types.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
try {
  const p = join(root, '.env');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
} catch {}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE = 1000;
async function fetchAll(where: string) {
  let out: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = supabase
      .from('businesses')
      .select('id, business_name, description, website')
      .eq('business_type', 'other')
      .not('business_name', 'is', null)
      .order('business_name')
      .range(offset, offset + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    out = out.concat(data);
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const rows = await fetchAll('other');
  console.log('Fetched', rows.length, '"other" businesses. Sampling and grouping by patterns...\n');

  // Group by obvious patterns in name + description + URL
  const groups: Record<string, { pattern: string; examples: typeof rows }> = {};

  function add(group: string, pattern: string, row: (typeof rows)[0]) {
    if (!groups[group]) groups[group] = { pattern, examples: [] };
    if (groups[group].examples.length < 15) groups[group].examples.push(row);
  }

  for (const r of rows) {
    const name = (r.business_name || '').toLowerCase();
    const desc = (r.description || '').toLowerCase();
    const web = (r.website || '').toLowerCase();
    const combined = [name, desc, web].join(' ');

    if (/villa|sibarth|st\s*barth|stbarth|villainstbarth|myvilla/.test(combined)) {
      add('villa_rental', 'villa / sibarth / st barth rental', r);
      continue;
    }
    if (/event|dkevents|wedding|planning|corporate\s*event/.test(combined)) {
      add('event_company', 'event / wedding / planning', r);
      continue;
    }
    if (/art\s*print|artprint|art\s*gallery|artisan|atelier|graphiste|peintre|artist/.test(combined) && !/auto|car|moteur/.test(combined)) {
      add('art_creative', 'art / print / atelier / gallery', r);
      continue;
    }
    if (/restaurant|chef|catering|cuisine|dining|food|resto/.test(combined)) {
      add('restaurant_food', 'restaurant / chef / catering / food', r);
      continue;
    }
    if (/property|properties|real\s*estate|immobilier|management\s*property|rental/.test(combined) && !/villa/.test(combined)) {
      add('property_management', 'property / real estate / rental (non-villa)', r);
      continue;
    }
    if (/hotel|resort|lodging|hebergement/.test(combined)) {
      add('hotel_lodging', 'hotel / resort / lodging', r);
      continue;
    }
    if (/club|rotary|association|nonprofit|ong|foundation/.test(combined)) {
      add('club_association', 'club / association / nonprofit', r);
      continue;
    }
    if (/shop|boutique|store|retail|commerce/.test(combined) && !/auto|car|motor|moteur/.test(combined)) {
      add('retail_other', 'shop / boutique / retail (non-auto)', r);
      continue;
    }
    if (/construction|batiment|renovation|plombier|electricien|etancheit|affichage|signaletique/.test(combined)) {
      add('construction_services', 'construction / renovation / trades', r);
      continue;
    }
    if (/avocat|lawyer|legal|notaire|accounting|comptab|insurance|assurance/.test(combined)) {
      add('professional_services', 'legal / accounting / insurance', r);
      continue;
    }
    if (/health|sante|medical|pharma|doctor|clinic/.test(combined)) {
      add('health_medical', 'health / medical', r);
      continue;
    }
    if (/school|education|formation|training|university|ecole/.test(combined) && !/auto|car/.test(combined)) {
      add('education', 'school / education / training', r);
      continue;
    }
    if (/sport|fitness|yoga|gym|echanges|echecs/.test(combined) && !/motor|car|auto/.test(combined)) {
      add('sport_recreation', 'sport / fitness / recreation', r);
      continue;
    }
    if (/travel|tour|voyage|tourism|excursion/.test(combined)) {
      add('travel_tourism', 'travel / tour / tourism', r);
      continue;
    }
    if (/boat|marine|yacht|nautic|voilier/.test(combined)) {
      add('marine_nautical', 'boat / marine / yacht', r);
      continue;
    }
    if (/bringatrailer|bring.a.trailer|bat_listing/.test(combined)) {
      add('auction_missed', 'BaT / auction in other (fix)', r);
      continue;
    }
    // No pattern matched
    add('unclassified', 'no pattern matched', r);
  }

  const lines: string[] = [
    '# Analysis of "other" businesses – suggested new types',
    '',
    'These patterns emerged from name + description + website. Use them to define new business_type values and re-classify.',
    '',
  ];

  const order = [
    'villa_rental', 'event_company', 'art_creative', 'restaurant_food', 'property_management',
    'hotel_lodging', 'club_association', 'retail_other', 'construction_services', 'professional_services',
    'health_medical', 'education', 'sport_recreation', 'travel_tourism', 'marine_nautical',
    'auction_missed', 'unclassified',
  ];

  for (const key of order) {
    const g = groups[key];
    if (!g) continue;
    const count = rows.filter((r) => {
      const c = [r.business_name, r.description, r.website].join(' ').toLowerCase();
      // approximate: count by same logic (simplified)
      return true;
    }).length;
    lines.push(`## ${key} (pattern: ${g.pattern})`);
    lines.push('');
    for (const ex of g.examples) {
      lines.push(`- **${(ex.business_name || '').replace(/\n/g, ' ')}** | ${ex.website || '—'}`);
      if (ex.description) lines.push(`  ${ex.description.slice(0, 150).replace(/\n/g, ' ')}…`);
      lines.push('');
    }
    lines.push('');
  }

  // Count by group (re-scan with same logic)
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const name = (r.business_name || '').toLowerCase();
    const desc = (r.description || '').toLowerCase();
    const web = (r.website || '').toLowerCase();
    const combined = [name, desc, web].join(' ');
    let group = 'unclassified';
    if (/villa|sibarth|st\s*barth|stbarth|villainstbarth|myvilla/.test(combined)) group = 'villa_rental';
    else if (/event|dkevents|wedding|planning|corporate\s*event/.test(combined)) group = 'event_company';
    else if (/art\s*print|artprint|art\s*gallery|artisan|atelier|graphiste|peintre|artist/.test(combined) && !/auto|car|moteur/.test(combined)) group = 'art_creative';
    else if (/restaurant|chef|catering|cuisine|dining|food|resto/.test(combined)) group = 'restaurant_food';
    else if (/property|properties|real\s*estate|immobilier|management\s*property|rental/.test(combined) && !/villa/.test(combined)) group = 'property_management';
    else if (/hotel|resort|lodging|hebergement/.test(combined)) group = 'hotel_lodging';
    else if (/club|rotary|association|nonprofit|ong|foundation/.test(combined)) group = 'club_association';
    else if (/shop|boutique|store|retail|commerce/.test(combined) && !/auto|car|motor|moteur/.test(combined)) group = 'retail_other';
    else if (/construction|batiment|renovation|plombier|electricien|etancheit|affichage|signaletique/.test(combined)) group = 'construction_services';
    else if (/avocat|lawyer|legal|notaire|accounting|comptab|insurance|assurance/.test(combined)) group = 'professional_services';
    else if (/health|sante|medical|pharma|doctor|clinic/.test(combined)) group = 'health_medical';
    else if (/school|education|formation|training|university|ecole/.test(combined) && !/auto|car/.test(combined)) group = 'education';
    else if (/sport|fitness|yoga|gym|echanges|echecs/.test(combined) && !/motor|car|auto/.test(combined)) group = 'sport_recreation';
    else if (/travel|tour|voyage|tourism|excursion/.test(combined)) group = 'travel_tourism';
    else if (/boat|marine|yacht|nautic|voilier/.test(combined)) group = 'marine_nautical';
    else if (/bringatrailer|bring.a.trailer/.test(combined)) group = 'auction_missed';
    counts[group] = (counts[group] || 0) + 1;
  }

  const summary = [
    '',
    '---',
    '',
    '## Suggested counts (from same pattern logic)',
    '',
    ...Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `- **${k}**: ${n}`),
  ];
  mkdirSync(join(root, 'scripts', 'data'), { recursive: true });
  writeFileSync(
    join(root, 'scripts', 'data', 'other-businesses-analysis.md'),
    lines.join('\n') + summary.join('\n'),
    'utf8'
  );
  console.log('Wrote scripts/data/other-businesses-analysis.md');
  console.log('\nSuggested type counts:');
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`  ${k}: ${n}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
