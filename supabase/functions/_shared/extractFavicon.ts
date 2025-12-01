/**
 * Shared utility for extracting and caching favicons in edge functions
 */

interface SourceInfo {
  type?: string;
  name?: string;
}

/**
 * Detect source type from URL
 */
export function detectSourceType(url: string): SourceInfo | null {
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

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const match = url.match(/https?:\/\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Get favicon URL using Google's service
 */
export function getFaviconUrl(domain: string, size: number = 16): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}

/**
 * Extract and cache favicon for a source URL
 * This should be called whenever we discover a vehicle from a new source
 */
export async function extractAndCacheFavicon(
  supabase: any,
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

    // Detect source if not provided
    const detected = detectSourceType(url);
    const finalSourceType = sourceType || detected?.type || null;
    const finalSourceName = sourceName || detected?.name || null;

    // Generate favicon URL using Google's service
    const faviconUrl = getFaviconUrl(domain);

    // Upsert to database
    const { data: faviconId, error } = await supabase.rpc('upsert_source_favicon', {
      p_domain: domain,
      p_favicon_url: faviconUrl,
      p_source_type: finalSourceType,
      p_source_name: finalSourceName,
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

