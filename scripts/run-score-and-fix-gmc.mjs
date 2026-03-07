/**
 * 1) Invoke score-live-auctions to backfill hammer prices.
 * 2) Fix 1983 GMC K2500 (a90c008a-3379-41d8-9eb2-b4eda365d74c) to $31,000 if still wrong.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VEHICLE_ID = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';
const CORRECT_HAMMER = 31000;

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  // 1) Call score-live-auctions edge function
  console.log('Calling score-live-auctions...');
  const resp = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/score-live-auctions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ mode: 'score' }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('score-live-auctions failed:', resp.status, body);
  } else {
    console.log('score-live-auctions OK:', body.prices_fetched ?? 0, 'prices fetched');
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 2) Check vehicle and listing
  const { data: vehicle } = await supabase.from('vehicles').select('sale_price, winning_bid, high_bid').eq('id', VEHICLE_ID).single();
  const { data: listings } = await supabase.from('vehicle_events').select('id, final_price, event_status').eq('vehicle_id', VEHICLE_ID).eq('source_platform', 'bat');

  const currentSale = vehicle?.sale_price != null ? Number(vehicle.sale_price) : null;
  const listing = listings?.[0];

  if (currentSale === CORRECT_HAMMER && listing?.final_price === CORRECT_HAMMER) {
    console.log('1983 GMC K2500 already correct: $31,000');
    return;
  }

  console.log('Fixing 1983 GMC K2500 to $31,000...');

  if (listing?.id) {
    const { error: e1 } = await supabase
      .from('vehicle_events')
      .update({
        final_price: CORRECT_HAMMER,
        event_status: 'sold',
        updated_at: new Date().toISOString(),
      })
      .eq('id', listing.id);
    if (e1) console.error('vehicle_events update error:', e1.message);
    else console.log('vehicle_events updated to $31,000 sold');
  }

  const { error: e2 } = await supabase
    .from('vehicles')
    .update({
      sale_price: CORRECT_HAMMER,
      sale_status: 'sold',
      winning_bid: CORRECT_HAMMER,
      high_bid: CORRECT_HAMMER,
      updated_at: new Date().toISOString(),
    })
    .eq('id', VEHICLE_ID);
  if (e2) console.error('vehicles update error:', e2.message);
  else console.log('vehicles updated to $31,000');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
