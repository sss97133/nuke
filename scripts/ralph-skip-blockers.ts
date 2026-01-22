/**
 * Skip known blocker sources (KSL, etc.)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Sources that always block or fail
const BLOCKED_PATTERNS = [
  'ksl.com',
  'facebook.com/marketplace',
  'offerup.com',
  // Add more as identified
];

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║       RALPH BLOCKER SKIPPER                        ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  let totalSkipped = 0;

  for (const pattern of BLOCKED_PATTERNS) {
    const { count } = await supabase
      .from('import_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .ilike('listing_url', `%${pattern}%`);

    if (count && count > 0) {
      console.log(`${pattern}: ${count} pending items`);

      const { error } = await supabase
        .from('import_queue')
        .update({
          status: 'skipped',
          updated_at: new Date().toISOString(),
          raw_data: { skipped_reason: `blocked-source-${pattern}`, skipped_by: 'ralph' }
        })
        .eq('status', 'pending')
        .ilike('listing_url', `%${pattern}%`);

      if (error) {
        console.error(`  Error: ${error.message}`);
      } else {
        console.log(`  ✅ Skipped ${count} items`);
        totalSkipped += count;
      }
    }
  }

  console.log(`\nTotal skipped: ${totalSkipped}`);

  // Check remaining
  const { count: remaining } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  console.log(`Pending items remaining: ${remaining}`);
}

main().catch(console.error);
