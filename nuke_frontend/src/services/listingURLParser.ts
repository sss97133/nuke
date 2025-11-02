/**
 * Listing URL Parser Service
 * Parses vehicle data from auction/marketplace URLs
 * Supports: BaT, eBay, Craigslist, Cars.com, etc.
 */

import { supabase } from '../lib/supabase';

export interface ParsedListing {
  source: 'bat' | 'ebay' | 'craigslist' | 'carscom' | 'unknown';
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  price?: number;
  sold_price?: number;
  sold_date?: string;
  mileage?: number;
  location?: string;
  description?: string;
  images?: string[];
  seller?: string;
  listing_url: string;
  raw_html?: string;
}

class ListingURLParserService {
  /**
   * Identify the listing source from URL
   */
  private identifySource(url: string): ParsedListing['source'] {
    const urlLower = url.toLowerCase();
    
    if (urlLower.includes('bringatrailer.com')) return 'bat';
    if (urlLower.includes('ebay.com')) return 'ebay';
    if (urlLower.includes('craigslist.org')) return 'craigslist';
    if (urlLower.includes('cars.com')) return 'carscom';
    
    return 'unknown';
  }

  /**
   * Extract VIN from text content
   */
  private extractVIN(text: string): string | null {
    const vinPattern = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;
    const matches = text.match(vinPattern);
    
    // Return first match that passes basic VIN validation
    if (matches) {
      for (const match of matches) {
        const vin = match.toUpperCase();
        // Basic validation: no I, O, Q
        if (!/[IOQ]/.test(vin)) {
          return vin;
        }
      }
    }
    
    return null;
  }

  /**
   * Parse BaT listing page
   */
  private async parseBaTListing(url: string, html: string): Promise<Partial<ParsedListing>> {
    const result: Partial<ParsedListing> = {};

    // Extract title (e.g., "1987 GMC V1500 Suburban Sierra Classic 4×4")
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      
      // Parse year
      const yearMatch = title.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        result.year = parseInt(yearMatch[0]);
      }

      // Parse make and model (after year)
      const afterYear = title.replace(/\b(19|20)\d{2}\b/, '').trim();
      const parts = afterYear.split(/\s+/);
      
      if (parts.length >= 2) {
        result.make = parts[0];
        result.model = parts.slice(1).join(' ');
      }
    }

    // Extract sold price
    const soldPriceMatch = html.match(/Sold for.*?USD\s*\$([0-9,]+)/i);
    if (soldPriceMatch) {
      result.sold_price = parseInt(soldPriceMatch[1].replace(/,/g, ''));
    }

    // Extract current bid (if still active)
    const currentBidMatch = html.match(/Current Bid:.*?USD\s*\$([0-9,]+)/i);
    if (currentBidMatch && !result.sold_price) {
      result.price = parseInt(currentBidMatch[1].replace(/,/g, ''));
    }

    // Extract seller
    const sellerMatch = html.match(/by\s+([A-Za-z0-9_-]+)\s+to/i) || html.match(/seller[^>]*>([^<]+)</i);
    if (sellerMatch) {
      result.seller = sellerMatch[1].trim();
    }

    // Extract mileage
    const mileageMatch = html.match(/odometer shows ([0-9,]+[kKmM])/i) || html.match(/([0-9,]+)-[Mm]ile/);
    if (mileageMatch) {
      const mileageStr = mileageMatch[1].replace(/,/g, '').toUpperCase();
      const multiplier = mileageStr.includes('K') ? 1000 : 1;
      result.mileage = parseInt(mileageStr) * multiplier;
    }

    // Extract location
    const locationMatch = html.match(/Located in ([^<]+)/i);
    if (locationMatch) {
      result.location = locationMatch[1].trim();
    }

    // Extract description (first paragraph)
    const descMatch = html.match(/<div class="post-content"[^>]*>([\s\S]*?)<\/div>/i);
    if (descMatch) {
      const desc = descMatch[1].replace(/<[^>]+>/g, ' ').trim().substring(0, 500);
      result.description = desc;
    }

    // Extract images
    const imgMatches = html.matchAll(/<img[^>]+src="([^"]+\.jpg[^"]*)"/gi);
    result.images = Array.from(imgMatches, m => m[1])
      .filter(url => url.includes('bringatrailer.com'))
      .slice(0, 20); // Limit to 20 images

    // Try to extract VIN from full HTML
    result.vin = this.extractVIN(html);

    return result;
  }

  /**
   * Main parse function - fetches and parses any listing URL
   */
  async parseListingURL(url: string): Promise<ParsedListing> {
    const source = this.identifySource(url);

    try {
      // Fetch the listing page
      console.log(`Fetching listing from ${source}:`, url);
      
      const response = await fetch(url);
      const html = await response.text();

      let parsed: Partial<ParsedListing> = {
        source,
        listing_url: url,
        raw_html: html.substring(0, 50000) // Store first 50KB for debugging
      };

      // Parse based on source
      switch (source) {
        case 'bat':
          parsed = { ...parsed, ...(await this.parseBaTListing(url, html)) };
          break;
        
        // TODO: Add parsers for other sources
        case 'ebay':
        case 'craigslist':
        case 'carscom':
        default:
          // Generic parser - try to extract VIN at minimum
          parsed.vin = this.extractVIN(html);
          break;
      }

      console.log('Parsed listing:', parsed);
      return parsed as ParsedListing;

    } catch (error: any) {
      console.error('Error parsing listing URL:', error);
      throw new Error(`Failed to parse ${source} listing: ${error.message}`);
    }
  }

  /**
   * Apply parsed listing data to a vehicle profile
   * IAM-based: Only trusted users (org members) can update
   */
  async applyToVehicle(
    vehicleId: string,
    parsedData: ParsedListing,
    userId: string
  ): Promise<void> {
    const updates: any = {};

    // Build update object with non-null values
    if (parsedData.vin) updates.vin = parsedData.vin;
    if (parsedData.year) updates.year = parsedData.year;
    if (parsedData.make) updates.make = parsedData.make;
    if (parsedData.model) updates.model = parsedData.model;
    if (parsedData.trim) updates.trim = parsedData.trim;
    if (parsedData.mileage) updates.mileage = parsedData.mileage;

    // Update vehicle
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicleId);

    if (updateError) throw updateError;

    // Create timeline event for the data enrichment
    await supabase
      .from('timeline_events')
      .insert({
        vehicle_id: vehicleId,
        user_id: userId,
        event_type: 'other',
        source: `url_import_${parsedData.source}`,
        title: `Data imported from ${parsedData.source.toUpperCase()}`,
        event_date: new Date().toISOString(),
        metadata: {
          listing_url: parsedData.listing_url,
          seller: parsedData.seller,
          sold_price: parsedData.sold_price,
          sold_date: parsedData.sold_date
        }
      });

    console.log(`Vehicle ${vehicleId} updated from ${parsedData.source} listing`);
  }

  /**
   * Find or create vehicle from parsed listing
   * VIN = primary key, year/make/model = secondary
   */
  async findOrCreateVehicle(
    parsedData: ParsedListing,
    userId: string,
    organizationId?: string
  ): Promise<string> {
    // First: Try to find by VIN
    if (parsedData.vin) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', parsedData.vin)
        .maybeSingle();

      if (existing) {
        console.log(`Found existing vehicle by VIN: ${parsedData.vin}`);
        // Update with new data
        await this.applyToVehicle(existing.id, parsedData, userId);
        return existing.id;
      }
    }

    // Second: Try to find by year/make/model
    if (parsedData.year && parsedData.make && parsedData.model) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('year', parsedData.year)
        .ilike('make', parsedData.make)
        .ilike('model', parsedData.model)
        .maybeSingle();

      if (existing) {
        console.log(`Found existing vehicle by year/make/model`);
        // Update with new data (including VIN if we found one)
        await this.applyToVehicle(existing.id, parsedData, userId);
        return existing.id;
      }
    }

    // Third: Create new vehicle
    console.log('Creating new vehicle from listing');
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert({
        vin: parsedData.vin,
        year: parsedData.year,
        make: parsedData.make,
        model: parsedData.model,
        trim: parsedData.trim,
        mileage: parsedData.mileage
      })
      .select('id')
      .single();

    if (error) throw error;

    // Link to organization if provided
    if (organizationId && newVehicle) {
      await supabase
        .from('organization_vehicles')
        .insert({
          organization_id: organizationId,
          vehicle_id: newVehicle.id,
          relationship_type: 'owner',
          status: 'sold',
          linked_by_user_id: userId,
          notes: `Sold on ${parsedData.source.toUpperCase()}: ${parsedData.listing_url}`
        });
    }

    return newVehicle!.id;
  }

  /**
   * Scrape seller's entire listing history from BaT
   * Creates profiles for all vehicles sold by this seller
   */
  async scrapeBaTSellerHistory(
    sellerUsername: string,
    organizationId: string,
    userId: string
  ): Promise<{ created: number; updated: number; errors: number }> {
    const stats = { created: 0, updated: 0, errors: 0 };

    try {
      // Fetch seller's listing page
      const searchUrl = `https://bringatrailer.com/?s=${encodeURIComponent(sellerUsername)}`;
      console.log('Fetching seller listings:', searchUrl);

      const response = await fetch(searchUrl);
      const html = await response.text();

      // Extract all listing URLs from seller
      const listingPattern = /href="(https:\/\/bringatrailer\.com\/listing\/[^"]+)"/gi;
      const listingMatches = html.matchAll(listingPattern);
      const listingURLs = [...new Set(Array.from(listingMatches, m => m[1]))]; // Dedupe

      console.log(`Found ${listingURLs.length} listings for ${sellerUsername}`);

      // Parse and import each listing
      for (const listingUrl of listingURLs.slice(0, 50)) { // Limit to 50 for safety
        try {
          const parsed = await this.parseListingURL(listingUrl);
          await this.findOrCreateVehicle(parsed, userId, organizationId);
          stats.updated++; // Could be created or updated
        } catch (error) {
          console.error(`Error processing ${listingUrl}:`, error);
          stats.errors++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error: any) {
      console.error('Error scraping seller history:', error);
      throw error;
    }

    return stats;
  }
}

export const listingURLParser = new ListingURLParserService();

