#!/usr/bin/env node

/**
 * Backfill auction activity into business_timeline_events for auction houses.
 * Creates monthly summary events based on external_listings end_date.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const TARGET_ORG_NAMES = [
  'Mecum',
  'Barrett-Jackson',
  'Broad Arrow Auctions',
  'Bring a Trailer',
  'Cars & Bids',
];

function monthKey(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthTitle(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function loadTargetOrgs() {
  const { data: auctionOrgs } = await supabase
    .from('businesses')
    .select('id, business_name, business_type')
    .eq('business_type', 'auction_house');

  const { data: nameOrgs } = await supabase
    .from('businesses')
    .select('id, business_name, business_type')
    .or(TARGET_ORG_NAMES.map(n => `business_name.ilike.%${n}%`).join(','));

  const merged = new Map();
  for (const o of (auctionOrgs || [])) merged.set(o.id, o);
  for (const o of (nameOrgs || [])) merged.set(o.id, o);
  return Array.from(merged.values());
}

async function backfillOrg(org) {
  const { data: listings } = await supabase
    .from('external_listings')
    .select('id, platform, end_date')
    .eq('organization_id', org.id)
    .not('end_date', 'is', null);

  if (!listings || listings.length === 0) return;

  const grouped = new Map();
  for (const l of listings) {
    const key = monthKey(l.end_date);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(l);
  }

  for (const [key, rows] of grouped.entries()) {
    const { data: existing } = await supabase
      .from('business_timeline_events')
      .select('id')
      .eq('business_id', org.id)
      .eq('event_type', 'other')
      .eq('metadata->>event_kind', 'auction_activity')
      .eq('metadata->>auction_month', key)
      .limit(1);

    if (existing && existing.length > 0) {
      continue;
    }

    const platformCounts = rows.reduce((acc, r) => {
      const p = (r.platform || 'unknown').toLowerCase();
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {});

    const eventDate = new Date(`${key}-28T00:00:00Z`).toISOString().slice(0, 10);
    const title = `Auction activity · ${monthTitle(key)}`;
    const description = `${rows.length} listings ended across ${Object.keys(platformCounts).length} platform(s).`;

    await supabase
      .from('business_timeline_events')
      .insert({
        business_id: org.id,
        created_by: org.uploaded_by || org.discovered_by || null,
        event_type: 'other',
        event_category: 'financial',
        title,
        description,
        event_date: eventDate,
        metadata: {
          event_kind: 'auction_activity',
          auction_month: key,
          listing_count: rows.length,
          platform_counts: platformCounts,
        }
      });

    console.log(`✅ ${org.business_name}: ${key} (${rows.length})`);
  }
}

async function main() {
  const orgs = await loadTargetOrgs();
  console.log(`Found ${orgs.length} auction orgs`);
  for (const org of orgs) {
    await backfillOrg(org);
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
