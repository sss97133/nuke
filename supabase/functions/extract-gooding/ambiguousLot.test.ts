// Run: deno test --node-modules-dir=none supabase/functions/extract-gooding/
import { saveToDatabase, type GoodingExtracted } from './index.ts';

function lotFor(slug: string): GoodingExtracted {
  return {
    url: `https://www.goodingco.com/lot/${slug}`, slug, title: '1971 Nissan Skyline H/T 2000GT-R Hakosuka', year: 1971, make: 'Nissan',
    model: "Skyline H/T 2000GT-R 'Hakosuka'", series: null, trim: null, body_style: null, vin: 'KPGC10-000641', chassis: 'KPGC10-000641', coachwork: null,
    lot_number: 45, auction_name: 'Pebble Beach Auctions', auction_date: '2022-08-19', auction_location: null, auction_calendar_position: null,
    event_dates: { ended_at: null, sold_at: null, basis: 'multiple_auction_sessions_no_lot_day', session_days: [] } as any,
    currency: 'USD', estimate_low: 225000, estimate_high: 275000, sale_price: 179200, has_reserve: true, status: 'sold',
    highlights: [], specifications: [], description: null, vehicle_type: null, saleroom_addendum: null, engine_number: null,
    description_sections: [], engine_size: null, transmission: null, mileage: null, image_urls: [], online_bidding_available: false,
    auction_mobility_id: null,
  } as unknown as GoodingExtracted;
}

// The first read is the episode-key lookup; it answers with `lookupError`. Every write is recorded.
function stub(lookupError: { code: string; message: string }) {
  const rpcs: Array<{ fn: string; args: any }> = [];
  const writes: string[] = [];
  let first = true;
  const client = {
    from(table: string) {
      const b: any = {
        select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; }, ilike() { return b; },
        limit() { return b; }, abortSignal() { return b; }, order() { return b; },
        insert() { writes.push(`${table}.insert`); return b; }, update() { writes.push(`${table}.update`); return b; },
        maybeSingle() {
          if (first && table === 'vehicle_events') { first = false; return Promise.resolve({ data: null, error: lookupError }); }
          return Promise.resolve({ data: null, error: null });
        },
        then(r: any) { return Promise.resolve({ data: null, error: null }).then(r); },
      };
      return b;
    },
    rpc(fn: string, args: any) { rpcs.push({ fn, args }); return Promise.resolve({ error: null }); },
  };
  return { client, rpcs, writes };
}

Deno.test('a lot whose episode key is on two vehicles is refused, raised for relinking, and nothing is written', async () => {
  const s = stub({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
  let msg = '';
  try { await saveToDatabase(s.client, lotFor('1971-nissan-skyline-h-t-2000gt-r-hakosuka')); } catch (e) { msg = (e as Error).message; }
  if (!msg.includes('identity refused') || !msg.includes('goodingco.com/lot/1971-nissan-skyline-h-t-2000gt-r-hakosuka')) throw new Error(`message: ${msg}`);
  const rev = s.rpcs.find((r) => r.fn === 'record_revision_item');
  if (!rev || rev.args.p_next_action !== 'relink' || rev.args.p_detail?.reason !== 'lot_on_multiple_vehicles') throw new Error(JSON.stringify(s.rpcs));
  if (s.writes.length) throw new Error(`wrote ${s.writes.join(',')}`);
});

Deno.test('any other lookup failure surfaces its message and code, and raises no relink', async () => {
  const s = stub({ code: '57014', message: 'canceling statement due to statement timeout' });
  let msg = '';
  try { await saveToDatabase(s.client, lotFor('1952-cunningham-c-3-coupe')); } catch (e) { msg = (e as Error).message; }
  if (msg !== 'vehicle lookup failed: canceling statement due to statement timeout (57014)') throw new Error(`message: ${msg}`);
  if (s.rpcs.some((r) => r.fn === 'record_revision_item')) throw new Error('raised a revision for a timeout');
  if (s.writes.length) throw new Error(`wrote ${s.writes.join(',')}`);
});
