/**
 * Listing URL Parser Service
 * Parses vehicle data from auction/marketplace URLs
 * Supports: BaT, eBay, Craigslist, Cars.com, etc.
 */

import { supabase } from '../lib/supabase';

export interface ParsedListing {
  source: 'bat' | 'ebay' | 'craigslist' | 'carscom' | 'classiccars' | 'affordableclassics' | 'classiccom' | 'goxee' | 'ksl' | 'unknown';
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
  seller_phone?: string;
  seller_email?: string;
  seller_address?: string;
  listing_url: string;
  raw_html?: string;
  exterior_color?: string;
  interior_color?: string;
  transmission?: string;
  drivetrain?: string;
  engine?: string;
  title_status?: string;
  convertible?: boolean;
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
    if (urlLower.includes('classiccars.com')) return 'classiccars';
    if (urlLower.includes('affordableclassicsinc.com')) return 'affordableclassics';
    if (urlLower.includes('classic.com/veh/')) return 'classiccom';
    if (urlLower.includes('goxeedealer.com')) return 'goxee';
    if (urlLower.includes('cars.ksl.com')) return 'ksl';
    
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
   * Parse ClassicCars.com listing page
   */
  private async parseClassicCarsListing(url: string, html: string): Promise<Partial<ParsedListing>> {
    const result: Partial<ParsedListing> = {};

    // Extract title (e.g., "1977 Chevrolet Blazer")
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/For Sale:\s*([^<]+)/i);
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

    // Extract listing ID
    const listingIdMatch = html.match(/\(CC-(\d+)\)/i) || url.match(/\/view\/(\d+)\//);
    const listingId = listingIdMatch ? listingIdMatch[1] : null;

    // Extract price
    const priceMatch = html.match(/Price:\s*\$?([\d,]+)/i) || html.match(/\$([\d,]+)\s*\(OBO\)/i);
    if (priceMatch) {
      result.price = parseInt(priceMatch[1].replace(/,/g, ''));
    }

    // Extract vehicle details from structured data
    const detailsSection = html.match(/Vehicle Details[\s\S]*?<\/section>/i) || html;
    
    // Year
    if (!result.year) {
      const yearMatch = detailsSection.match(/Year:\s*(\d{4})/i);
      if (yearMatch) result.year = parseInt(yearMatch[1]);
    }

    // Make
    if (!result.make) {
      const makeMatch = detailsSection.match(/Make:\s*([A-Za-z]+)/i);
      if (makeMatch) result.make = makeMatch[1].trim();
    }

    // Model
    if (!result.model) {
      const modelMatch = detailsSection.match(/Model:\s*([A-Za-z0-9\s]+?)(?:\n|<\/)/i);
      if (modelMatch) result.model = modelMatch[1].trim();
    }

    // Exterior Color
    const extColorMatch = detailsSection.match(/Exterior Color:\s*([A-Za-z]+)/i);
    if (extColorMatch) result.exterior_color = extColorMatch[1].trim();

    // Interior Color
    const intColorMatch = detailsSection.match(/Interior Color:\s*([A-Za-z]+)/i);
    if (intColorMatch) result.interior_color = intColorMatch[1].trim();

    // Transmission
    const transMatch = detailsSection.match(/Transmission:\s*([A-Za-z]+)/i);
    if (transMatch) result.transmission = transMatch[1].trim();

    // Odometer/Mileage
    const mileageMatch = detailsSection.match(/Odometer:\s*([\d,]+)/i);
    if (mileageMatch) {
      result.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
    }

    // Convertible
    const convertibleMatch = detailsSection.match(/Convertible:\s*(Yes|No)/i);
    if (convertibleMatch) {
      result.convertible = convertibleMatch[1].toLowerCase() === 'yes';
    }

    // Title Status
    const titleStatusMatch = detailsSection.match(/Title Status:\s*([A-Za-z]+)/i);
    if (titleStatusMatch) result.title_status = titleStatusMatch[1].trim();

    // Engine History
    const engineHistoryMatch = detailsSection.match(/Engine History:\s*([A-Za-z]+)/i);
    if (engineHistoryMatch) result.engine = engineHistoryMatch[1].trim();

    // Drive Train
    const drivetrainMatch = detailsSection.match(/Drive Train:\s*([A-Za-z0-9\s-]+)/i);
    if (drivetrainMatch) result.drivetrain = drivetrainMatch[1].trim();

    // Location
    const locationMatch = html.match(/Location:\s*([^<\n]+)/i) || html.match(/in\s+([^<,]+),?\s+([A-Z]{2})/i);
    if (locationMatch) {
      result.location = locationMatch[1] ? 
        (locationMatch[2] ? `${locationMatch[1].trim()}, ${locationMatch[2]}` : locationMatch[1].trim()) :
        locationMatch[0].trim();
    }

    // Extract description
    const descMatch = html.match(/Vehicle Description[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) || 
                      html.match(/<div[^>]*class="[^"]*description[^"]*"[\s\S]*?>([\s\S]*?)<\/div>/i);
    if (descMatch) {
      result.description = descMatch[1].replace(/<[^>]+>/g, ' ').trim().substring(0, 5000);
    }

    // Extract seller information
    const sellerSection = html.match(/Listed By:[\s\S]*?Private Seller[\s\S]*?Contact[\s\S]*?<\/section>/i) || html;
    
    // Seller name
    const sellerMatch = sellerSection.match(/Listed By:[\s\S]*?<strong>([^<]+)<\/strong>/i) || 
                       sellerSection.match(/Private Seller/i);
    if (sellerMatch) {
      result.seller = sellerMatch[1] ? sellerMatch[1].trim() : 'Private Seller';
    }

    // Phone
    const phoneMatch = html.match(/Phone:\s*([\d\-\(\)\s]+)/i) || html.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
    if (phoneMatch) {
      result.seller_phone = phoneMatch[1].trim();
    }

    // Email
    const emailMatch = html.match(/Email:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (emailMatch) {
      result.seller_email = emailMatch[1].trim();
    }

    // Address
    const addressMatch = html.match(/Address:\s*([^<\n]+)/i);
    if (addressMatch) {
      result.seller_address = addressMatch[1].trim();
    }

    // Extract images - ClassicCars.com uses various image patterns
    const images: string[] = [];
    
    // Method 1: Look for gallery images
    const galleryMatches = html.matchAll(/<img[^>]+src="([^"]*classiccars[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
    for (const match of galleryMatches) {
      const imgUrl = match[1];
      if (imgUrl && !imgUrl.includes('logo') && !imgUrl.includes('icon')) {
        // Convert to full-size if it's a thumbnail
        const fullUrl = imgUrl.replace(/\/thumbs?\//, '/').replace(/thumb_/, '').replace(/_thumb/, '');
        if (!images.includes(fullUrl)) {
          images.push(fullUrl);
        }
      }
    }

    // Method 2: Look for data attributes with image URLs
    const dataImageMatches = html.matchAll(/data-(?:src|image|url)="([^"]*classiccars[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
    for (const match of dataImageMatches) {
      const imgUrl = match[1];
      if (imgUrl && !images.includes(imgUrl)) {
        images.push(imgUrl);
      }
    }

    // Method 3: Look for JSON data with image URLs
    try {
      const jsonMatches = html.matchAll(/"image[^"]*":\s*"([^"]*classiccars[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
      for (const match of jsonMatches) {
        const imgUrl = match[1];
        if (imgUrl && !images.includes(imgUrl)) {
          images.push(imgUrl);
        }
      }
    } catch (e) {
      // Ignore JSON parse errors
    }

    if (images.length > 0) {
      result.images = Array.from(new Set(images)).slice(0, 50); // Limit to 50 images
    }

    // Try to extract VIN from full HTML
    result.vin = this.extractVIN(html);

    return result;
  }

  /**
   * Parse Affordable Classics Inc listing
   * Example: https://www.affordableclassicsinc.com/vehicle/891559/1985-CHEVROLET-BLAZER-SILVERADO/
   */
  private async parseAffordableClassicsListing(url: string, html: string): Promise<Partial<ParsedListing>> {
    const result: Partial<ParsedListing> = {};

    // Extract from URL pattern: /vehicle/ID/YEAR-MAKE-MODEL/
    const urlMatch = url.match(/\/(\d{4})-(.+?)\/$/);
    if (urlMatch) {
      result.year = parseInt(urlMatch[1]);
      const titleParts = urlMatch[2].split('-');
      if (titleParts.length >= 2) {
        result.make = titleParts[0];
        result.model = titleParts.slice(1).join(' ');
      }
    }

    // Extract title from page
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      if (!result.year) {
        const yearMatch = title.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) result.year = parseInt(yearMatch[0]);
      }
      
      if (!result.make || !result.model) {
        const afterYear = title.replace(/\b(19|20)\d{2}\b/, '').trim();
        const parts = afterYear.split(/\s+/);
        if (parts.length >= 2) {
          result.make = parts[0];
          result.model = parts.slice(1).join(' ');
        }
      }
    }

    // Extract price
    const priceMatch = html.match(/\$([\d,]+)/g);
    if (priceMatch) {
      // Take the largest price (usually the asking price)
      const prices = priceMatch.map(m => parseInt(m.replace(/[$,]/g, '')));
      result.price = Math.max(...prices);
    }

    // Extract VIN
    result.vin = this.extractVIN(html);

    // Extract mileage
    const mileageMatch = html.match(/(?:mileage|odometer|miles)[:\s]*([\d,]+)/i);
    if (mileageMatch) {
      result.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
    }

    // Extract description
    const descMatch = html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (descMatch) {
      result.description = descMatch[1].replace(/<[^>]+>/g, ' ').trim().substring(0, 5000);
    }

    // Extract images
    const images: string[] = [];
    const imgMatches = html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi);
    for (const match of imgMatches) {
      const src = match[1];
      if (src && (src.includes('vehicle') || src.includes('inventory')) && 
          !src.includes('logo') && !src.includes('icon')) {
        const fullUrl = src.startsWith('http') ? src : `https://www.affordableclassicsinc.com${src}`;
        if (!images.includes(fullUrl)) {
          images.push(fullUrl);
        }
      }
    }
    result.images = images.slice(0, 50);

    // Extract location
    const locationMatch = html.match(/(?:location|located)[:\s]*([^<\n,]+(?:,\s*[A-Z]{2})?)/i);
    if (locationMatch) {
      result.location = locationMatch[1].trim();
    }

    // Seller info
    result.seller = 'Affordable Classics Inc';

    return result;
  }

  /**
   * Parse Classic.com vehicle profile
   * Example: https://www.classic.com/veh/1996-ford-mustang-gt-1falp45x4tfz21604-n3xovEW/
   */
  private async parseClassicComListing(url: string, html: string): Promise<Partial<ParsedListing>> {
    const result: Partial<ParsedListing> = {};

    // Extract from URL pattern: /veh/YEAR-MAKE-MODEL-VIN-/
    const urlMatch = url.match(/\/veh\/(\d{4})-([^-]+)-([^-]+)-([^-]+)-/);
    if (urlMatch) {
      result.year = parseInt(urlMatch[1]);
      result.make = urlMatch[2].replace(/-/g, ' ');
      result.model = urlMatch[3].replace(/-/g, ' ');
      result.vin = urlMatch[4].toUpperCase();
    }

    // Extract title
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      if (!result.year) {
        const yearMatch = title.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) result.year = parseInt(yearMatch[0]);
      }
    }

    // Extract VIN from page if not in URL
    if (!result.vin) {
      result.vin = this.extractVIN(html);
    }

    // Extract price (sold price or asking price)
    const priceMatch = html.match(/\$([\d,]+)/g);
    if (priceMatch) {
      const prices = priceMatch.map(m => parseInt(m.replace(/[$,]/g, '')));
      result.price = Math.max(...prices);
    }

    // Check if sold
    const soldMatch = html.match(/sold\s+(?:for|at)\s+\$?([\d,]+)/i);
    if (soldMatch) {
      result.sold_price = parseInt(soldMatch[1].replace(/,/g, ''));
    }

    // Extract mileage
    const mileageMatch = html.match(/([\d,]+)\s*(?:mi|miles|mile)/i);
    if (mileageMatch) {
      result.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
    }

    // Extract images
    const images: string[] = [];
    const imgMatches = html.matchAll(/<img[^>]+src="([^"]*classic\.com[^"]*)"[^>]*>/gi);
    for (const match of imgMatches) {
      const src = match[1];
      if (src && !src.includes('logo') && !src.includes('icon')) {
        if (!images.includes(src)) {
          images.push(src);
        }
      }
    }
    result.images = images.slice(0, 50);

    // Extract description
    const descMatch = html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (descMatch) {
      result.description = descMatch[1].replace(/<[^>]+>/g, ' ').trim().substring(0, 5000);
    }

    return result;
  }

  /**
   * Parse Goxee Dealer listing (generic parser)
   */
  private async parseGoxeeListing(url: string, html: string): Promise<Partial<ParsedListing>> {
    const result: Partial<ParsedListing> = {};

    // Generic extraction - try common patterns
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      const yearMatch = title.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        result.year = parseInt(yearMatch[0]);
      }
      
      const afterYear = title.replace(/\b(19|20)\d{2}\b/, '').trim();
      const parts = afterYear.split(/\s+/);
      if (parts.length >= 2) {
        result.make = parts[0];
        result.model = parts.slice(1, 3).join(' ');
      }
    }

    // Extract VIN
    result.vin = this.extractVIN(html);

    // Extract price
    const priceMatch = html.match(/\$([\d,]+)/);
    if (priceMatch) {
      result.price = parseInt(priceMatch[1].replace(/,/g, ''));
    }

    // Extract images
    const images: string[] = [];
    const imgMatches = html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi);
    for (const match of imgMatches) {
      const src = match[1];
      if (src && src.match(/\.(jpg|jpeg|png|webp)/i) && !src.includes('logo')) {
        const fullUrl = src.startsWith('http') ? src : new URL(src, url).href;
        if (!images.includes(fullUrl)) {
          images.push(fullUrl);
        }
      }
    }
    result.images = images.slice(0, 50);

    return result;
  }

  /**
   * Main parse function - fetches and parses any listing URL
   */
  async parseListingURL(url: string): Promise<ParsedListing> {
    const source = this.identifySource(url);

    try {
      // Fetch via edge function (avoids CORS)
      console.log(`Fetching listing from ${source}:`, url);
      
      const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
        body: { url }
      });
      
      if (error || !data) {
        throw new Error(`Failed to fetch listing: ${error?.message || 'Unknown error'}`);
      }
      
      const html = data.html || data.content || '';

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
        
        case 'classiccars':
          parsed = { ...parsed, ...(await this.parseClassicCarsListing(url, html)) };
          break;
        
        case 'affordableclassics':
          parsed = { ...parsed, ...(await this.parseAffordableClassicsListing(url, html)) };
          break;
        
        case 'classiccom':
          parsed = { ...parsed, ...(await this.parseClassicComListing(url, html)) };
          break;
        
        case 'goxee':
          parsed = { ...parsed, ...(await this.parseGoxeeListing(url, html)) };
          break;
        
        case 'ksl':
          // KSL parser already exists in scrape-vehicle function
          parsed.vin = this.extractVIN(html);
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

