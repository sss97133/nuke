#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Known Cloudflare-blocked forums from our testing
const CLOUDFLARE_BLOCKED = new Set([
  'rennlist', 'corvetteforum', 'ls1tech', 'honda-tech', 's2ki', 'thirdgen',
  'bimmerforums', 'rx7club', 'broncozone', '5thgenrams', '6speedonline',
  'aaca', 'audiforums', 'audiworld', 'audizine', 'automotiveforums',
  'bobistheoilguy', 'buickforums', 'carforum', 'civicforums', 'civicxi',
  'classicmotorsports', 'classicoldsmobile', 'classiczcars', 'clubcivic',
  'clublexus', 'defender2', 'driftworks', 'dsmtuners', 'f150forum',
  'f150-forums', 'f150online', 'ferrarichat', 'fitfreak', 'fordf150net',
  'ford-trucks', 'germancarforum', 'gmt400', 'gm-trucks', 'grassrootsmotorsports',
  'gtplanet', 'hondacivicforum', 'infinitiforum', 'jalopyjournal',
  'jeepgladiatorforum', 'jlwranglerforums', 'm3cutters', 'mbworld',
  'mercedesforum', 'mgexperience', 'miatanet', 'miataturbo', 'nasioc',
  'nicoclub', 'offroadpassport', 'performancetrucks', 'pontiaczone',
  'tacoma4g', 'thesubaruforums', 'thetruckstop', 'wranglertjforum',
  '67-72chevytrucks',
]);

async function main() {
  const { data: forums } = await supabase
    .from('forum_sources')
    .select('slug, name, platform_type, inspection_status')
    .order('name');

  const cloudflare = forums.filter(f => CLOUDFLARE_BLOCKED.has(f.slug));
  const accessible = forums.filter(f => !CLOUDFLARE_BLOCKED.has(f.slug));
  const active = forums.filter(f => f.inspection_status === 'active');

  console.log('═'.repeat(60));
  console.log('📦 FORUM INVENTORY');
  console.log('═'.repeat(60));

  console.log(`
TOTAL: ${forums.length} forums registered

🟢 ACTIVE (${active.length})
   Forums with extraction configured

🔒 CLOUDFLARE-BLOCKED (${cloudflare.length})
   Need Firecrawl (~$166) to unlock
   Big ones: rennlist, corvetteforum, bimmerforums, ls1tech, nasioc

🔓 ACCESSIBLE (${accessible.length})
   Can extract with direct fetch (free)
`);

  console.log('─'.repeat(60));
  console.log('STATUS: Cataloged for future expansion');
  console.log('ACTION: When ready, upgrade Firecrawl to Standard ($83/mo)');
  console.log('═'.repeat(60));
}

main();
