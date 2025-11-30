/**
 * Organization from Source Service
 * Automatically creates organizations for dealer/auction house sources
 * and links vehicles to them for proper responsibility flow
 */

import { supabase } from '../lib/supabase';

export interface SourceOrganizationMap {
  sourceName: string;
  websiteUrl: string;
  businessName: string;
  businessType: 'dealership' | 'auction_house' | 'marketplace' | 'garage';
  description?: string;
}

// Map of known listing sources to organization details
const SOURCE_TO_ORG_MAP: Record<string, SourceOrganizationMap> = {
  'affordableclassics': {
    sourceName: 'Affordable Classics Inc',
    websiteUrl: 'https://www.affordableclassicsinc.com',
    businessName: 'Affordable Classics Inc',
    businessType: 'dealership',
    description: 'Classic car dealership specializing in vintage vehicles'
  },
  'classiccars': {
    sourceName: 'ClassicCars.com',
    websiteUrl: 'https://www.classiccars.com',
    businessName: 'ClassicCars.com',
    businessType: 'marketplace',
    description: 'Online marketplace for classic and collector vehicles'
  },
  'classiccom': {
    sourceName: 'Classic.com',
    websiteUrl: 'https://www.classic.com',
    businessName: 'Classic.com',
    businessType: 'marketplace',
    description: 'Classic car market data and listings aggregator'
  },
  'goxee': {
    sourceName: 'Goxee Dealer',
    websiteUrl: 'https://www.goxeedealer.com',
    businessName: 'Goxee Dealer',
    businessType: 'dealership',
    description: 'Automotive dealership'
  },
  'ksl': {
    sourceName: 'KSL Cars',
    websiteUrl: 'https://cars.ksl.com',
    businessName: 'KSL Cars',
    businessType: 'marketplace',
    description: 'Regional automotive marketplace'
  },
  'bat': {
    sourceName: 'Bring a Trailer',
    websiteUrl: 'https://bringatrailer.com',
    businessName: 'Bring a Trailer',
    businessType: 'auction_house',
    description: 'Online auction platform for enthusiast vehicles'
  },
  'ebay': {
    sourceName: 'eBay Motors',
    websiteUrl: 'https://www.ebay.com/motors',
    businessName: 'eBay Motors',
    businessType: 'marketplace',
    description: 'Online marketplace for vehicles and parts'
  },
  'carscom': {
    sourceName: 'Cars.com',
    websiteUrl: 'https://www.cars.com',
    businessName: 'Cars.com',
    businessType: 'marketplace',
    description: 'Automotive marketplace and research platform'
  }
};

class OrganizationFromSourceService {
  /**
   * Get organization mapping for a listing source
   */
  getOrganizationMap(source: string): SourceOrganizationMap | null {
    const sourceLower = source.toLowerCase();
    
    // Direct match
    if (SOURCE_TO_ORG_MAP[sourceLower]) {
      return SOURCE_TO_ORG_MAP[sourceLower];
    }
    
    // Partial match (e.g., "affordableclassics" matches "affordableclassicsinc.com")
    for (const [key, map] of Object.entries(SOURCE_TO_ORG_MAP)) {
      if (sourceLower.includes(key) || key.includes(sourceLower)) {
        return map;
      }
    }
    
    // Check if source looks like a dealer/auction house
    if (this.looksLikeOrganization(source)) {
      return {
        sourceName: source,
        websiteUrl: this.extractWebsiteUrl(source),
        businessName: this.extractBusinessName(source),
        businessType: this.inferBusinessType(source),
        description: `Automotive ${this.inferBusinessType(source).replace('_', ' ')}`
      };
    }
    
    return null;
  }

  /**
   * Check if a source name looks like it could be an organization
   */
  private looksLikeOrganization(source: string): boolean {
    const sourceLower = source.toLowerCase();
    
    // Patterns that indicate an organization
    const orgPatterns = [
      /inc\.?$/i,
      /llc\.?$/i,
      /corp\.?$/i,
      /dealer/i,
      /motors/i,
      /classics/i,
      /auto/i,
      /garage/i,
      /shop/i,
      /auction/i,
      /marketplace/i,
      /\.com$/i
    ];
    
    return orgPatterns.some(pattern => pattern.test(sourceLower));
  }

  /**
   * Extract website URL from source
   */
  private extractWebsiteUrl(source: string): string {
    // If it already looks like a URL, return it
    if (source.startsWith('http://') || source.startsWith('https://')) {
      return source;
    }
    
    // Try to construct from source name
    const clean = source.toLowerCase()
      .replace(/\s+/g, '')
      .replace(/\.(com|net|org)$/i, '');
    
    return `https://www.${clean}.com`;
  }

  /**
   * Extract business name from source
   */
  private extractBusinessName(source: string): string {
    // Remove common suffixes
    return source
      .replace(/\s+(inc|llc|corp|dealer|motors)\.?$/i, '')
      .trim();
  }

  /**
   * Infer business type from source name
   */
  private inferBusinessType(source: string): 'dealership' | 'auction_house' | 'marketplace' | 'garage' {
    const sourceLower = source.toLowerCase();
    
    if (sourceLower.includes('auction') || sourceLower.includes('bat')) {
      return 'auction_house';
    }
    
    if (sourceLower.includes('marketplace') || sourceLower.includes('.com')) {
      return 'marketplace';
    }
    
    if (sourceLower.includes('garage') || sourceLower.includes('shop')) {
      return 'garage';
    }
    
    // Default to dealership
    return 'dealership';
  }

  /**
   * Find or create organization from listing source
   */
  async findOrCreateOrganization(
    source: string,
    listingUrl?: string,
    additionalInfo?: {
      seller?: string;
      location?: string;
      phone?: string;
      email?: string;
    }
  ): Promise<string | null> {
    const orgMap = this.getOrganizationMap(source);
    
    if (!orgMap) {
      console.log(`Source "${source}" does not map to an organization`);
      return null;
    }

    // Try to find existing organization by website URL
    const { data: existing } = await supabase
      .from('businesses')
      .select('id')
      .eq('website', orgMap.websiteUrl)
      .maybeSingle();

    if (existing) {
      console.log(`Found existing organization: ${orgMap.businessName}`);
      return existing.id;
    }

    // Try to find by business name
    const { data: existingByName } = await supabase
      .from('businesses')
      .select('id')
      .ilike('business_name', orgMap.businessName)
      .maybeSingle();

    if (existingByName) {
      // Update website if missing
      await supabase
        .from('businesses')
        .update({ website: orgMap.websiteUrl })
        .eq('id', existingByName.id);
      
      return existingByName.id;
    }

    // Create new organization
    console.log(`Creating new organization: ${orgMap.businessName}`);
    
    const orgData: any = {
      business_name: orgMap.businessName,
      business_type: orgMap.businessType,
      website: orgMap.websiteUrl,
      description: orgMap.description || `Automotive ${orgMap.businessType.replace('_', ' ')}`,
      is_public: true,
      is_tradable: false
    };

    // Add additional info if provided
    if (additionalInfo) {
      if (additionalInfo.location) {
        const locationParts = additionalInfo.location.split(',').map(s => s.trim());
        if (locationParts.length >= 2) {
          orgData.city = locationParts[0];
          orgData.state = locationParts[1];
        } else {
          orgData.city = additionalInfo.location;
        }
      }
      
      if (additionalInfo.phone) orgData.phone = additionalInfo.phone;
      if (additionalInfo.email) orgData.email = additionalInfo.email;
    }

    const { data: newOrg, error } = await supabase
      .from('businesses')
      .insert(orgData)
      .select('id')
      .single();

    if (error) {
      console.error(`Error creating organization:`, error);
      return null;
    }

    console.log(`Created organization: ${orgMap.businessName} (${newOrg.id})`);
    return newOrg.id;
  }

  /**
   * Link vehicle to organization from source
   */
  async linkVehicleToSourceOrganization(
    vehicleId: string,
    source: string,
    listingUrl?: string,
    relationshipType: 'owner' | 'seller' | 'inventory' = 'inventory',
    additionalInfo?: {
      seller?: string;
      location?: string;
      phone?: string;
      email?: string;
    }
  ): Promise<string | null> {
    const organizationId = await this.findOrCreateOrganization(source, listingUrl, additionalInfo);
    
    if (!organizationId) {
      return null;
    }

    // Check if link already exists
    const { data: existing } = await supabase
      .from('organization_vehicles')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('vehicle_id', vehicleId)
      .maybeSingle();

    if (existing) {
      console.log(`Vehicle ${vehicleId} already linked to organization ${organizationId}`);
      return organizationId;
    }

    // Create link
    const { error } = await supabase
      .from('organization_vehicles')
      .insert({
        organization_id: organizationId,
        vehicle_id: vehicleId,
        relationship_type: relationshipType,
        status: 'for_sale', // Assuming listings are for sale
        listing_url: listingUrl,
        notes: `Imported from ${source} listing`
      });

    if (error) {
      console.error(`Error linking vehicle to organization:`, error);
      return null;
    }

    console.log(`Linked vehicle ${vehicleId} to organization ${organizationId}`);
    return organizationId;
  }
}

export const organizationFromSource = new OrganizationFromSourceService();

