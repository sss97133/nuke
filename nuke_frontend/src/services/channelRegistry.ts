/**
 * channelRegistry.ts
 * ---------------------------------------------------------------------------
 * The thesis, encoded: all the data is the same. Every marketplace, auction
 * house, and classified site is just a creative outlet on one underlying
 * vehicle record. Submission to any of them is a single toggle — the
 * COMPLEXITY of how the listing actually lands there is the channel's
 * `mechanism`, hidden behind the switch.
 *
 * One registry → N outlets. The switchboard renders this; the dispatch path
 * (listingExportService.submitToChannel) routes on `mechanism`.
 *
 * Mechanisms, from cheapest to most human:
 *   native          — Nuke's own surface. Instant, no external dependency.
 *   instant_api     — the outlet exposes a real listing API we call directly.
 *   dealer_feed     — outlet ingests a dealer inventory feed (requires dealer identity).
 *   agent_pilot     — no API; an AI drives the outlet's own form under a logged-in
 *                     session. Bot-hostile / ToS-gated outlets live here.
 *   concierge_human — structurally non-automatable (consignment, valuation, signed
 *                     contract). AI assembles everything; a human completes the handoff.
 *
 * `platform` maps to the listing_exports.platform enum
 * ('nzero'|'bat'|'ebay'|'craigslist'|'carscom'|'facebook'|'autotrader'|'other').
 * Outlets without a dedicated enum slot use 'other' + metadata.channel_id.
 */

export type ChannelMechanism =
  | 'native'
  | 'instant_api'
  | 'dealer_feed'
  | 'agent_pilot'
  | 'concierge_human';

export type ListingPlatformEnum =
  | 'nzero'
  | 'bat'
  | 'ebay'
  | 'craigslist'
  | 'carscom'
  | 'facebook'
  | 'autotrader'
  | 'other';

/** Readiness floor: how high the auction-readiness (ARS) tier must be to clear the outlet's bar. */
export type ReadinessTier = 'any' | 'standard' | 'curated' | 'apex';

export interface ChannelDef {
  /** Stable id used in listing_exports.metadata.channel_id and as the toggle key. */
  id: string;
  label: string;
  /** Maps to the listing_exports.platform enum. */
  platform: ListingPlatformEnum;
  mechanism: ChannelMechanism;
  /** One-line seller economics, quoted from research (2026). */
  economics: string;
  /** Minimum readiness the outlet expects before it will accept the car. */
  minReadiness: ReadinessTier;
  /** Short, honest note about what flipping this toggle actually does today. */
  note: string;
  /** Live = dispatch is implemented end-to-end. queued = prepares + enqueues, handoff pending. */
  liveStatus: 'live' | 'queued';
}

export interface MechanismMeta {
  badge: string;
  /** CSS var token for the badge accent (falls back to a hex). */
  accentVar: string;
  blurb: string;
}

export const MECHANISMS: Record<ChannelMechanism, MechanismMeta> = {
  native: {
    badge: 'INSTANT',
    accentVar: 'var(--accent-brg, #1b4332)',
    blurb: "Nuke's own auction surface. Goes live the moment you flip it.",
  },
  instant_api: {
    badge: 'API',
    accentVar: 'var(--accent-gulf, #1e6091)',
    blurb: 'Listed programmatically through the outlet API. No human touch.',
  },
  dealer_feed: {
    badge: 'FEED',
    accentVar: 'var(--accent-martini, #6a4c93)',
    blurb: 'Pushed via dealer inventory feed. Requires a dealer identity.',
  },
  agent_pilot: {
    badge: 'AUTO-PILOT',
    accentVar: 'var(--accent-papaya, #cc5803)',
    blurb: 'No API — an AI drives the outlet form under your session and submits.',
  },
  concierge_human: {
    badge: 'CONCIERGE',
    accentVar: 'var(--accent-jps, #b8860b)',
    blurb: 'AI assembles the full consignment package; a human completes the handoff.',
  },
};

/**
 * The outlets. Order is roughly the value/formality axis: apex consignment →
 * curated enthusiast → feed marketplaces → vernacular.
 */
export const CHANNELS: ChannelDef[] = [
  {
    id: 'nuke_live',
    label: 'Nuke Live Auction',
    platform: 'nzero',
    mechanism: 'native',
    economics: 'No fee · our surface',
    minReadiness: 'any',
    note: 'Lists on Nuke immediately.',
    liveStatus: 'live',
  },
  {
    id: 'bring_a_trailer',
    label: 'Bring a Trailer',
    platform: 'bat',
    mechanism: 'agent_pilot',
    economics: '$99–$2,500 listing · 0% seller · 5% buyer ($250–$7.5k)',
    minReadiness: 'curated',
    note: 'Curated — ~30–40% of submissions rejected. Specialist writes the final listing; agent pre-fills and submits, you approve.',
    liveStatus: 'queued',
  },
  {
    id: 'cars_and_bids',
    label: 'Cars & Bids',
    platform: 'other',
    mechanism: 'agent_pilot',
    economics: 'Free list · 0% seller · 5% buyer ($250–$7.5k)',
    minReadiness: 'curated',
    note: 'Modern-enthusiast curated. 6-photo intake is the scriptable step; team writes the listing.',
    liveStatus: 'queued',
  },
  {
    id: 'hagerty_marketplace',
    label: 'Hagerty Marketplace',
    platform: 'other',
    mechanism: 'agent_pilot',
    economics: 'Free list · 0% seller · 7% buyer ($500 min)',
    minReadiness: 'curated',
    note: 'Expert-crafted listing after submission. Agent pre-fills the form.',
    liveStatus: 'queued',
  },
  {
    id: 'rm_sothebys',
    label: "RM Sotheby's",
    platform: 'other',
    mechanism: 'concierge_human',
    economics: 'Negotiated seller comm. · 10–12% buyer',
    minReadiness: 'apex',
    note: 'Consignment: valuation + signed contract. AI assembles the dossier; a human consigns.',
    liveStatus: 'queued',
  },
  {
    id: 'bonhams',
    label: 'Bonhams',
    platform: 'other',
    mechanism: 'concierge_human',
    economics: 'Negotiated seller comm. · 10–12% buyer',
    minReadiness: 'apex',
    note: 'Estimate form → specialist → entry agreement. Concierge handoff.',
    liveStatus: 'queued',
  },
  {
    id: 'mecum',
    label: 'Mecum',
    platform: 'other',
    mechanism: 'concierge_human',
    economics: '~10% seller · ~10% buyer · sliding entry fee',
    minReadiness: 'standard',
    note: 'Phone-first consignment. AI preps the "Request a Position" package; a human places it.',
    liveStatus: 'queued',
  },
  {
    id: 'ebay_motors',
    label: 'eBay Motors',
    platform: 'ebay',
    mechanism: 'instant_api',
    economics: '$19–$79 flat · no commission',
    minReadiness: 'standard',
    note: 'The one true instant-list: Trading API (Site 100), VIN + title required. Private seller, no dealer needed.',
    liveStatus: 'queued',
  },
  {
    id: 'classiccars_com',
    label: 'ClassicCars.com',
    platform: 'carscom',
    mechanism: 'dealer_feed',
    economics: '$130–$350 private · or dealer feed',
    minReadiness: 'standard',
    note: 'Dealer DMS import feed (needs dealer identity) or one-time private listing.',
    liveStatus: 'queued',
  },
  {
    id: 'autotrader',
    label: 'AutoTrader',
    platform: 'autotrader',
    mechanism: 'dealer_feed',
    economics: 'Private $9–$150 · dealer via vAuto/HomeNet',
    minReadiness: 'standard',
    note: 'US dealer inventory feed (Cox vAuto/HomeNet), or private web listing.',
    liveStatus: 'queued',
  },
  {
    id: 'facebook_marketplace',
    label: 'Facebook Marketplace',
    platform: 'facebook',
    mechanism: 'agent_pilot',
    economics: 'Free',
    minReadiness: 'any',
    note: 'No API and bot-hostile — agent drives Marketplace under your own session.',
    liveStatus: 'queued',
  },
  {
    id: 'craigslist',
    label: 'Craigslist',
    platform: 'craigslist',
    mechanism: 'agent_pilot',
    economics: '$5 listing',
    minReadiness: 'any',
    note: 'No API; phone-verified. Agent posts under your session.',
    liveStatus: 'queued',
  },
];

export const CHANNELS_BY_ID: Record<string, ChannelDef> = Object.fromEntries(
  CHANNELS.map((c) => [c.id, c]),
);

/** Display order of the mechanism groups in the switchboard. */
export const MECHANISM_ORDER: ChannelMechanism[] = [
  'native',
  'instant_api',
  'dealer_feed',
  'agent_pilot',
  'concierge_human',
];

const READINESS_RANK: Record<ReadinessTier, number> = {
  any: 0,
  standard: 1,
  curated: 2,
  apex: 3,
};

/**
 * ARS tier string → readiness rank. Maps the real auction_readiness.tier values
 * (compute_auction_readiness) to the channel readiness floor.
 *   TIER_1_EXCEPTIONAL → apex(3) · TIER_2_COMPETITIVE → curated(2)
 *   TIER_3_VIABLE → standard(1) · TIER_4_INCOMPLETE / DISCOVERY_ONLY → any(0)
 */
export function arsTierToRank(tier: string | null | undefined): number {
  if (!tier) return 0;
  const t = tier.toUpperCase();
  if (t.includes('TIER_1') || t.includes('EXCEPTIONAL')) return 3;
  if (t.includes('TIER_2') || t.includes('COMPETITIVE')) return 2;
  if (t.includes('TIER_3') || t.includes('VIABLE')) return 1;
  return 0; // TIER_4_INCOMPLETE, DISCOVERY_ONLY, unknown
}

/** The readiness floor a channel demands, as a human label (for the blocked hint). */
export function readinessFloorLabel(channel: ChannelDef): string {
  switch (channel.minReadiness) {
    case 'apex': return 'Exceptional (Tier 1)';
    case 'curated': return 'Competitive (Tier 2)';
    case 'standard': return 'Viable (Tier 3)';
    default: return 'any';
  }
}

/** True when the vehicle's readiness clears the channel's floor. */
export function meetsReadiness(channel: ChannelDef, arsTier: string | null | undefined): boolean {
  return arsTierToRank(arsTier) >= READINESS_RANK[channel.minReadiness];
}
