/**
 * heartbeatConfig.ts — Platform heartbeat classification + health logic
 *
 * Every platform has a "heartbeat type" that determines what healthy ingestion
 * looks like. Barrett-Jackson spikes during Scottsdale week then goes quiet —
 * that's normal. BaT should flow daily — if it stops, something's broken.
 */

export type HeartbeatType = 'event_auction' | 'continuous_auction' | 'marketplace' | 'dealer_other';
export type HealthStatus = 'green' | 'yellow' | 'red' | 'gray';

export interface HeartbeatConfig {
  type: HeartbeatType;
  label: string;
  /** Hours since last ingestion → green */
  greenThresholdHours: number;
  /** Hours since last ingestion → yellow (between green and red) */
  redThresholdHours: number;
}

const HEARTBEAT_TYPES: Record<HeartbeatType, { label: string; greenH: number; redH: number }> = {
  event_auction:     { label: 'EVENT AUCTION',     greenH: 24 * 90,  redH: 24 * 180 },
  continuous_auction:{ label: 'CONTINUOUS AUCTION', greenH: 48,       redH: 24 * 7 },
  marketplace:       { label: 'MARKETPLACE',        greenH: 24 * 7,   redH: 24 * 30 },
  dealer_other:      { label: 'DEALER / OTHER',     greenH: 24 * 30,  redH: 24 * 90 },
};

/** Map canonical_platform → heartbeat type */
const PLATFORM_HEARTBEAT: Record<string, HeartbeatType> = {
  // Event Auctions
  'barrett-jackson': 'event_auction',
  'mecum': 'event_auction',
  'gooding': 'event_auction',
  'bonhams': 'event_auction',
  'rm-sothebys': 'event_auction',
  'broad-arrow': 'event_auction',
  'auctions-america': 'event_auction',
  'russo-and-steele': 'event_auction',
  'gaa-classic-cars': 'event_auction',
  'leake': 'event_auction',
  'silver-auctions': 'event_auction',
  'kruse': 'event_auction',
  'worldwide-auctioneers': 'event_auction',
  'h-and-h': 'event_auction',
  'historics': 'event_auction',
  'artcurial': 'event_auction',
  'coys': 'event_auction',
  'shannons': 'event_auction',
  'branson-auctions': 'event_auction',
  'mccormicks': 'event_auction',
  'carlisle': 'event_auction',
  'midamerica': 'event_auction',
  'palm-springs-exotic': 'event_auction',

  // Continuous Auctions
  'bat': 'continuous_auction',
  'cars-and-bids': 'continuous_auction',
  'pcarmarket': 'continuous_auction',
  'collecting-cars': 'continuous_auction',
  'sbx-cars': 'continuous_auction',

  // Marketplaces
  'facebook-marketplace': 'marketplace',
  'craigslist': 'marketplace',
  'ebay': 'marketplace',
  'hemmings': 'marketplace',
  'jamesedition': 'marketplace',
  'ksl': 'marketplace',
  'classiccars-com': 'marketplace',
  'motorious': 'marketplace',
  'hagerty': 'marketplace',

  // Dealer / Other
  'beverly-hills-car-club': 'dealer_other',
  'dealer': 'dealer_other',
  'user-submission': 'dealer_other',
  'deal-jacket-ocr': 'dealer_other',
  'conceptcarz': 'dealer_other',
  'lart-de-lautomobile': 'dealer_other',
  'classic-com': 'dealer_other',
  'tbtfw': 'dealer_other',
  'sweet-cars': 'dealer_other',
  'streetside-classics': 'dealer_other',
  'fantasy-junction': 'dealer_other',
  'blue-chip-fleet': 'dealer_other',
  '111-motorcars': 'dealer_other',
  'advantage-auto-direct': 'dealer_other',
  'velocity-restorations': 'dealer_other',
  'grand-prix-classics': 'dealer_other',
  'collective-auto': 'dealer_other',
  'unknown': 'dealer_other',
};

export function getHeartbeatType(platform: string): HeartbeatType {
  return PLATFORM_HEARTBEAT[platform] || 'dealer_other';
}

export function getHeartbeatLabel(type: HeartbeatType): string {
  return HEARTBEAT_TYPES[type].label;
}

export function getHealthStatus(platform: string, lastIngestedAt: string | null): HealthStatus {
  if (!lastIngestedAt) return 'gray';

  const type = getHeartbeatType(platform);
  const cfg = HEARTBEAT_TYPES[type];
  const hoursSince = (Date.now() - new Date(lastIngestedAt).getTime()) / (1000 * 60 * 60);

  if (hoursSince <= cfg.greenH) return 'green';
  if (hoursSince <= cfg.redH) return 'yellow';
  return 'red';
}

/** Data grade A-F based on field fill rates */
export function getDataGrade(fillRates: { vin: number; desc: number; price: number }): string {
  const avg = (fillRates.vin + fillRates.desc + fillRates.price) / 3;
  if (avg >= 90) return 'A';
  if (avg >= 75) return 'B';
  if (avg >= 55) return 'C';
  if (avg >= 35) return 'D';
  return 'F';
}

export const HEALTH_COLORS: Record<HealthStatus, string> = {
  green: '#16825d',
  yellow: '#b05a00',
  red: '#d13438',
  gray: '#555',
};

/** Group platforms by heartbeat type for display */
export function groupByHeartbeat(platforms: string[]): Record<HeartbeatType, string[]> {
  const groups: Record<HeartbeatType, string[]> = {
    event_auction: [],
    continuous_auction: [],
    marketplace: [],
    dealer_other: [],
  };
  for (const p of platforms) {
    const type = getHeartbeatType(p);
    groups[type].push(p);
  }
  return groups;
}

/** Format "time ago" from ISO timestamp */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 90) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
