import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const NORMALIZATIONS = {
  '4-speed Manual': '4-Speed Manual',
  '3-speed Automatic': '3-Speed Automatic',
  '4-speed Automatic': '4-Speed Automatic',
  '5-speed Manual': '5-Speed Manual',
  '6-speed Manual': '6-Speed Manual',
  '6-speed Automatic': '6-Speed Automatic',
  'automatic': 'Automatic',
  'manual': 'Manual',
  'Manual (6-Speed)': '6-Speed Manual',
  'Manual (5-Speed)': '5-Speed Manual',
  'Manual (4-Speed)': '4-Speed Manual',
  'Automatic (8-Speed)': '8-Speed Automatic',
  'Automatic (7-Speed)': '7-Speed Automatic',
  'Automatic (6-Speed)': '6-Speed Automatic',
  'Automatic (5-Speed)': '5-Speed Automatic',
  'Automatic (4-Speed)': '4-Speed Automatic',
  'Automatic (3-Speed)': '3-Speed Automatic',
};

const JUNK = ['N/a', 'N/A', 'n/a', 'Unknown', 'unknown', 'Other'];

let total = 0;

for (const [from, to] of Object.entries(NORMALIZATIONS)) {
  let done = 0;
  while (true) {
    const { data: batch } = await sb.from('vehicles')
      .select('id')
      .eq('transmission', from)
      .eq('status', 'active')
      .limit(500);
    if (!batch || batch.length === 0) break;
    await sb.from('vehicles').update({ transmission: to }).in('id', batch.map(r => r.id));
    done += batch.length;
    total += batch.length;
  }
  if (done > 0) console.log(`  ${from} → ${to}: ${done}`);
}

for (const junk of JUNK) {
  let done = 0;
  while (true) {
    const { data: batch } = await sb.from('vehicles')
      .select('id')
      .eq('transmission', junk)
      .eq('status', 'active')
      .limit(500);
    if (!batch || batch.length === 0) break;
    await sb.from('vehicles').update({ transmission: null }).in('id', batch.map(r => r.id));
    done += batch.length;
    total += batch.length;
  }
  if (done > 0) console.log(`  ${junk} → NULL: ${done}`);
}

console.log(`Total transmission normalized: ${total}`);
