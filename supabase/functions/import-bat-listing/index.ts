import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { extractBatDomMap } from '../_shared/batDomMap.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Site detection and DOM mapping
function detectAuctionSite(url: string): string {
  const domain = new URL(url).hostname.toLowerCase();
  
  if (domain.includes('bringatrailer.com')) return 'bringatrailer';
  if (domain.includes('carsandbids.com')) return 'carsandbids';
  if (domain.includes('mecum.com')) return 'mecum';
  if (domain.includes('barrett-jackson.com')) return 'barrettjackson';
  if (domain.includes('russoandsteele.com')) return 'russoandsteele';
  if (domain.includes('rmsothebys.com')) return 'rmsothebys';
  if (domain.includes('bonhams.com')) return 'bonhams';
  if (domain.includes('goodingco.com')) return 'gooding';
  
  return 'unknown';
}

// Site-specific extraction methods
async function extractCarsAndBidsListing(url: string, importImages: boolean) {
  console.log('Extracting Cars & Bids listing...');
  
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) {
    throw new Error('FIRECRAWL_API_KEY not configured');
  }
  
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['markdown', 'extract'],
      extract: {
        schema: {
          vehicle: {
            year: "Year of the vehicle",
            make: "Make/brand of the vehicle", 
            model: "Model name",
            description: "Vehicle description",
            current_bid: "Current bid amount",
            reserve_met: "Whether reserve is met",
            images: "Array of image URLs"
          }
        }
      }
    })
  });
  
  if (!response.ok) {
    throw new Error(`Firecrawl error: ${response.status}`);
  }
  
  const data = await response.json();
  return new Response(JSON.stringify({
    success: true,
    source: 'Cars & Bids',
    extracted_data: data.data?.extract?.vehicle || {},
    timestamp: new Date().toISOString()
  }));
}

async function extractMecumListing(url: string, importImages: boolean) {
  console.log('Extracting Mecum listing...');
  
  // Mecum DOM mapping
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) {
    throw new Error('FIRECRAWL_API_KEY not configured');
  }
  
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['markdown', 'extract'],
      extract: {
        schema: {
          vehicle: {
            year: "Vehicle year",
            make: "Vehicle make",
            model: "Vehicle model",
            lot_number: "Auction lot number",
            estimate: "Price estimate",
            description: "Lot description",
            images: "Vehicle images"
          }
        }
      }
    })
  });
  
  const data = await response.json();
  return new Response(JSON.stringify({
    success: true,
    source: 'Mecum Auctions',
    extracted_data: data.data?.extract?.vehicle || {},
    timestamp: new Date().toISOString()
  }));
}

async function extractBarrettJacksonListing(url: string, importImages: boolean) {
  console.log('Extracting Barrett-Jackson listing...');
  
  // Barrett-Jackson DOM mapping
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['extract'],
      extract: {
        schema: {
          vehicle: {
            year: "Vehicle year",
            make: "Vehicle make", 
            model: "Vehicle model",
            estimate: "Auction estimate",
            description: "Vehicle description"
          }
        }
      }
    })
  });
  
  const data = await response.json();
  return new Response(JSON.stringify({
    success: true,
    source: 'Barrett-Jackson',
    extracted_data: data.data?.extract?.vehicle || {},
    timestamp: new Date().toISOString()
  }));
}

async function extractRussoAndSteeleListing(url: string, importImages: boolean) {
  // Russo & Steele extraction
  const data = { message: 'Russo & Steele extraction not implemented yet' };
  return new Response(JSON.stringify({
    success: true,
    source: 'Russo and Steele', 
    extracted_data: data,
    timestamp: new Date().toISOString()
  }));
}

async function extractGenericAuctionListing(url: string, importImages: boolean, siteType: string) {
  console.log(`Extracting generic auction listing from ${siteType}...`);
  
  // Generic extraction for unknown sites
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['markdown']
    })
  });
  
  const data = await response.json();
  return new Response(JSON.stringify({
    success: true,
    source: siteType,
    extracted_data: { raw_content: data.data?.markdown?.substring(0, 500) || 'No content' },
    timestamp: new Date().toISOString()
  }));
}

// Original BaT extraction function (keep existing logic)
async function extractBaTListing(bat_auction_url: string, import_images: boolean, force_reimport: boolean) {;

interface BaTListing {
  url: string;
  title: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  transmission?: string;
  vin?: string;
  salePrice: number;
  saleDate: string;
  description: string;
  seller: string;
  sellerType?: string; // 'dealer' | 'private_party' | 'unknown' (best-effort)
  buyer: string;
  lotNumber: string;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keep raw page titles out of structured fields. We only want the vehicle identity portion.
function cleanListingishTitle(raw: string, year?: number | null, make?: string | null): string {
  let s = String(raw || '').trim();
  if (!s) return s;

  // Drop trailing site name (often after a pipe)
  s = s.split('|')[0].trim();

  // Remove common BaT boilerplate
  s = s.replace(/\bon\s+BaT\s+Auctions\b/gi, '').trim();
  s = s.replace(/\bBaT\s+Auctions\b/gi, '').trim();
  s = s.replace(/\bBring\s+a\s+Trailer\b/gi, '').trim();
  s = s.replace(/\bending\b[\s\S]*$/i, '').trim();

  // Remove lot number parenthetical
  s = s.replace(/\(\s*Lot\s*#.*?\)\s*/gi, ' ').trim();

  // Remove leading mileage words like "42k-mile"
  s = s.replace(/^\s*\d{1,3}(?:,\d{3})?\s*[kK]\s*[-\s]*mile\s+/i, '').trim();
  s = s.replace(/^\s*\d{1,3}(?:,\d{3})+\s*[-\s]*mile\s+/i, '').trim();

  // Remove leading year (we store year separately)
  if (typeof year === 'number') {
    const yr = escapeRegExp(String(year));
    s = s.replace(new RegExp(`^\\s*${yr}\\s+`, 'i'), '').trim();
  } else {
    s = s.replace(/^\s*(19|20)\d{2}\s+/, '').trim();
  }

  // Remove leading make if it already exists (avoid "Porsche Porsche ...")
  if (make) {
    const mk = String(make).trim();
    if (mk) s = s.replace(new RegExp(`^\\s*${escapeRegExp(mk)}\\s+`, 'i'), '').trim();
  }

  // Collapse whitespace + trim dangling separators
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[-–—]\s*$/g, '').trim();
  return s;
}

function extractTransmissionFromHtml(html: string): string | undefined {
  const h = String(html || '');
  // Most common: list items in "Vehicle Details"
  const m1 =
    h.match(/>\s*Transmission\s*:\s*<\/[^>]+>\s*([^<]{2,80})</i) ||
    h.match(/\bTransmission\s*:\s*([^<\n\r]{2,80})/i);
  const raw = m1?.[1] ? String(m1[1]).replace(/\s+/g, ' ').trim() : '';
  if (!raw) return undefined;

  // Avoid capturing obvious page boilerplate
  if (/bring a trailer|bat auctions/i.test(raw)) return undefined;
  return raw;
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    // Normalize path for BaT listings to end with a trailing slash
    if (!u.pathname.endsWith('/')) u.pathname = `${u.pathname}/`;
    return u.toString();
  } catch {
    // Fallback: best-effort strip fragments/query
    return String(raw).split('#')[0].split('?')[0];
  }
}

function coalesceString(...vals: any[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function parseBatIdentityFromUrl(batUrl: string): { year: number; make: string; model: string } | null {
  try {
    const u = new URL(batUrl);
    const m = u.pathname.match(/\/listing\/(\d{4})-([a-z0-9-]+)-(\d+)\/?$/i);
    if (!m?.[1] || !m?.[2]) return null;
    const year = Number(m[1]);
    if (!Number.isFinite(year) || year < 1885 || year > new Date().getFullYear() + 1) return null;

    const parts = String(m[2]).split('-').filter(Boolean);
    if (parts.length < 2) return null;
    const make = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();

    const model = parts
      .slice(1)
      .map((p) => {
        const s = p.toLowerCase();
        // Keep common BaT URL tokens in their natural casing
        if (s === '4s') return '4S';
        if (s === 'gt3') return 'GT3';
        if (s === 'rs') return 'RS';
        if (s === 'turbo') return 'Turbo';
        return p.toUpperCase() === p ? p : (p.charAt(0).toUpperCase() + p.slice(1));
      })
      .join(' ')
      .trim();

    return { year, make, model: model || 'Unknown' };
  } catch {
    return null;
  }
}

function parseBatAuctionEndDateFromText(text: string): string | null {
  // Best-effort: BaT page titles often include "ending December 16"
  const t = String(text || '');
  const m = t.match(/\bending\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/i);
  if (!m?.[1] || !m?.[2]) return null;
  const monthName = m[1].toLowerCase();
  const day = Number(m[2]);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;

  const monthIndex = [
    'january','february','march','april','may','june','july','august','september','october','november','december'
  ].indexOf(monthName);
  if (monthIndex < 0) return null;

  const now = new Date();
  let year = now.getUTCFullYear();
  // If the month/day looks far in the past relative to now, assume next year (e.g., importing in late Dec for Jan listings).
  const candidate = new Date(Date.UTC(year, monthIndex, day));
  const diffDays = (candidate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (diffDays < -120) year += 1;

  const yyyy = String(year);
  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseBatLiveMetricsFromHtml(html: string): {
  currentBid: number | null;
  bidCount: number | null;
  watcherCount: number | null;
  viewCount: number | null;
  commentCount: number | null;
} {
  const h = String(html || '');
  const asInt = (s: string | undefined): number | null => {
    if (!s) return null;
    const n = Number(String(s).replace(/[^\d]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const bid = (() => {
    const m = h.match(/Current Bid:\s*(?:USD\s*)?\$([\d,]+)/i) || h.match(/\bCurrent Bid\b[\s\S]{0,80}?\$([\d,]+)/i);
    const n = asInt(m?.[1]);
    return n;
  })();

  const watchers = (() => {
    const m = h.match(/\b([\d,]+)\s+watchers?\b/i);
    return asInt(m?.[1]);
  })();

  const views = (() => {
    const m = h.match(/\b([\d,]+)\s+views?\b/i);
    return asInt(m?.[1]);
  })();

  const comments = (() => {
    const m = h.match(/\b([\d,]+)\s+comments?\b/i);
    return asInt(m?.[1]) ?? 0;
  })();

  const bidCount = (() => {
    // BaT doesn't always show bid count explicitly; counting "bid placed by" in comment flow is a decent proxy.
    const n = (h.match(/bid placed by/gi) || []).length;
    return n > 0 ? n : null;
  })();

  return {
    currentBid: bid,
    bidCount,
    watcherCount: watchers,
    viewCount: views,
    commentCount: comments,
  };
}

function parseBatResultHighBidFromHtml(html: string): number | null {
  const h = String(html || '');
  const asInt = (s: string | undefined): number | null => {
    if (!s) return null;
    const n = Number(String(s).replace(/[^\d]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  // Common on results pages:
  // - "High Bid | USD $29,250"
  // - "Bid to USD $29,250 on 12/14/25"
  // - "High Bid      | USD $29,250 (Reserve Not Met)"
  const patterns: RegExp[] = [
    /\bHigh Bid\b[\s\S]{0,120}?\bUSD\s*\$([\d,]+)/i,
    /\bBid to\b[\s\S]{0,60}?\bUSD\s*\$([\d,]+)/i,
    /\bHigh Bid\b[\s\S]{0,120}?\$([\d,]+)/i,
    /\bBid to\b[\s\S]{0,60}?\$([\d,]+)/i,
  ];
  for (const re of patterns) {
    const m = h.match(re);
    const n = asInt(m?.[1]);
    if (n && n > 0) return n;
  }
  return null;
}

function parseBatResultEndDateFromHtml(html: string): string | null {
  const h = String(html || '');
  // Example: "Bid to USD $29,250 on 12/14/25"
  const m =
    h.match(/\bBid to\b[\s\S]{0,80}?\bon\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i) ||
    h.match(/\bAuction Ended\b[\s\S]{0,80}?\bon\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i) ||
    null;
  if (!m?.[1]) return null;
  const d = new Date(m[1]);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

async function tryFirecrawlHtml(url: string): Promise<{ html: string; title: string } | null> {
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlApiKey) return null;
  try {
    const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlApiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['html', 'markdown'],
        onlyMainContent: false,
        waitFor: 6500,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    if (!j?.success) return null;
    return {
      html: String(j?.data?.html || ''),
      title: String(j?.data?.metadata?.title || ''),
    };
  } catch {
    return null;
  }
}

function looksWrongMake(make: any): boolean {
  const m = String(make || '').trim();
  if (!m) return true;
  if (m.length > 30) return true;
  if (/mile/i.test(m)) return true;
  if (/bring a trailer/i.test(m)) return true;
  return false;
}

function looksWrongModel(model: any): boolean {
  const s = String(model || '').trim();
  if (!s) return true;
  if (/bring a trailer/i.test(s)) return true;
  if (/on\s+bat\s+auctions/i.test(s)) return true;
  if (s.length > 80) return true;
  return false;
}

function extractSellerTypeFromHtml(html: string): string | undefined {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  // BaT essentials sometimes include "Seller: Dealer" / "Seller: Private Party"
  const m =
    text.match(/\bSeller\s*:\s*(Dealer|Private\s*Party|Individual|Dealer\/Broker|Broker)\b/i) ||
    text.match(/\bSeller\s+Type\s*:\s*(Dealer|Private\s*Party|Individual|Dealer\/Broker|Broker)\b/i);
  if (!m) return undefined;
  const v = m[1].toLowerCase().replace(/\s+/g, ' ').trim();
  if (v.includes('dealer') || v.includes('broker')) return 'dealer';
  if (v.includes('private') || v.includes('individual')) return 'private_party';
  return 'unknown';
}

function extractSellerUsernameFromHtml(html: string): string | null {
  // Common patterns:
  // - "Sold by username"
  // - "Sold by <a href=\"/member/username/\">..."
  const m1 = html.match(/Sold by\s+([A-Za-z0-9_]+)/i);
  if (m1?.[1]) return m1[1];
  const m2 = html.match(/Sold by[\s\S]{0,250}?\/member\/([^\/"'?]+)\//i);
  if (m2?.[1]) {
    try {
      return decodeURIComponent(m2[1]);
    } catch {
      return m2[1];
    }
  }
  return null;
}

function extractBatGalleryImagesFromHtml(html: string): string[] {
  // DEPRECATED: This function is kept for backward compatibility but should not be used.
  // The canonical extractor is in _shared/batDomMap.ts which uses data-gallery-items only.
  // This regex-based approach was too greedy and captured images from related auctions.
  // If DOM map extraction fails, it's better to return empty than risk contamination.
  console.warn('[import-bat-listing] extractBatGalleryImagesFromHtml called - this should use DOM map extractor instead');
  return [];
}

function extractBuyerUsernameFromHtml(html: string): string | null {
  // Best-effort; buyer is less consistently linked.
  const m1 = html.match(/to\s+([A-Za-z0-9_]+)\s+for/i);
  if (m1?.[1]) return m1[1];
  const m2 = html.match(/to[\s\S]{0,250}?\/member\/([^\/"'?]+)\//i);
  if (m2?.[1]) {
    try {
      return decodeURIComponent(m2[1]);
    } catch {
      return m2[1];
    }
  }
  return null;
}

async function findLocalPartnerBusinessIdByBatUsername(
  supabase: any,
  batUsername: string | null,
): Promise<string | null> {
  const u = typeof batUsername === 'string' ? batUsername.trim() : '';
  if (!u) return null;

  // Local Partners indexer stores:
  // businesses.metadata.bat_local_partners.bat_username
  // Use a JSON-path filter; PostgREST supports this syntax.
  const { data, error } = await supabase
    .from('businesses')
    .select('id')
    .eq('metadata->bat_local_partners->>bat_username', u)
    .limit(1);

  if (!error && Array.isArray(data) && data[0]?.id) return data[0].id;

  // Best-effort fallback: case-insensitive match
  const { data: dataIlike, error: errorIlike } = await supabase
    .from('businesses')
    .select('id')
    .ilike('metadata->bat_local_partners->>bat_username', u)
    .limit(1);

  if (!errorIlike && Array.isArray(dataIlike) && dataIlike[0]?.id) return dataIlike[0].id;
  return null;
}

async function upsertBatUser(
  supabase: any,
  username: string | null,
): Promise<{ id: string | null; username: string | null; profile_url: string | null }> {
  const u = username ? username.trim() : '';
  if (!u) return { id: null, username: null, profile_url: null };
  const profileUrl = `https://bringatrailer.com/member/${encodeURIComponent(u)}/`;

  // `bat_users.bat_username` is UNIQUE (see migrations). This creates a stable UUID identity
  // that can later be linked to a real N-Zero user via `n_zero_user_id` (claim flow).
  const { data, error } = await supabase
    .from('bat_users')
    .upsert(
      {
        bat_username: u,
        bat_profile_url: profileUrl,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'bat_username' },
    )
    .select('id, bat_username, bat_profile_url')
    .single();

  if (error) {
    console.log('bat_users upsert failed (non-fatal):', error.message);
    return { id: null, username: u, profile_url: profileUrl };
  }

  return { id: data?.id || null, username: data?.bat_username || u, profile_url: data?.bat_profile_url || profileUrl };
}

async function upsertExternalIdentity(
  supabase: any,
  platform: string,
  handleRaw: string | null,
  profileUrl: string | null,
): Promise<string | null> {
  const handle = handleRaw ? handleRaw.trim() : '';
  if (!handle) return null;
  const nowIso = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from('external_identities')
      .upsert(
        {
          platform: String(platform || '').toLowerCase(),
          handle,
          profile_url: profileUrl,
          last_seen_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'platform,handle' },
      )
      .select('id')
      .single();
    if (error) {
      console.log('external_identities upsert failed (non-fatal):', error.message);
      return null;
    }
    return data?.id || null;
  } catch (e: any) {
    console.log('external_identities upsert error (non-fatal):', e?.message || String(e));
    return null;
  }
}

async function touchBatUserProfile(supabase: any, usernameRaw: string | null) {
  const username = (usernameRaw || '').trim();
  if (!username) return;
  const nowIso = new Date().toISOString();
  try {
    // Update-first to avoid overwriting `first_seen` if the row exists.
    const { data: updated, error: updErr } = await supabase
      .from('bat_user_profiles')
      .update({ last_seen: nowIso, updated_at: nowIso })
      .eq('username', username)
      .select('username')
      .maybeSingle();

    if (!updErr && updated?.username) return;

    const { error: insErr } = await supabase
      .from('bat_user_profiles')
      .insert({ username, first_seen: nowIso, last_seen: nowIso, updated_at: nowIso });

    // Non-fatal if table is missing or row already exists (race).
    if (insErr) {
      const code = String((insErr as any)?.code || '').toUpperCase();
      const status = (insErr as any)?.status ?? (insErr as any)?.statusCode;
      const msg = String((insErr as any)?.message || '').toLowerCase();
      if (status === 404 || code === '42P01' || msg.includes('does not exist') || msg.includes('not found')) return;
    }
  } catch {
    // ignore
  }
}

function toIsoEndOfDay(dateYmd: string | null): string | null {
  if (!dateYmd) return null;
  const d = new Date(`${dateYmd}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

function toIsoMidday(dateYmd: string | null): string | null {
  if (!dateYmd) return null;
  const d = new Date(`${dateYmd}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

async function upsertAuctionEvent(opts: {
  supabase: any;
  vehicle_id: string;
  source: string;
  source_url: string;
  outcome: string;
  high_bid: number | null;
  auction_start_date: string | null; // YYYY-MM-DD
  auction_end_date: string | null; // YYYY-MM-DD
  metadata: any;
}): Promise<string | null> {
  const { supabase, vehicle_id, source, source_url, outcome, high_bid, auction_start_date, auction_end_date, metadata } = opts;
  const nowIso = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from('auction_events')
      .upsert(
        {
          vehicle_id,
          source,
          source_url,
          outcome,
          high_bid,
          auction_start_date: toIsoMidday(auction_start_date),
          auction_end_date: toIsoEndOfDay(auction_end_date),
          raw_data: metadata && typeof metadata === 'object' ? metadata : {},
          updated_at: nowIso,
        },
        // matches existing UNIQUE index: (vehicle_id, source_url)
        { onConflict: 'vehicle_id,source_url' },
      )
      .select('id')
      .maybeSingle();
    if (error) {
      console.log('auction_events upsert failed (non-fatal):', error.message);
      return null;
    }
    return data?.id ? String(data.id) : null;
  } catch (e: any) {
    console.log('auction_events upsert error (non-fatal):', e?.message || String(e));
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { bat_auction_url, auction_url, source_url, import_images = true, force_reimport = false } = payload;
    
    // Accept multiple URL parameter names for flexibility
    const auctionUrl = bat_auction_url || auction_url || source_url;
    
    if (!auctionUrl) {
      throw new Error('Missing auction URL parameter (bat_auction_url, auction_url, or source_url)');
    }
    
    console.log(`Processing auction URL: ${auctionUrl}`);
    
    // Detect auction site and use appropriate extraction method
    const siteType = detectAuctionSite(auctionUrl);
    console.log(`Detected auction site: ${siteType}`);
    
    // Route to appropriate extraction method
    switch (siteType) {
      case 'bringatrailer':
        return await extractBaTListing(auctionUrl, import_images, force_reimport);
      case 'carsandbids':
        return await extractCarsAndBidsListing(auctionUrl, import_images);
      case 'mecum':
        return await extractMecumListing(auctionUrl, import_images);
      case 'barrettjackson':
        return await extractBarrettJacksonListing(auctionUrl, import_images);
      case 'russoandsteele':
        return await extractRussoAndSteeleListing(auctionUrl, import_images);
      default:
        return await extractGenericAuctionListing(auctionUrl, import_images, siteType);
    }
  } catch (error) {
    console.error('Error in import-bat-listing:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Site detection function
function detectAuctionSite(url: string): string {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    
    if (domain.includes('bringatrailer.com')) return 'bringatrailer';
    if (domain.includes('carsandbids.com')) return 'carsandbids';
    if (domain.includes('mecum.com')) return 'mecum';
    if (domain.includes('barrett-jackson.com')) return 'barrettjackson';
    if (domain.includes('russoandsteele.com')) return 'russoandsteele';
    if (domain.includes('rmsothebys.com')) return 'rmsothebys';
    if (domain.includes('bonhams.com')) return 'bonhams';
    if (domain.includes('goodingco.com')) return 'gooding';
    
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// Cars & Bids extraction with DOM mapping
async function extractCarsAndBidsListing(url: string, importImages: boolean) {
  console.log('Extracting Cars & Bids listing with custom DOM mapping...');
  
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) {
    throw new Error('FIRECRAWL_API_KEY not configured');
  }
  
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['html', 'extract'],
      extract: {
        schema: {
          vehicle: {
            type: "object",
            properties: {
              year: { type: "number", description: "Vehicle year" },
              make: { type: "string", description: "Vehicle make/brand" },
              model: { type: "string", description: "Vehicle model" },
              title: { type: "string", description: "Full vehicle title" },
              description: { type: "string", description: "Vehicle description" },
              current_bid: { type: "number", description: "Current highest bid" },
              reserve_met: { type: "boolean", description: "Whether reserve price is met" },
              seller: { type: "string", description: "Seller name/username" },
              location: { type: "string", description: "Vehicle location" },
              images: { 
                type: "array", 
                items: { type: "string" },
                description: "Array of image URLs"
              }
            }
          }
        }
      }
    })
  });
  
  if (!response.ok) {
    throw new Error(`Cars & Bids extraction failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  return new Response(JSON.stringify({
    success: true,
    source: 'Cars & Bids',
    site_type: 'carsandbids',
    extraction_method: 'firecrawl_structured',
    vehicle_data: data.data?.extract?.vehicle || {},
    raw_html_length: data.data?.html?.length || 0,
    timestamp: new Date().toISOString()
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Mecum extraction with DOM mapping
async function extractMecumListing(url: string, importImages: boolean) {
  console.log('Extracting Mecum listing with custom DOM mapping...');
  
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['extract'],
      extract: {
        schema: {
          vehicle: {
            type: "object",
            properties: {
              year: { type: "number", description: "Vehicle year" },
              make: { type: "string", description: "Vehicle make" },
              model: { type: "string", description: "Vehicle model" },
              lot_number: { type: "string", description: "Mecum lot number" },
              estimate_low: { type: "number", description: "Low estimate" },
              estimate_high: { type: "number", description: "High estimate" },
              description: { type: "string", description: "Lot description" },
              engine: { type: "string", description: "Engine description" },
              transmission: { type: "string", description: "Transmission type" },
              images: { 
                type: "array", 
                items: { type: "string" },
                description: "Vehicle image URLs"
              }
            }
          }
        }
      }
    })
  });
  
  const data = await response.json();
  
  return new Response(JSON.stringify({
    success: true,
    source: 'Mecum Auctions',
    site_type: 'mecum',
    extraction_method: 'firecrawl_structured',
    vehicle_data: data.data?.extract?.vehicle || {},
    timestamp: new Date().toISOString()
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Barrett-Jackson extraction
async function extractBarrettJacksonListing(url: string, importImages: boolean) {
  console.log('Extracting Barrett-Jackson listing...');
  
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['extract'],
      extract: {
        schema: {
          vehicle: {
            year: "Vehicle year",
            make: "Vehicle make",
            model: "Vehicle model", 
            description: "Vehicle description",
            estimate: "Auction estimate"
          }
        }
      }
    })
  });
  
  const data = await response.json();
  
  return new Response(JSON.stringify({
    success: true,
    source: 'Barrett-Jackson',
    site_type: 'barrettjackson',
    vehicle_data: data.data?.extract?.vehicle || {},
    timestamp: new Date().toISOString()
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Russo & Steele extraction  
async function extractRussoAndSteeleListing(url: string, importImages: boolean) {
  return new Response(JSON.stringify({
    success: true,
    source: 'Russo and Steele',
    site_type: 'russoandsteele', 
    vehicle_data: { note: 'Russo & Steele DOM mapping not implemented yet' },
    timestamp: new Date().toISOString()
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Generic auction site extraction
async function extractGenericAuctionListing(url: string, importImages: boolean, siteType: string) {
  console.log(`Generic extraction for ${siteType}...`);
  
  return new Response(JSON.stringify({
    success: true,
    source: siteType,
    site_type: 'generic',
    vehicle_data: { note: `Generic extraction for ${siteType} - needs specific DOM mapping` },
    timestamp: new Date().toISOString()
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// START OF ORIGINAL BAT FUNCTION
async function extractBaTListing(bat_auction_url: string, import_images: boolean, force_reimport: boolean) {
  // Keep existing BaT extraction logic below this point...
    // Backwards/compat: accept {listingUrl}, {batUrl}, {bat_url}, {url}
    const batUrlRaw = coalesceString(payload?.listingUrl, payload?.batUrl, payload?.bat_url, payload?.url);
    // Optional: when provided, this is the SELLER business id to link the listing to (public.businesses.id).
    // For safety we don't auto-link unless the listing indicates a dealer OR the caller explicitly forces linking.
    const organizationId = coalesceString(payload?.organizationId, payload?.organization_id);
    const forceDealerLink = payload?.forceDealerLink === true;
    // Safety: fuzzy match is a major contamination source; default off.
    const allowFuzzyMatch = payload?.allowFuzzyMatch === true;
    const imageBatchSize = Math.max(10, Math.min(100, Number(payload?.imageBatchSize || 50)));

    if (!batUrlRaw) {
      return new Response(
        JSON.stringify({ error: 'batUrl (or url) required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const batUrl = normalizeUrl(batUrlRaw);
    console.log(`Fetching BaT listing: ${batUrl}`);

    // IMPORTANT: BaT is JS-driven; static HTML often omits live bid/comment/watch counts.
    // Prefer Firecrawl-rendered HTML when available, then fall back to direct fetch.
    const firecrawl = await tryFirecrawlHtml(batUrl);
    let html = '';
    let title = '';

    if (firecrawl?.html) {
      html = firecrawl.html;
      title = String(firecrawl.title || '').trim();
    }

    if (!html) {
      const response = await fetch(batUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; N-Zero Bot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      });
      html = await response.text();
    }

    // Parse title (h1 is the most reliable on BaT listing pages)
    if (!title) {
      const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      const pageTitleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = (h1Match?.[1] || pageTitleMatch?.[1] || '').trim();
    }

    // Canonical deterministic DOM-map extraction (shared across health checks + ingestion).
    // This is our "stable template" for BaT.
    const dom = extractBatDomMap(html, batUrl);
    const domExtracted = dom?.extracted;
    const domHealth = dom?.health;

    // Identity: prefer URL pattern (most reliable on BaT)
    const fromUrl = parseBatIdentityFromUrl(batUrl);
    const year = fromUrl?.year || 0;
    const make = fromUrl?.make || '';
    const model = fromUrl?.model || '';

    // Clean the visible page title down to just the identity portion.
    // This prevents polluting trim/model with "on BaT Auctions - ending ... | Bring a Trailer".
    const cleanedTitle = cleanListingishTitle(title, year || null, make || null);

    // Basic trim: remove leading year/make/model tokens from the cleaned title.
    // If there's nothing left, trim is undefined.
    const trim = (() => {
      const t = String(cleanedTitle || '').trim();
      if (!t || !year || !make || !model) return undefined;
      const prefix = new RegExp(`^\\s*${escapeRegExp(String(year))}\\s+${escapeRegExp(String(make))}\\s+${escapeRegExp(String(model))}\\s+`, 'i');
      const rest = t.replace(prefix, '').trim();
      // Guardrails: trim should be short + not contain obvious boilerplate
      if (!rest) return undefined;
      if (rest.length > 60) return undefined;
      if (/bat auctions|bring a trailer|ending\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(rest)) return undefined;
      return rest;
    })();

    const isSoldFor = /Sold for/i.test(html) || /\bSold for\b/i.test(title);
    const isAuctionResult =
      /\bAuction Result\b/i.test(html) ||
      /\bView Result\b/i.test(html) ||
      /\bBid to\b/i.test(html) ||
      /\bgot away\b/i.test(html);
    const reserveNotMet = /\bReserve Not Met\b/i.test(html) || /\bReserve Not Met\b/i.test(title);
    const auctionOutcome: 'active' | 'sold' | 'reserve_not_met' | 'ended' | 'no_sale' =
      isSoldFor ? 'sold' :
      isAuctionResult ? (reserveNotMet ? 'reserve_not_met' : 'ended') :
      'active';

    let metrics = parseBatLiveMetricsFromHtml(html);
    // If parsing yields no meaningful signal, try Firecrawl once more (in case we fell back to static HTML).
    if (!metrics.currentBid && !metrics.watcherCount && !metrics.viewCount && (metrics.commentCount === null || metrics.commentCount === 0)) {
      const fc2 = firecrawl?.html ? null : await tryFirecrawlHtml(batUrl);
      if (fc2?.html) {
        const m2 = parseBatLiveMetricsFromHtml(fc2.html);
        if (m2.currentBid || m2.watcherCount || m2.viewCount || (typeof m2.commentCount === 'number' && m2.commentCount > 0)) {
          metrics = m2;
        }
      }
    }
    const auctionEndDate = parseBatAuctionEndDateFromText(title) || parseBatAuctionEndDateFromText(html);

    // Extract sale price/date (sold listings only)
    const priceText = isSoldFor ? html.match(/Sold for[\s\S]{0,100}?USD\s*\$([\d,]+)/i) : null;
    const salePrice = priceText?.[1] ? parseInt(priceText[1].replace(/,/g, '')) : 0;

    const dateText = isSoldFor ? html.match(/\b(?:sold|ended)\b[\s\S]{0,200}?\bon\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i) : null;
    const saleDate =
      (dateText?.[1] ? new Date(dateText[1]).toISOString().split('T')[0] : null) ||
      parseBatResultEndDateFromHtml(html) ||
      new Date().toISOString().split('T')[0];

    // Final/high bid (results pages). Keep separate from salePrice: reserve-not-met pages still have a meaningful high bid.
    const resultHighBid = auctionOutcome !== 'active' ? parseBatResultHighBidFromHtml(html) : null;
    if (!metrics.currentBid && resultHighBid) {
      metrics = { ...metrics, currentBid: resultHighBid };
    }

    // Extract description (DOM-map first; regex fallback last)
    const descFromDom = typeof domExtracted?.description_text === 'string' ? domExtracted.description_text.trim() : '';
    const descMatch = html.match(/<p>([^<]{100,500})<\/p>/);
    const description = descFromDom || (descMatch ? descMatch[1].trim() : '');

    // Extract seller/buyer
    const seller = (domExtracted?.seller_username || extractSellerUsernameFromHtml(html)) || null;
    const buyer = (domExtracted?.buyer_username || extractBuyerUsernameFromHtml(html)) || null;
    const sellerType = extractSellerTypeFromHtml(html);

    // Extract lot number
    const lotMatch = html.match(/Lot.*?#(\d+)/);
    const lotNumber = (domExtracted?.lot_number || (lotMatch ? lotMatch[1] : '') || '').trim();

    // Listing location (time-sensitive observation)
    const listingLocationRaw = (domExtracted?.location_raw || null);
    const listingLocationClean = (domExtracted?.location_clean || null);

    // Extract VIN - BaT uses both "VIN:" and "Chassis:" labels
    const vinMatch = html.match(/(?:VIN|Chassis)[:\s]+([A-HJ-NPR-Z0-9]{17})/i) ||
                     html.match(/<li>Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{17})<\/a><\/li>/i);
    const vin = vinMatch ? vinMatch[1].toUpperCase() : undefined;

    // Extract transmission (collector signal; keeps manual cars discoverable)
    const transmission = extractTransmissionFromHtml(html);

    const listing: BaTListing = {
      url: batUrl,
      title,
      year,
      make,
      model,
      trim,
      transmission,
      vin,
      salePrice,
      saleDate,
      description,
      seller,
      sellerType,
      buyer,
      lotNumber
    };

    console.log('Parsed listing:', JSON.stringify(listing));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SERVICE_KEY') ||
      '';

    // Create stable claimable identities for seller/buyer as BaT users (UUIDs in bat_users)
    const [sellerUser, buyerUser] = await Promise.all([
      upsertBatUser(supabase, seller || null),
      upsertBatUser(supabase, buyer || null),
    ]);

    // Also upsert external_identities (platform+handle) so later real users can claim them.
    const [sellerExternalIdentityId, buyerExternalIdentityId] = await Promise.all([
      upsertExternalIdentity(supabase, 'bat', sellerUser?.username || null, sellerUser?.profile_url || null),
      upsertExternalIdentity(supabase, 'bat', buyerUser?.username || null, buyerUser?.profile_url || null),
    ]);

    // Build/refresh public bidder profiles immediately (seller + buyer are participants even if we don't have bid history here).
    await Promise.all([
      touchBatUserProfile(supabase, sellerUser?.username || null),
      touchBatUserProfile(supabase, buyerUser?.username || null),
    ]);

    // Determine whether we can/should link this listing to a seller organization (public.businesses).
    // 1) If caller provided organizationId, treat it as the intended seller business id.
    // 2) Else, if seller matches a Local Partner BaT username, auto-link to that org.
    let sellerOrganizationId: string | null = organizationId;
    let sellerOrgDiscoveredViaLocalPartners = false;
    if (!sellerOrganizationId && sellerUser?.username) {
      sellerOrganizationId = await findLocalPartnerBusinessIdByBatUsername(supabase, sellerUser.username);
      sellerOrgDiscoveredViaLocalPartners = !!sellerOrganizationId;
    }

    const shouldLinkSellerOrg =
      !!sellerOrganizationId && (sellerType === 'dealer' || forceDealerLink || sellerOrgDiscoveredViaLocalPartners);

    let vehicleId: string | null = null;
    let createdVehicle = false;
    
    // First: idempotent match by BaT URL (best signal when VIN is absent/unreliable).
    {
      const { data: existingByBatUrl, error: byBatErr } = await supabase
        .from('vehicles')
        .select('id')
        .eq('bat_auction_url', batUrl)
        .maybeSingle();
      if (byBatErr) {
        console.log('BaT URL match query failed (continuing):', byBatErr.message);
      } else if (existingByBatUrl?.id) {
        vehicleId = existingByBatUrl.id;
        console.log(`Found existing vehicle by bat_auction_url: ${vehicleId}`);
      }
    }

    // Fallback: match by discovery_url or listing_url (some older imports only set those)
    if (!vehicleId) {
      const { data: existingByDiscoveryUrl, error: discErr } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', batUrl)
        .maybeSingle();
      if (!discErr && existingByDiscoveryUrl?.id) {
        vehicleId = existingByDiscoveryUrl.id;
        console.log(`Found existing vehicle by discovery_url: ${vehicleId}`);
      }
    }
    if (!vehicleId) {
      const { data: existingByListingUrl, error: listErr } = await supabase
        .from('vehicles')
        .select('id')
        .eq('listing_url', batUrl)
        .maybeSingle();
      if (!listErr && existingByListingUrl?.id) {
        vehicleId = existingByListingUrl.id;
        console.log(`Found existing vehicle by listing_url: ${vehicleId}`);
      }
    }

    if (vin) {
      const { data: existingVehicle } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', vin)
        .single();
      
      if (existingVehicle) {
        vehicleId = existingVehicle.id;
        console.log(`Found existing vehicle by VIN: ${vehicleId}`);
      }
    }

    if (!vehicleId && allowFuzzyMatch) {
      const { data: fuzzyMatches } = await supabase
        .from('vehicles')
        .select('id, vin, year, make, model')
        .eq('year', year)
        .ilike('make', `%${make}%`)
        .ilike('model', `%${model.split(' ')[0]}%`)
        .limit(1);
      
      if (fuzzyMatches && fuzzyMatches.length > 0) {
        vehicleId = fuzzyMatches[0].id;
        console.log(`Fuzzy matched to existing vehicle: ${vehicleId}`);
      }
    }

    if (vehicleId) {
      const { data: currentVehicle } = await supabase
        .from('vehicles')
        .select('year, make, model, vin, description, listing_title, listing_location, listing_location_raw, listing_location_source, origin_metadata')
        .eq('id', vehicleId)
        .maybeSingle();

      const updateData: any = {
        // For live auctions, avoid poisoning the canonical sale fields.
        ...(auctionOutcome === 'sold' ? { sale_price: salePrice, sale_date: saleDate, sale_status: 'sold' } : {}),
        ...(auctionOutcome !== 'active' && auctionOutcome !== 'sold' ? { sale_date: saleDate, sale_status: 'ended' } : {}),
        trim: trim || undefined,
        // Description: only overwrite when we have real BaT description text (avoid poisoning with empty strings).
        ...(description && description.length > 40 && (!currentVehicle?.description || String(currentVehicle.description || '').trim().length < 40)
          ? { description: description, description_source: 'bat', description_generated_at: null }
          : {}),
        transmission: transmission || undefined,
        ...(auctionOutcome !== 'active' ? { auction_outcome: auctionOutcome } : { auction_outcome: 'pending' }),
        ...(typeof resultHighBid === 'number' && resultHighBid > 0 ? { high_bid: resultHighBid } : {}),
        ...(typeof metrics.bidCount === 'number' && metrics.bidCount > 0 ? { bid_count: metrics.bidCount } : {}),
        bat_auction_url: batUrl,
        listing_url: batUrl,
        discovery_url: batUrl,
        ...(domExtracted?.title && !currentVehicle?.listing_title ? { listing_title: domExtracted.title } : {}),
        // Keep the human-readable seller (legacy fields)
        bat_seller: seller || null,
        // Store the claimable BaT identity IDs in origin_metadata (no schema change required)
        origin_metadata: {
          ...((currentVehicle as any)?.origin_metadata && typeof (currentVehicle as any).origin_metadata === 'object' ? (currentVehicle as any).origin_metadata : {}),
          source: 'bat_import',
          bat_url: batUrl,
          raw_title: title || null,
          cleaned_title: cleanedTitle || null,
          derived_trim: trim || null,
          extracted_transmission: transmission || null,
          dom_map_health_v1: domHealth
            ? {
                overall_score: domHealth.overall_score,
                counts: domHealth.counts,
                fields: Object.fromEntries(Object.entries(domHealth.fields || {}).map(([k, v]: any) => [k, { ok: v?.ok, method: v?.method }])),
              }
            : null,
          location: listingLocationClean || listingLocationRaw || null,
          bat_seller_username: sellerUser.username,
          bat_seller_user_id: sellerUser.id,
          bat_seller_profile_url: sellerUser.profile_url,
          bat_buyer_username: buyerUser.username,
          bat_buyer_user_id: buyerUser.id,
          bat_buyer_profile_url: buyerUser.profile_url,
          bat_seller_type: sellerType || null,
          seller_business_id: sellerOrganizationId,
          seller_business_linked: shouldLinkSellerOrg,
          // Keep the URL-derived identity as a stable fallback for bad backfills.
          url_identity: fromUrl || null,
          // Store basic live telemetry for UI even if other pipelines fail.
          live_metrics: {
            current_bid: metrics.currentBid,
            bid_count: metrics.bidCount,
            watcher_count: metrics.watcherCount,
            view_count: metrics.viewCount,
            comment_count: metrics.commentCount,
            auction_end_date: auctionEndDate,
          },
          auction_outcome: auctionOutcome,
          imported_at: new Date().toISOString(),
        },
      };

      // Location snapshot fields (safe, source-aware; do not overwrite an existing non-bat location)
      if (listingLocationClean || listingLocationRaw) {
        const shouldWriteLocation =
          !currentVehicle?.listing_location ||
          !currentVehicle?.listing_location_source ||
          String(currentVehicle.listing_location_source) === 'bat';
        if (shouldWriteLocation) {
          updateData.listing_location = listingLocationClean || listingLocationRaw;
          updateData.listing_location_raw = listingLocationRaw || listingLocationClean;
          updateData.listing_location_source = 'bat';
          updateData.listing_location_confidence = 0.8;
          updateData.listing_location_observed_at = toIsoMidday(domExtracted?.auction_start_date || auctionEndDate || saleDate) || new Date().toISOString();
        }
      }
      
      // Repair identity for known-bad backfills (do not override good data)
      if (fromUrl) {
        if (!currentVehicle?.year || currentVehicle.year === 0) updateData.year = fromUrl.year;
        if (looksWrongMake(currentVehicle?.make)) updateData.make = fromUrl.make;
        if (looksWrongModel(currentVehicle?.model)) updateData.model = fromUrl.model;
      }

      // Update VIN if we found one and vehicle doesn't have one, or if it matches (to avoid conflicts)
      if (vin && (!currentVehicle?.vin || currentVehicle.vin === vin)) {
        updateData.vin = vin;
      }
      
      await supabase
        .from('vehicles')
        .update(updateData)
        .eq('id', vehicleId);

      // Optional seller org update when we are confident this listing belongs to a seller business.
      if (sellerOrganizationId && shouldLinkSellerOrg) {
        await supabase
          .from('organization_vehicles')
          .update({
            sale_price: salePrice,
            sale_date: saleDate,
            listing_status: 'sold'
          })
          .eq('vehicle_id', vehicleId)
          .eq('organization_id', sellerOrganizationId);
      }

      console.log(`Updated existing vehicle: ${vehicleId}`);
    } else {
      const { data: newVehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert({
          year,
          make,
          model,
          trim,
          transmission,
          vin,
          sale_price: salePrice,
          sale_date: saleDate,
          description,
          ...(domExtracted?.title ? { listing_title: domExtracted.title } : {}),
          ...(listingLocationClean || listingLocationRaw
            ? {
                listing_location: listingLocationClean || listingLocationRaw,
                listing_location_raw: listingLocationRaw || listingLocationClean,
                listing_location_source: 'bat',
                listing_location_confidence: 0.8,
                listing_location_observed_at: toIsoMidday(domExtracted?.auction_start_date || auctionEndDate || saleDate) || new Date().toISOString(),
              }
            : {}),
          ...(description && description.length > 40 ? { description_source: 'bat', description_generated_at: null } : {}),
          auction_outcome: salePrice > 0 ? 'sold' : 'reserve_not_met',
          bat_auction_url: batUrl,
          imported_by: null,
          listing_url: batUrl,
          discovery_url: batUrl,
          profile_origin: 'bat_import',
          discovery_source: 'bat_import',
          bat_seller: seller || null,
          origin_metadata: {
            source: 'bat_import',
            bat_url: batUrl,
            raw_title: title || null,
            cleaned_title: cleanedTitle || null,
            derived_trim: trim || null,
            extracted_transmission: transmission || null,
            dom_map_health_v1: domHealth
              ? {
                  overall_score: domHealth.overall_score,
                  counts: domHealth.counts,
                  fields: Object.fromEntries(Object.entries(domHealth.fields || {}).map(([k, v]: any) => [k, { ok: v?.ok, method: v?.method }])),
                }
              : null,
            location: listingLocationClean || listingLocationRaw || null,
            bat_seller_username: sellerUser.username,
            bat_seller_user_id: sellerUser.id,
            bat_seller_profile_url: sellerUser.profile_url,
            bat_buyer_username: buyerUser.username,
            bat_buyer_user_id: buyerUser.id,
            bat_buyer_profile_url: buyerUser.profile_url,
            bat_seller_type: sellerType || null,
            seller_business_id: sellerOrganizationId,
            seller_business_linked: shouldLinkSellerOrg,
            imported_at: new Date().toISOString(),
          }
        })
        .select()
        .single();

      if (vehicleError) {
        throw vehicleError;
      }

      vehicleId = newVehicle.id;
      createdVehicle = true;

      // Only link seller org when we are confident this listing belongs to a seller business.
      if (sellerOrganizationId && shouldLinkSellerOrg) {
        await supabase
          .from('organization_vehicles')
          .insert({
            organization_id: sellerOrganizationId,
            vehicle_id: vehicleId,
            relationship_type: 'sold_by',
            listing_status: 'sold',
            sale_price: salePrice,
            sale_date: saleDate
          });
      }

      console.log(`Created new vehicle: ${vehicleId}`);
    }

    // Persist a time-series location observation (best-effort)
    try {
      if (vehicleId && (listingLocationClean || listingLocationRaw)) {
        await supabase
          .from('vehicle_location_observations')
          .insert({
            vehicle_id: vehicleId,
            source_type: 'listing',
            source_platform: 'bat',
            source_url: batUrl,
            observed_at: toIsoMidday(domExtracted?.auction_start_date || auctionEndDate || saleDate) || new Date().toISOString(),
            location_text_raw: listingLocationRaw || listingLocationClean,
            location_text_clean: listingLocationClean || listingLocationRaw,
            precision: (String(listingLocationClean || listingLocationRaw || '').includes(',') ? 'region' : 'country'),
            confidence: 0.8,
            metadata: { source: 'import-bat-listing' },
          })
          .catch(() => null);
      }
    } catch {
      // ignore
    }

    // Ensure there's an auction_event row so comments/bids can attach and UI can stream them by vehicle_id.
    const auctionEventId = await upsertAuctionEvent({
      supabase,
      vehicle_id: vehicleId!,
      source: 'bat',
      source_url: batUrl,
      outcome: auctionOutcome,
      high_bid: (typeof resultHighBid === 'number' && resultHighBid > 0) ? resultHighBid : (metrics.currentBid || null),
      auction_start_date: domExtracted?.auction_start_date || null,
      auction_end_date: domExtracted?.auction_end_date || auctionEndDate || null,
      metadata: {
        lot_number: lotNumber || null,
        seller_username: seller || null,
        buyer_username: buyer || null,
      },
    });

    // Kick off comment ingestion (async, non-blocking). This is what makes bids/comments actually land in `auction_comments`.
    try {
      if (auctionEventId && serviceRoleKey) {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-auction-comments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ auction_url: batUrl, auction_event_id: auctionEventId, vehicle_id: vehicleId }),
        })
          .then(() => console.log('extract-auction-comments triggered'))
          .catch(() => null);
      }
    } catch {
      // ignore
    }

    // VIN extraction (text/HTML): run after we have a vehicle id.
    // This catches VINs embedded in the BaT HTML, description, or JSON blobs.
    // Also creates "VIN needed" notifications when extraction is not possible yet.
    try {
      if (vehicleId && serviceRoleKey) {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-vin-from-vehicle`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            vehicle_id: vehicleId,
            extra_text: html,
            notify_if_missing: true,
          }),
        })
          .then(() => console.log('VIN text extraction triggered'))
          .catch(() => null);
      }
    } catch {
      // Non-blocking
    }

    // Persist BaT gallery images into vehicle_images (fixes: "images show up via UI fallback but DB has 0 images").
    // IMPORTANT: Only use DOM map extracted images (data-gallery-items attribute).
    // Do NOT fall back to regex extraction - it captures images from related auctions and pollutes the gallery.
    try {
      const images = Array.isArray(domExtracted?.image_urls) ? domExtracted.image_urls : [];
      if (vehicleId && images.length > 0) {
        await supabase.functions.invoke('backfill-images', {
          body: {
            vehicle_id: vehicleId,
            image_urls: images,
            source: 'bat_import',
            run_analysis: false,
            max_images: 0,
            continue: true,
            sleep_ms: 150,
            max_runtime_ms: 25000,
          }
        });

        // Store for provenance + future repair/backfills.
        try {
          const { data: vrow } = await supabase
            .from('vehicles')
            .select('origin_metadata,primary_image_url,image_url')
            .eq('id', vehicleId)
            .maybeSingle();
          const om = (vrow?.origin_metadata && typeof vrow.origin_metadata === 'object') ? vrow.origin_metadata : {};
          const nextOm = {
            ...om,
            image_urls: images,
            image_count: images.length,
          };
          // ROBUST PRIMARY IMAGE SELECTION WITH FALLBACKS
          // Priority: 1) First valid image from gallery, 2) Existing primary, 3) null (will be set by backfill-images)
          const primary = images[0] || vrow?.primary_image_url || null;
          const updates: any = { origin_metadata: nextOm, updated_at: new Date().toISOString() };
          
          // Only set primary if we have a new one and existing is missing
          // This allows for dynamic primary updates while preventing overwrites of user-set primaries
          if (primary && !vrow?.primary_image_url) {
            updates.primary_image_url = primary;
            updates.image_url = primary;
          }
          
          await supabase.from('vehicles').update(updates).eq('id', vehicleId);
        } catch {
          // swallow (non-blocking)
        }
      }
    } catch {
      // Non-blocking
    }

    // For live auctions, keep external_listings in sync so the vehicle header can show watchers/views/comments.
    // external_listings supports watcher_count/view_count/current_bid and is used by the UI auction pulse.
    try {
      const endDateIso = auctionEndDate
        ? (() => {
            const d = new Date(`${auctionEndDate}T00:00:00.000Z`);
            d.setUTCHours(23, 59, 59, 999);
            return d.toISOString();
          })()
        : null;

      await supabase
        .from('external_listings')
        .upsert(
          {
            vehicle_id: vehicleId,
            // Many BaT auctions are public listings with no known seller organization.
            // external_listings.organization_id must allow NULL for these cases (see migration).
            organization_id: shouldLinkSellerOrg ? sellerOrganizationId : null,
            platform: 'bat',
            listing_url: batUrl,
            // DB constraint allows: pending|active|ended|sold|cancelled (no 'live')
            listing_status: auctionOutcome === 'sold' ? 'sold' : (auctionOutcome === 'active' ? 'active' : 'ended'),
            // Use BaT lot number (or URL-derived fallback) as the platform listing_id so ON CONFLICT works.
            listing_id: lotNumber || batUrl.split('/').filter(Boolean).pop() || null,
            end_date: endDateIso,
            current_bid: metrics.currentBid,
            bid_count: metrics.bidCount,
            watcher_count: metrics.watcherCount,
            view_count: metrics.viewCount,
            metadata: {
              source: 'import-bat-listing',
              lot_number: lotNumber || null,
              comment_count: metrics.commentCount,
              auction_end_date: auctionEndDate,
              bat_title: title || null,
              auction_outcome: auctionOutcome,
              reserve_not_met: auctionOutcome === 'reserve_not_met',
            },
            updated_at: new Date().toISOString(),
          },
          // external_listings has UNIQUE (vehicle_id, platform, listing_id)
          { onConflict: 'vehicle_id,platform,listing_id' },
        );
    } catch (e: any) {
      console.log('external_listings upsert failed (non-fatal):', e?.message || String(e));
    }

    // Write/refresh bat_listings (if table exists in this project).
    // This keeps auction identity separate from vehicles and lets comments/bids later attach cleanly.
    try {
      await supabase
        .from('bat_listings')
        .upsert(
          {
            vehicle_id: vehicleId,
            organization_id: shouldLinkSellerOrg ? sellerOrganizationId : null,
            bat_listing_url: batUrl,
            bat_lot_number: lotNumber || null,
            bat_listing_title: title || null,
            auction_end_date: auctionEndDate || null,
            sale_date: auctionOutcome !== 'active' ? (saleDate || null) : null,
            sale_price: auctionOutcome === 'sold' ? (salePrice || null) : null,
            seller_username: sellerUser.username,
            buyer_username: buyerUser.username,
            seller_bat_user_id: sellerUser.id,
            buyer_bat_user_id: buyerUser.id,
            seller_external_identity_id: sellerExternalIdentityId,
            buyer_external_identity_id: buyerExternalIdentityId,
            // bat_listings constraint allows: active|ended|sold|no_sale|cancelled (no 'live')
            listing_status: auctionOutcome === 'sold' ? 'sold' : (auctionOutcome === 'active' ? 'active' : 'ended'),
            final_bid: (auctionOutcome === 'active' ? null : (resultHighBid || metrics.currentBid || null)),
            bid_count: metrics.bidCount || null,
            view_count: metrics.viewCount || null,
            comment_count: metrics.commentCount || null,
            last_updated_at: new Date().toISOString(),
            raw_data: {
              source: 'bat_import',
              bat_url: batUrl,
              seller_type: sellerType || null,
              seller_business_id: sellerOrganizationId,
              seller_business_linked: shouldLinkSellerOrg,
              seller_org_discovered_via: sellerOrgDiscoveredViaLocalPartners ? 'bat_local_partners' : null,
              live_metrics: {
                current_bid: metrics.currentBid,
                bid_count: metrics.bidCount,
                watcher_count: metrics.watcherCount,
                view_count: metrics.viewCount,
                comment_count: metrics.commentCount,
                auction_end_date: auctionEndDate,
              }
            },
          },
          { onConflict: 'bat_listing_url' },
        );
    } catch (e: any) {
      console.log('bat_listings upsert failed (non-fatal):', e?.message || String(e));
    }

    const validations = [
      {
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'sale_price',
        field_value: salePrice.toString(),
        validation_source: 'bat_listing',
        confidence_score: 100,
        source_url: batUrl,
        notes: `Sale price verified from BaT listing #${lotNumber}`
      },
      {
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'year',
        field_value: year.toString(),
        validation_source: 'bat_listing',
        confidence_score: 100,
        source_url: batUrl,
        notes: `Year verified from BaT listing #${lotNumber}`
      }
    ];

    if (vin) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'vin',
        field_value: vin,
        validation_source: 'bat_listing',
        confidence_score: 100,
        source_url: batUrl,
        notes: `VIN verified from BaT listing #${lotNumber}`
      });
    }

    await supabase
      .from('data_validations')
      .insert(validations);

    // Create timeline event for the sale with the actual sale date (deduped by bat_url + event_date).
    try {
      if (auctionOutcome !== 'sold' || !saleDate || !salePrice || salePrice <= 0) {
        throw new Error('Skipping sale event: listing is live or sale is not confirmed');
      }
      const { data: existingSaleEvent } = await supabase
        .from('timeline_events')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('event_type', 'sale')
        .eq('event_date', saleDate)
        .contains('metadata', { bat_url: batUrl })
        .limit(1);

      if (!existingSaleEvent || existingSaleEvent.length === 0) {
        await supabase
          .from('timeline_events')
          .insert({
            vehicle_id: vehicleId,
            event_type: 'sale',
            event_date: saleDate, // Use actual BaT sale date
            title: `Sold on Bring a Trailer for $${salePrice.toLocaleString()}`,
            description: `${year} ${make} ${model} sold on BaT auction #${lotNumber}. Seller: ${seller}${buyer ? `, Buyer: ${buyer}` : ''}`,
            cost_amount: salePrice,
            metadata: {
              source: 'bat_import',
              bat_url: batUrl,
              lot_number: lotNumber,
              seller,
              buyer
            },
            user_id: null // System-generated event
          });
      } else {
        console.log('Sale timeline event already exists for this bat_url + event_date; skipping insert');
      }
    } catch (e: any) {
      console.log('Timeline sale event insert failed (non-fatal):', e?.message || String(e));
    }
    
    // ALWAYS call comprehensive extraction to get full auction data and create timeline events
    // This ensures all BaT vehicles get complete data (comments, features, dates, etc.)
    try {
      console.log('🔄 Calling comprehensive BaT extraction...');
      const { data: comprehensiveData, error: comprehensiveError } = await supabase.functions.invoke('comprehensive-bat-extraction', {
        body: { batUrl, vehicleId }
      });
      
      if (comprehensiveError) {
        console.error('❌ Comprehensive extraction error:', comprehensiveError);
        // Don't fail the import, but log the error
      } else if (comprehensiveData?.success) {
        console.log('✅ Comprehensive extraction completed:', {
          vin: comprehensiveData.data?.vin,
          auction_dates: {
            start: comprehensiveData.data?.auction_start_date,
            end: comprehensiveData.data?.auction_end_date,
            sale: comprehensiveData.data?.sale_date
          },
          metrics: {
            bids: comprehensiveData.data?.bid_count,
            views: comprehensiveData.data?.view_count,
            comments: comprehensiveData.data?.comment_count
          },
          features: comprehensiveData.data?.features?.length || 0
        });
      } else {
        console.warn('⚠️ Comprehensive extraction returned failure:', comprehensiveData?.error);
      }
    } catch (err: any) {
      console.error('❌ Comprehensive extraction exception:', err.message || String(err));
      // Don't fail the import, but log the error
    }

    // Import ALL BaT listing images by scraping URLs then calling backfill-images in batches.
    const imageImport = {
      original_found: 0,
      found: 0,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      batches: 0,
      batch_size: imageBatchSize
    };
    try {
      // If DOM-map already found a real gallery, don't spend runtime re-scraping.
      const alreadyHaveGallery = Array.isArray(domExtracted?.image_urls) && domExtracted.image_urls.length >= 20;
      if (alreadyHaveGallery) {
        console.log('Skipping simple-scraper: DOM-map gallery is sufficient');
      } else {
      const { data: simpleData, error: simpleError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: batUrl }
      });
      const images: string[] = (simpleData?.success && Array.isArray(simpleData?.data?.images)) ? simpleData.data.images : [];
      const MAX_TOTAL_IMAGES = 120;
      const capped = images.slice(0, MAX_TOTAL_IMAGES);
      imageImport.original_found = images.length;
      imageImport.found = capped.length;

      if (simpleError) {
        console.log('simple-scraper failed (non-fatal):', simpleError.message);
      } else if (capped.length > 0) {
        for (let start = 0; start < capped.length; start += imageBatchSize) {
          const slice = capped.slice(start, start + imageBatchSize);
          imageImport.batches++;
          const { data: backfillData, error: backfillError } = await supabase.functions.invoke('backfill-images', {
            body: {
              vehicle_id: vehicleId,
              image_urls: slice,
              source: 'bat_import',
              run_analysis: false,
              listed_date: saleDate,
              max_images: slice.length
            }
          });
          if (backfillError) {
            console.log(`backfill-images batch failed (non-fatal):`, backfillError.message);
            imageImport.failed += slice.length;
            continue;
          }
          imageImport.uploaded += Number(backfillData?.uploaded || 0);
          imageImport.skipped += Number(backfillData?.skipped || 0);
          imageImport.failed += Number(backfillData?.failed || 0);
        }
      } else {
        console.log('No images found by simple-scraper');
      }
      }
    } catch (e: any) {
      console.log('Image import failed (non-fatal):', e?.message || String(e));
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicleId,
        vehicle: listing,
        action: createdVehicle ? 'created' : 'updated',
        seller_identity: {
          bat_username: sellerUser.username,
          bat_user_id: sellerUser.id,
          bat_profile_url: sellerUser.profile_url,
          seller_type: sellerType || null,
          seller_business_id: sellerOrganizationId,
          seller_business_linked: shouldLinkSellerOrg
        },
        buyer_identity: {
          bat_username: buyerUser.username,
          bat_user_id: buyerUser.id,
          bat_profile_url: buyerUser.profile_url
        },
        images: imageImport
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error importing BaT listing:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
