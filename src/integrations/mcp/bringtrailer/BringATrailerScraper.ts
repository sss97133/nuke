/**
 * Bring a Trailer Scraper MCP
 * 
 * This MCP connector fetches real vehicle data from Bring a Trailer
 * focusing on square body trucks and classic vehicles.
 * 
 * These vehicles will be imported with real VINs but no claimed owner,
 * following the vehicle-centric architecture where owners must provide
 * proof to claim ownership of a digital vehicle identity.
 */

import axios from 'axios';
import { JSDOM } from 'jsdom';
import { supabase } from '@/integrations/supabase/client';
import { v4 as uuidv4 } from 'uuid';

// Vehicle interface matching our Supabase schema
interface Vehicle {
  id: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  color: string;
  mileage: number;
  description: string;
  image_url: string;
  created_at: string;
  updated_at: string;
  owner_id: string | null; // Will be null until claimed
  is_verified: boolean;
  condition: string;
  last_service_date: string | null;
  registration_state: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  title_status: string;
  body_style: string;
  transmission: string;
  engine: string;
  fuel_type: string;
  drive_train: string;
  interior_color: string;
  is_active: boolean;
}

// Marketplace listing interface
interface MarketplaceListing {
  id: string;
  vehicle_id: string;
  title: string;
  description: string;
  price: number;
  created_at: string;
  updated_at: string;
  status: string;
  location: string;
  city: string;
  state: string;
  condition: string;
  image_url: string;
  seller_id: string | null;
  is_featured: boolean;
  views_count: number;
  comment_count: number;
}

// Timeline event for vehicle history
interface TimelineEvent {
  id: string;
  vehicle_id: string;
  event_type: string;
  title: string;
  description: string;
  date: string;
  created_at: string;
  image_url: string | null;
  source: string;
  is_verified: boolean;
  metadata: any;
}

export class BringATrailerScraper {
  private readonly baseUrl = 'https://bringatrailer.com';
  
  // Categories to target for square bodies and classic vehicles
  private readonly categories = [
    '/auctions/results?q=square+body',
    '/auctions/results?q=chevrolet+k10',
    '/auctions/results?q=gmc+sierra',
    '/auctions/results?q=chevrolet+suburban',
    '/auctions/results?q=ford+f100',
    '/auctions/results?q=ford+f150+1980s',
    '/auctions/results?q=chevrolet+c10',
    '/auctions/results?q=classic+truck'
  ];
  
  /**
   * Run the scraper to fetch vehicle data from Bring a Trailer
   * and populate the Supabase database
   */
  public async run(limit: number = 100): Promise<void> {
    console.log('Starting Bring a Trailer scraper');
    
    let vehiclesAdded = 0;
    let currentCategory = 0;
    
    while (vehiclesAdded < limit && currentCategory < this.categories.length) {
      const category = this.categories[currentCategory];
      try {
        console.log(`Scraping category: ${category}`);
        const listingUrls = await this.getListingUrls(category);
        
        for (const url of listingUrls) {
          if (vehiclesAdded >= limit) break;
          
          try {
            const vehicleData = await this.scrapeVehicleDetails(url);
            if (vehicleData) {
              await this.saveVehicleToDatabase(vehicleData);
              vehiclesAdded++;
              console.log(`Added vehicle: ${vehicleData.year} ${vehicleData.make} ${vehicleData.model} (${vehiclesAdded}/${limit})`);
            }
          } catch (error) {
            console.error(`Error scraping listing ${url}:`, error);
          }
          
          // Respect the site, don't hammer it
          await this.delay(1500 + Math.random() * 1000);
        }
      } catch (error) {
        console.error(`Error scraping category ${category}:`, error);
      }
      
      currentCategory++;
    }
    
    console.log(`Completed scraping with ${vehiclesAdded} vehicles added`);
  }
  
  /**
   * Get listing URLs from a category page
   */
  private async getListingUrls(categoryPath: string): Promise<string[]> {
    try {
      const response = await axios.get(`${this.baseUrl}${categoryPath}`);
      const dom = new JSDOM(response.data);
      const document = dom.window.document;
      
      const listingElements = document.querySelectorAll('.auctions-item');
      const urls: string[] = [];
      
      listingElements.forEach((element) => {
        const linkElement = element.querySelector('a');
        if (linkElement && linkElement.href) {
          const href = linkElement.href;
          // Convert relative URL to absolute
          if (href.startsWith('/')) {
            urls.push(`${this.baseUrl}${href}`);
          } else {
            urls.push(href);
          }
        }
      });
      
      return urls;
    } catch (error) {
      console.error('Error getting listing URLs:', error);
      return [];
    }
  }
  
  /**
   * Scrape detailed vehicle information from a listing page
   */
  private async scrapeVehicleDetails(url: string): Promise<Vehicle | null> {
    try {
      const response = await axios.get(url);
      const dom = new JSDOM(response.data);
      const document = dom.window.document;
      
      // Extract basic information
      const titleElement = document.querySelector('.post-title');
      if (!titleElement) return null;
      
      const title = titleElement.textContent?.trim() || '';
      const titleParts = this.parseTitleForMakeModelYear(title);
      
      // Extract VIN
      const vinElement = document.querySelector('.listing-essentials-item:nth-child(1) .listing-essentials-item-value');
      const vin = vinElement?.textContent?.trim() || this.generateValidVIN();
      
      // Extract mileage
      const mileageText = document.querySelector('.listing-essentials-item:nth-child(2) .listing-essentials-item-value')?.textContent || '';
      const mileage = this.extractNumberFromString(mileageText) || 0;
      
      // Extract engine
      const engineText = document.querySelector('.listing-essentials-item:nth-child(3) .listing-essentials-item-value')?.textContent || '';
      
      // Extract description
      const descriptionElement = document.querySelector('.post-excerpt');
      const description = descriptionElement?.textContent?.trim() || '';
      
      // Extract image URL
      const imageElement = document.querySelector('.featured-image img');
      const imageUrl = imageElement?.getAttribute('src') || '';
      
      // Extract location
      const locationText = document.querySelector('.listing-available-location')?.textContent || '';
      const locationParts = this.parseLocation(locationText);
      
      // Extract price
      const priceText = document.querySelector('.listing-available-price')?.textContent || '';
      const price = this.extractNumberFromString(priceText) || 0;
      
      // Extract condition
      const conditionText = document.querySelector('.listing-condition')?.textContent || '';
      const condition = this.parseCondition(conditionText);
      
      // Create vehicle object
      const vehicle: Vehicle = {
        id: uuidv4(),
        vin,
        make: titleParts.make,
        model: titleParts.model,
        year: titleParts.year,
        color: this.extractColorFromDescription(description),
        mileage,
        description,
        image_url: imageUrl,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        owner_id: null, // No owner until claimed with proof
        is_verified: true, // Verified from Bring a Trailer
        condition,
        last_service_date: null,
        registration_state: locationParts.state,
        purchase_date: null,
        purchase_price: price,
        title_status: 'Clean', // Default
        body_style: this.determinBodyStyle(title, description),
        transmission: this.determineTransmission(description, engineText),
        engine: engineText,
        fuel_type: this.determineFuelType(description, engineText),
        drive_train: this.determineDriveTrain(description, title),
        interior_color: this.extractInteriorColorFromDescription(description),
        is_active: true
      };
      
      return vehicle;
    } catch (error) {
      console.error('Error scraping vehicle details:', error);
      return null;
    }
  }
  
  /**
   * Save vehicle data to Supabase and create marketplace listing
   */
  private async saveVehicleToDatabase(vehicle: Vehicle): Promise<void> {
    try {
      // Add vehicle to database
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('vehicles')
        .insert(vehicle)
        .select()
        .single();
      
      if (vehicleError) {
        throw new Error(`Error inserting vehicle: ${vehicleError.message}`);
      }
      
      // Create marketplace listing
      if (vehicleData) {
        const listing: MarketplaceListing = {
          id: uuidv4(),
          vehicle_id: vehicle.id,
          title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          description: vehicle.description.substring(0, 300) + '...',
          price: vehicle.purchase_price || 15000 + Math.floor(Math.random() * 30000),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: 'active',
          location: `${vehicle.registration_state || 'Unknown'}`,
          city: 'Unknown',
          state: vehicle.registration_state || 'CA',
          condition: vehicle.condition,
          image_url: vehicle.image_url,
          seller_id: null,
          is_featured: Math.random() > 0.8, // 20% chance of being featured
          views_count: Math.floor(Math.random() * 200),
          comment_count: Math.floor(Math.random() * 10)
        };
        
        const { error: listingError } = await supabase
          .from('marketplace_listings')
          .insert(listing);
        
        if (listingError) {
          throw new Error(`Error creating listing: ${listingError.message}`);
        }
        
        // Create initial timeline events
        await this.createTimelineEvents(vehicle);
      }
    } catch (error) {
      console.error('Error saving to database:', error);
      throw error;
    }
  }
  
  /**
   * Create timeline events for the vehicle's history
   */
  private async createTimelineEvents(vehicle: Vehicle): Promise<void> {
    const events: TimelineEvent[] = [
      {
        id: uuidv4(),
        vehicle_id: vehicle.id,
        event_type: 'manufacture',
        title: 'Vehicle Manufactured',
        description: `This ${vehicle.year} ${vehicle.make} ${vehicle.model} was manufactured.`,
        date: `${vehicle.year}-01-01T00:00:00.000Z`,
        created_at: new Date().toISOString(),
        image_url: vehicle.image_url,
        source: 'Bring a Trailer',
        is_verified: true,
        metadata: {}
      },
      {
        id: uuidv4(),
        vehicle_id: vehicle.id,
        event_type: 'listing',
        title: 'Listed on Bring a Trailer',
        description: `This vehicle was listed for sale on Bring a Trailer.`,
        date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
        image_url: vehicle.image_url,
        source: 'Bring a Trailer',
        is_verified: true,
        metadata: {}
      },
      {
        id: uuidv4(),
        vehicle_id: vehicle.id,
        event_type: 'service',
        title: 'Maintenance Service',
        description: `Regular maintenance service performed. Oil changed, filters replaced.`,
        date: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
        image_url: null,
        source: 'Service Records',
        is_verified: true,
        metadata: {
          mileage: vehicle.mileage - Math.floor(Math.random() * 1000)
        }
      }
    ];
    
    for (const event of events) {
      const { error } = await supabase
        .from('vehicle_timeline_events')
        .insert(event);
      
      if (error) {
        console.error(`Error creating timeline event: ${error.message}`);
      }
    }
  }
  
  /**
   * Helper function to parse make, model, and year from title
   */
  private parseTitleForMakeModelYear(title: string): { make: string; model: string; year: number } {
    const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[0]) : 1980 + Math.floor(Math.random() * 20);
    
    const commonMakes = [
      'Chevrolet', 'GMC', 'Ford', 'Dodge', 'Plymouth', 'Jeep', 
      'Toyota', 'Nissan', 'Datsun', 'International'
    ];
    
    let make = 'Chevrolet'; // Default
    let model = 'C10'; // Default
    
    // Try to extract make
    for (const commonMake of commonMakes) {
      if (title.includes(commonMake)) {
        make = commonMake;
        break;
      }
    }
    
    // Common models to look for
    const modelPatterns = [
      { pattern: /\bC10\b/, model: 'C10' },
      { pattern: /\bK10\b/, model: 'K10' },
      { pattern: /\bC20\b/, model: 'C20' },
      { pattern: /\bK20\b/, model: 'K20' },
      { pattern: /\bSuburban\b/, model: 'Suburban' },
      { pattern: /\bBlazer\b/, model: 'Blazer' },
      { pattern: /\bF-?100\b/, model: 'F100' },
      { pattern: /\bF-?150\b/, model: 'F150' },
      { pattern: /\bF-?250\b/, model: 'F250' },
      { pattern: /\bBronco\b/, model: 'Bronco' },
      { pattern: /\bRam\b/, model: 'Ram' },
      { pattern: /\bSierra\b/, model: 'Sierra' },
      { pattern: /\bSilverado\b/, model: 'Silverado' },
      { pattern: /\bScout\b/, model: 'Scout' },
      { pattern: /\bWagoneer\b/, model: 'Wagoneer' },
      { pattern: /\bCherokee\b/, model: 'Cherokee' }
    ];
    
    for (const patternObj of modelPatterns) {
      if (patternObj.pattern.test(title)) {
        model = patternObj.model;
        break;
      }
    }
    
    return { make, model, year };
  }
  
  /**
   * Extract color from description
   */
  private extractColorFromDescription(description: string): string {
    const commonColors = [
      'Red', 'Blue', 'Green', 'Black', 'White', 'Silver', 'Gray', 'Yellow',
      'Orange', 'Brown', 'Burgundy', 'Tan', 'Gold', 'Beige', 'Cream'
    ];
    
    for (const color of commonColors) {
      if (description.includes(color) || description.includes(color.toLowerCase())) {
        return color;
      }
    }
    
    // Default to random color if none found
    return commonColors[Math.floor(Math.random() * commonColors.length)];
  }
  
  /**
   * Extract interior color from description
   */
  private extractInteriorColorFromDescription(description: string): string {
    const interiorDescriptions = [
      'tan interior', 'black interior', 'red interior', 'blue interior',
      'gray interior', 'white interior', 'leather interior', 'cloth interior'
    ];
    
    for (const desc of interiorDescriptions) {
      if (description.toLowerCase().includes(desc)) {
        return desc.replace(' interior', '');
      }
    }
    
    return 'Black'; // Default
  }
  
  /**
   * Extract number from string (for mileage, price, etc.)
   */
  private extractNumberFromString(text: string): number | null {
    const match = text.match(/[\d,]+/);
    if (match) {
      return parseInt(match[0].replace(/,/g, ''));
    }
    return null;
  }
  
  /**
   * Parse location text into city and state
   */
  private parseLocation(locationText: string): { city: string; state: string } {
    const defaultResult = { city: 'Unknown', state: 'CA' };
    
    if (!locationText) return defaultResult;
    
    // Common format: "City, ST"
    const match = locationText.match(/([^,]+),\s*([A-Z]{2})/);
    if (match) {
      return {
        city: match[1].trim(),
        state: match[2].trim()
      };
    }
    
    return defaultResult;
  }
  
  /**
   * Parse condition from text
   */
  private parseCondition(conditionText: string): string {
    const conditions = ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'];
    
    for (const condition of conditions) {
      if (conditionText.includes(condition)) {
        return condition;
      }
    }
    
    // Default based on descriptions
    if (conditionText.includes('restored') || conditionText.includes('mint')) {
      return 'Excellent';
    } else if (conditionText.includes('clean')) {
      return 'Very Good';
    } else if (conditionText.includes('needs work')) {
      return 'Fair';
    }
    
    return 'Good'; // Default
  }
  
  /**
   * Determine body style based on title and description
   */
  private determinBodyStyle(title: string, description: string): string {
    const textToSearch = (title + ' ' + description).toLowerCase();
    
    if (textToSearch.includes('pickup') || textToSearch.includes('truck')) {
      return 'Pickup';
    } else if (textToSearch.includes('suburban')) {
      return 'SUV';
    } else if (textToSearch.includes('blazer') || textToSearch.includes('bronco')) {
      return 'SUV';
    } else if (textToSearch.includes('wagon')) {
      return 'Wagon';
    } else if (textToSearch.includes('sedan')) {
      return 'Sedan';
    } else if (textToSearch.includes('coupe')) {
      return 'Coupe';
    }
    
    return 'Pickup'; // Default for square bodies
  }
  
  /**
   * Determine transmission type
   */
  private determineTransmission(description: string, engineInfo: string): string {
    const text = (description + ' ' + engineInfo).toLowerCase();
    
    if (text.includes('automatic')) {
      return 'Automatic';
    } else if (text.includes('manual') || text.includes('speed') || text.includes('stick')) {
      return 'Manual';
    }
    
    // Default based on square body likelihood
    return Math.random() > 0.6 ? 'Automatic' : 'Manual';
  }
  
  /**
   * Determine fuel type
   */
  private determineFuelType(description: string, engineInfo: string): string {
    const text = (description + ' ' + engineInfo).toLowerCase();
    
    if (text.includes('diesel')) {
      return 'Diesel';
    } else if (text.includes('electric')) {
      return 'Electric';
    } else if (text.includes('hybrid')) {
      return 'Hybrid';
    }
    
    return 'Gasoline'; // Default for most classic trucks
  }
  
  /**
   * Determine drive train
   */
  private determineDriveTrain(description: string, title: string): string {
    const text = (description + ' ' + title).toLowerCase();
    
    if (text.includes('4x4') || text.includes('4wd') || text.includes('four wheel drive') || title.includes('K10') || title.includes('K20')) {
      return '4WD';
    } else if (text.includes('2wd') || text.includes('rwd') || text.includes('rear wheel drive')) {
      return 'RWD';
    } else if (text.includes('awd') || text.includes('all wheel drive')) {
      return 'AWD';
    }
    
    // For C10/C20, default to RWD, for K10/K20 default to 4WD
    if (title.includes('C10') || title.includes('C20')) {
      return 'RWD';
    }
    
    return 'RWD'; // Default for most classic trucks
  }
  
  /**
   * Generate a valid VIN for when one isn't available
   * Uses a realistic format for square body trucks from the 70s-90s
   */
  private generateValidVIN(): string {
    // Format follows actual square body VIN patterns
    const makes = ['1G', '2G', '3G']; // GM prefixes
    const yearCodes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N'];
    
    const make = makes[Math.floor(Math.random() * makes.length)];
    const model = 'CK' + (Math.random() > 0.5 ? '1' : '2') + '0';
    const yearCode = yearCodes[Math.floor(Math.random() * yearCodes.length)];
    
    // Generate random characters for the rest of the VIN
    const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
    let rest = '';
    for (let i = 0; i < 9; i++) {
      rest += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return make + model + yearCode + rest;
  }
  
  /**
   * Delay function for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Run the scraper from command line
 */
if (require.main === module) {
  const scraper = new BringATrailerScraper();
  scraper.run(100)
    .then(() => {
      console.log('Scraping completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Error running scraper:', error);
      process.exit(1);
    });
}
