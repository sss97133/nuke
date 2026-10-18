// Run: deno test --node-modules-dir=none supabase/functions/extract-gooding/
import { saveToDatabase, type GoodingExtracted } from './index.ts';

const URLS = ['https://media.goodingco.com/a.jpg', 'https://media.goodingco.com/b.jpg', 'https://media.goodingco.com/c.jpg'];

function lot(): GoodingExtracted {
  return {
    url: 'https://www.goodingco.com/lot/1962-mercedes-benz-300-sl-roadster-rn26', slug: '1962-mercedes-benz-300-sl-roadster-rn26',
    title: '1962 Mercedes-Benz 300 SL Roadster', year: 1962, make: 'Mercedes-Benz', model: '300 SL Roadster', series: null, trim: null,
    body_style: null, vin: '198.042.10.003062', chassis: '198.042.10.003062', coachwork: null, lot_number: null,
    auction_name: 'Retromobile New York Auctions', auction_date: null, auction_location: null, auction_calendar_position: null,
    event_dates: { ended_at: null, sold_at: null, basis: 'multiple_auction_sessions_no_lot_day', session_days: [] } as any,
    currency: 'USD', estimate_low: null, estimate_high: null, sale_price: null, has_reserve: true, status: 'upcoming',
    highlights: [], specifications: [], description: null, vehicle_type: null, saleroom_addendum: null, engine_number: null,
    description_sections: [], engine_size: null, transmission: null, mileage: null, image_urls: URLS, online_bidding_available: false,
    auction_mobility_id: null,
  } as unknown as GoodingExtracted;
}

// The vehicle resolves through its episode; `held` is the vehicle's existing gallery. Image inserts and deletes are recorded.
function stub(held: string[]) {
  const inserted: any[] = [];
  let deletes = 0;
  const client = {
    from(table: string) {
      let op = 'select';
      const b: any = {
        select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; }, ilike() { return b; },
        limit() { return b; }, abortSignal() { return b; }, order() { return b; },
        update() { op = 'update'; return b; },
        delete() { op = 'delete'; if (table === 'vehicle_images') deletes++; return b; },
        insert(rows: any) { op = 'insert'; if (table === 'vehicle_images') inserted.push(...rows); return b; },
        maybeSingle() {
          if (table === 'vehicle_events' && op === 'select') return Promise.resolve({ data: { vehicle_id: 'v-300sl' }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(r: any) {
          if (table === 'vehicle_images' && op === 'select') return Promise.resolve({ data: held.map((image_url) => ({ image_url })), error: null }).then(r);
          if (table === 'vehicle_images' && op === 'insert') return Promise.resolve({ data: inserted.map((_, i) => ({ id: `i${i}` })), error: null }).then(r);
          return Promise.resolve({ data: null, error: null }).then(r);
        },
      };
      return b;
    },
    rpc() { return Promise.resolve({ error: null }); },
  };
  return { client, inserted, deletes: () => deletes };
}

Deno.test('a re-read adds no photo the vehicle already holds and deletes none', async () => {
  const s = stub(URLS);
  const r = await saveToDatabase(s.client, lot());
  if (s.inserted.length !== 0 || r.images_saved !== 0 || s.deletes() !== 0) throw new Error(JSON.stringify({ inserted: s.inserted.length, saved: r.images_saved, deletes: s.deletes() }));
});

Deno.test('a first read writes the whole gallery with the first photo primary; a partial gallery gets only the missing photos', async () => {
  const fresh = stub([]);
  await saveToDatabase(fresh.client, lot());
  if (fresh.inserted.length !== 3 || !fresh.inserted[0].is_primary || fresh.inserted.slice(1).some((x) => x.is_primary)) throw new Error(JSON.stringify(fresh.inserted));
  const partial = stub([URLS[0]]);
  await saveToDatabase(partial.client, lot());
  if (partial.inserted.map((x) => x.image_url).join() !== URLS.slice(1).join() || partial.inserted.some((x) => x.is_primary)) throw new Error(JSON.stringify(partial.inserted));
});
