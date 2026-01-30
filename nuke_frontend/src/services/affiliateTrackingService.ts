/**
 * Affiliate Tracking Service
 *
 * Handles affiliate URL generation and click tracking for the parts monetization system.
 * - Generates affiliate URLs using source-specific templates
 * - Tracks clicks by calling the track-affiliate-click edge function
 * - Handles different affiliate URL patterns for each source
 */

import { supabase } from '../lib/supabase';

// Affiliate URL templates for each source
const AFFILIATE_TEMPLATES: Record<string, string> = {
  'eBay': '{url}?mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid={campaign_id}&toolid=10001&customid={click_id}',
  'FCP Euro': '{url}?aff={affiliate_id}',
  'Pelican Parts': 'https://shareasale.com/r.cfm?b={affiliate_id}&u={campaign_id}&m=47396&urllink={encoded_url}',
  'RockAuto': '{url}?a={affiliate_id}',
  'Amazon': '{url}?tag={affiliate_id}'
};

export interface AffiliateProgram {
  id: string;
  source_name: string;
  affiliate_id: string | null;
  campaign_id: string | null;
  commission_rate: number;
  url_template: string;
  is_active: boolean;
}

export interface ClickTrackingParams {
  sourceName: string;
  destinationUrl: string;
  affiliateUrl: string;
  userId?: string;
  vehicleId?: string;
  partId?: string;
  issuePattern?: string;
  sponsoredPlacementId?: string;
  referrerUrl?: string;
}

export interface TrackClickResult {
  success: boolean;
  clickId?: string;
  error?: string;
}

// Cache for affiliate programs
let affiliateProgramsCache: AffiliateProgram[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get all active affiliate programs
 */
export async function getAffiliatePrograms(): Promise<AffiliateProgram[]> {
  // Check cache
  if (affiliateProgramsCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return affiliateProgramsCache;
  }

  const { data, error } = await supabase
    .from('affiliate_programs')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('Error fetching affiliate programs:', error);
    return [];
  }

  affiliateProgramsCache = data || [];
  cacheTimestamp = Date.now();

  return affiliateProgramsCache;
}

/**
 * Get affiliate program by source name
 */
export async function getAffiliateProgram(sourceName: string): Promise<AffiliateProgram | null> {
  const programs = await getAffiliatePrograms();
  return programs.find(p => p.source_name === sourceName) || null;
}

/**
 * Generate affiliate URL for a given source and destination URL
 */
export function generateAffiliateUrl(
  destinationUrl: string,
  program: AffiliateProgram,
  clickId?: string
): string {
  if (!program?.url_template) {
    return destinationUrl;
  }

  let affiliateUrl = program.url_template
    .replace('{url}', destinationUrl)
    .replace('{encoded_url}', encodeURIComponent(destinationUrl))
    .replace('{affiliate_id}', program.affiliate_id || '')
    .replace('{campaign_id}', program.campaign_id || '')
    .replace('{click_id}', clickId || '');

  // Clean up any remaining placeholders
  affiliateUrl = affiliateUrl.replace(/\{[^}]+\}/g, '');

  return affiliateUrl;
}

/**
 * Generate affiliate URL using source name (convenience method)
 */
export async function generateAffiliateUrlForSource(
  destinationUrl: string,
  sourceName: string,
  clickId?: string
): Promise<string> {
  const program = await getAffiliateProgram(sourceName);

  if (!program) {
    console.warn(`No affiliate program found for source: ${sourceName}`);
    return destinationUrl;
  }

  return generateAffiliateUrl(destinationUrl, program, clickId);
}

/**
 * Track affiliate link click
 */
export async function trackAffiliateClick(params: ClickTrackingParams): Promise<TrackClickResult> {
  try {
    const response = await supabase.functions.invoke('track-affiliate-click', {
      body: {
        source_name: params.sourceName,
        destination_url: params.destinationUrl,
        affiliate_url: params.affiliateUrl,
        user_id: params.userId,
        vehicle_id: params.vehicleId,
        part_id: params.partId,
        issue_pattern: params.issuePattern,
        sponsored_placement_id: params.sponsoredPlacementId,
        referrer_url: params.referrerUrl || window.location.href,
        session_id: getSessionId()
      }
    });

    if (response.error) {
      console.error('Error tracking click:', response.error);
      return { success: false, error: response.error.message };
    }

    return {
      success: true,
      clickId: response.data?.click_id
    };

  } catch (error) {
    console.error('Error tracking affiliate click:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Track click and open affiliate URL in new tab
 */
export async function trackAndOpenAffiliateLink(
  params: ClickTrackingParams
): Promise<TrackClickResult> {
  // Open link immediately for better UX (don't wait for tracking)
  window.open(params.affiliateUrl, '_blank', 'noopener,noreferrer');

  // Track click in background
  return trackAffiliateClick(params);
}

/**
 * Build search URL for a source
 */
export function buildSearchUrl(sourceName: string, partName: string, vehicle?: {
  make?: string;
  model?: string;
  year?: number;
}): string {
  const encoded = encodeURIComponent(partName);
  const vehicleQuery = vehicle?.make && vehicle?.model
    ? ` ${vehicle.year || ''} ${vehicle.make} ${vehicle.model}`.trim()
    : '';
  const fullQuery = encodeURIComponent(`${partName}${vehicleQuery}`);

  switch (sourceName) {
    case 'eBay':
      return `https://www.ebay.com/sch/i.html?_nkw=${fullQuery}&_sacat=6028`;

    case 'FCP Euro':
      return `https://www.fcpeuro.com/search?query=${encoded}`;

    case 'Pelican Parts':
      return `https://www.pelicanparts.com/catalog/search.php?search=${encoded}`;

    case 'RockAuto':
      return `https://www.rockauto.com/en/partsearch/?partnum=${encoded}`;

    case 'Amazon':
      return `https://www.amazon.com/s?k=${fullQuery}+auto+parts`;

    default:
      return `https://www.google.com/search?q=${fullQuery}+buy`;
  }
}

/**
 * Get or create session ID for tracking
 */
function getSessionId(): string {
  const STORAGE_KEY = 'viva_session_id';

  try {
    let sessionId = sessionStorage.getItem(STORAGE_KEY);

    if (!sessionId) {
      sessionId = `vs_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
      sessionStorage.setItem(STORAGE_KEY, sessionId);
    }

    return sessionId;
  } catch {
    // Fallback if sessionStorage is not available
    return `vs_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
  }
}

/**
 * Format price for display
 */
export function formatPrice(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return 'N/A';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Format price range for display
 */
export function formatPriceRange(minCents: number | null, maxCents: number | null): string {
  if (minCents === null && maxCents === null) return 'Price unavailable';

  if (minCents === null) return `Up to ${formatPrice(maxCents)}`;
  if (maxCents === null) return `From ${formatPrice(minCents)}`;

  if (minCents === maxCents) return formatPrice(minCents);

  return `${formatPrice(minCents)} - ${formatPrice(maxCents)}`;
}

/**
 * Get source logo/icon
 */
export function getSourceIcon(sourceName: string): string {
  const icons: Record<string, string> = {
    'eBay': 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text y="18" font-size="16">e</text></svg>',
    'FCP Euro': 'https://www.fcpeuro.com/favicon.ico',
    'Pelican Parts': 'https://www.pelicanparts.com/favicon.ico',
    'RockAuto': 'https://www.rockauto.com/favicon.ico',
    'Amazon': 'https://www.amazon.com/favicon.ico'
  };

  return icons[sourceName] || '';
}

/**
 * Get source color for styling
 */
export function getSourceColor(sourceName: string): string {
  const colors: Record<string, string> = {
    'eBay': '#e53238',
    'FCP Euro': '#005eb8',
    'Pelican Parts': '#ff6600',
    'RockAuto': '#cc0000',
    'Amazon': '#ff9900'
  };

  return colors[sourceName] || '#666666';
}
