#!/usr/bin/env node
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getOrgs() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/organizations?select=id,name,slug,type,website&order=name&limit=200`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const orgs = await res.json();

  if (!Array.isArray(orgs)) {
    console.log('Error:', orgs);
    return;
  }

  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  ORGS - POTENTIAL SOURCES                                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  // Group by type
  const byType = {};
  for (const org of orgs) {
    const type = org.type || 'unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(org);
  }

  for (const [type, list] of Object.entries(byType).sort()) {
    console.log(`${type.toUpperCase()} (${list.length})`);
    console.log('─'.repeat(85));
    for (const org of list.slice(0, 25)) {
      const website = org.website ? org.website.replace('https://', '').replace('http://', '').replace('www.', '').slice(0,45) : '';
      console.log(`  ${(org.name || org.slug).slice(0,38).padEnd(40)} ${website}`);
    }
    if (list.length > 25) console.log(`  ... and ${list.length - 25} more`);
    console.log('');
  }

  console.log('SUMMARY');
  console.log('─'.repeat(50));
  console.log(`  Total orgs: ${orgs.length}`);
  for (const [type, list] of Object.entries(byType).sort()) {
    console.log(`  ${type}: ${list.length}`);
  }
}

getOrgs().catch(console.error);
