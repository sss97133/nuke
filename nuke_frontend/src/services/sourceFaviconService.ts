/**
 * Source Favicon Service
 * Extracts and caches favicons for vehicle discovery sources
 */

import { supabase } from '../lib/supabase';

export interface SourceFavicon {
  id: string;
  domain: string;
  favicon_url: string;
  source_type?: string;
  source_name?: string;
  metadata?: Record<string, any>;
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string | null {
  try {
    const match = url.match(/https?:\/\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Get favicon URL for a domain using Google's service
 */
function getFaviconUrl(domain: string, size: number = 16): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}

/**
 * Get cached favicon from database
 */
export async function getCachedFavicon(url: string): Promise<string | null> {
  try {
    const domain = extractDomain(url);
    if (!domain) return null;

    const { data, error } = await supabase.rpc('get_source_favicon', {
      p_url: url
    });

    if (error) {
      console.warn('Failed to get cached favicon:', error);
      return null;
    }

    return data || null;
  } catch (err) {
    console.warn('Error getting cached favicon:', err);
    return null;
  }
}

/**
 * Extract and cache favicon for a source URL
 * This should be called whenever we discover a vehicle from a new source
 */
export async function extractAndCacheFavicon(
  url: string,
  sourceType?: string,
  sourceName?: string
): Promise<string | null> {
  try {
    const domain = extractDomain(url);
    if (!domain) {
      console.warn('Could not extract domain from URL:', url);
      return null;
    }

    // Generate favicon URL using Google's service
    const faviconUrl = getFaviconUrl(domain);

    // Upsert to database
    const { data: faviconId, error } = await supabase.rpc('upsert_source_favicon', {
      p_domain: domain,
      p_favicon_url: faviconUrl,
      p_source_type: sourceType || null,
      p_source_name: sourceName || null,
      p_metadata: {}
    });

    if (error) {
      console.warn('Failed to cache favicon:', error);
      // Return the generated URL anyway (don't fail completely)
      return faviconUrl;
    }

    console.log('✅ Cached favicon for domain:', domain, 'faviconId:', faviconId);
    return faviconUrl;
  } catch (err) {
    console.warn('Error extracting favicon:', err);
    return null;
  }
}

/**
 * Batch extract favicons for multiple URLs
 * Useful when processing multiple vehicles from the same source
 */
export async function batchExtractFavicons(
  urls: string[],
  sourceType?: string,
  sourceName?: string
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  // Group by domain to avoid duplicate requests
  const domainMap = new Map<string, string[]>();
  urls.forEach(url => {
    const domain = extractDomain(url);
    if (domain) {
      if (!domainMap.has(domain)) {
        domainMap.set(domain, []);
      }
      domainMap.get(domain)!.push(url);
    }
  });

  // Extract favicon for each unique domain
  const promises = Array.from(domainMap.keys()).map(async (domain) => {
    const sampleUrl = domainMap.get(domain)![0];
    const faviconUrl = await extractAndCacheFavicon(sampleUrl, sourceType, sourceName);
    if (faviconUrl) {
      domainMap.get(domain)!.forEach(url => {
        results.set(url, faviconUrl);
      });
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Detect source type from URL
 */
export function detectSourceType(url: string): { type: string; name: string } | null {
  const urlLower = url.toLowerCase();

  // Marketplace/Classified
  if (urlLower.includes('craigslist.org')) {
    return { type: 'classified', name: 'Craigslist' };
  }
  if (urlLower.includes('facebook.com/marketplace')) {
    return { type: 'social', name: 'Facebook Marketplace' };
  }

  // Auction sites
  if (urlLower.includes('bringatrailer.com') || urlLower.includes('bat')) {
    return { type: 'auction', name: 'Bring a Trailer' };
  }
  if (urlLower.includes('carsandbids.com')) {
    return { type: 'auction', name: 'Cars & Bids' };
  }
  if (urlLower.includes('ebay.com') || urlLower.includes('ebaymotors.com')) {
    return { type: 'auction', name: 'eBay Motors' };
  }

  // Dealer sites
  if (urlLower.includes('cars.com')) {
    return { type: 'dealer', name: 'Cars.com' };
  }
  if (urlLower.includes('autotrader.com')) {
    return { type: 'dealer', name: 'AutoTrader' };
  }
  if (urlLower.includes('hemmings.com')) {
    return { type: 'dealer', name: 'Hemmings' };
  }
  if (urlLower.includes('classiccars.com')) {
    return { type: 'dealer', name: 'ClassicCars.com' };
  }
  if (urlLower.includes('classic.com')) {
    return { type: 'dealer', name: 'Classic.com' };
  }

  return null;
}

