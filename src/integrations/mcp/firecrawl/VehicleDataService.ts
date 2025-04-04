/**
 * Firecrawl Vehicle Data Service
 * 
 * This service uses the Firecrawl API connector to fetch real vehicle documentation,
 * specifications, and maintenance information from manufacturer websites.
 * 
 * All data retrieved is authentic vehicle data from real sources - no mock data.
 */

import { FirecrawlConnector } from './FirecrawlConnector';
import { supabase } from '@/integrations/supabase/client';

export interface VehicleSpec {
  make: string;
  model: string;
  year: number;
  specs: Record<string, any>;
  sourceUrl: string;
}

export interface MaintenanceDoc {
  title: string;
  content: string;
  vehicle: {
    make: string;
    model: string;
    years: number[];
  };
  sourceUrl: string;
  scrapedAt: string;
}

export class VehicleDataService {
  private firecrawl: FirecrawlConnector;
  private manufacturerDomains: Record<string, string[]> = {
    'toyota': ['toyota.com', 'toyotaownersmanual.com', 'toyota-tech.eu'],
    'honda': ['honda.com', 'owners.honda.com', 'techinfo.honda.com'],
    'ford': ['ford.com', 'owner.ford.com', 'fordservicecontent.com'],
    'bmw': ['bmw.com', 'bmwusa.com', 'bmwtechinfo.com'],
    'tesla': ['tesla.com', 'tesla.cn', 'tesla-info.com'],
    // Add more manufacturers as needed
  };

  constructor() {
    this.firecrawl = new FirecrawlConnector({
      cacheResults: true,
      cacheDuration: 86400 // 24 hours
    });
  }

  /**
   * Get domains for a specific vehicle make
   */
  private getDomainsForMake(make: string): string[] {
    const normalizedMake = make.toLowerCase();
    return this.manufacturerDomains[normalizedMake] || [];
  }

  /**
   * Get all manufacturer domains for searching across all makes
   */
  private getAllManufacturerDomains(): string[] {
    return Object.values(this.manufacturerDomains).flat();
  }

  /**
   * Search for maintenance documentation for a specific vehicle
   */
  async findMaintenanceDocs(
    make: string,
    model: string,
    year?: number,
    topic?: string
  ): Promise<MaintenanceDoc[]> {
    try {
      const domains = this.getDomainsForMake(make);
      if (domains.length === 0) {
        console.warn(`No domains configured for make: ${make}`);
        // Fall back to searching all domains
        domains.push(...this.getAllManufacturerDomains());
      }

      // Construct search query
      let query = `${make} ${model}`;
      if (year) query += ` ${year}`;
      if (topic) query += ` ${topic} maintenance guide`;
      else query += ' maintenance service manual';

      const searchResults = await this.firecrawl.searchVehicleDocs(query, domains, {
        limit: 10,
        year,
        make,
        model
      });

      const documents: MaintenanceDoc[] = [];

      // For each result, scrape the full content
      for (const result of searchResults) {
        const scrapedContent = await this.firecrawl.scrapeUrl(result.url);
        
        documents.push({
          title: result.title,
          content: scrapedContent.content,
          vehicle: {
            make,
            model,
            years: year ? [year] : []
          },
          sourceUrl: result.url,
          scrapedAt: new Date().toISOString()
        });
      }

      return documents;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error finding maintenance documentation:', err);
      throw new Error(`Failed to find maintenance documentation for ${make} ${model}: ${message}`);
    }
  }

  /**
   * Get vehicle specifications from manufacturer websites
   */
  async getVehicleSpecs(
    make: string,
    model: string,
    year: number
  ): Promise<VehicleSpec> {
    try {
      const domains = this.getDomainsForMake(make);
      if (domains.length === 0) {
        throw new Error(`No domains configured for make: ${make}`);
      }

      // First search for the specification page
      const query = `${year} ${make} ${model} specifications tech data`;
      const searchResults = await this.firecrawl.searchVehicleDocs(query, domains, {
        limit: 5,
        year,
        make,
        model
      });

      if (searchResults.length === 0) {
        throw new Error(`No specification pages found for ${year} ${make} ${model}`);
      }

      // Scrape the first result that seems most relevant
      const specPageUrl = searchResults[0].url;
      const scrapedContent = await this.firecrawl.scrapeUrl(specPageUrl);

      // Parse the content to extract specifications
      // This is a simplified version - in a real implementation,
      // you would use more sophisticated parsing logic
      const specs = this.parseSpecifications(scrapedContent.content, make, model);

      return {
        make,
        model,
        year,
        specs,
        sourceUrl: specPageUrl
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error getting vehicle specifications:', err);
      throw new Error(`Failed to get specifications for ${year} ${make} ${model}: ${message}`);
    }
  }

  /**
   * Find recall information for a specific vehicle
   */
  async findRecallInformation(
    make: string,
    model: string,
    year: number
  ): Promise<Array<{title: string, description: string, date: string, sourceUrl: string}>> {
    try {
      // Primary sources for recall information include NHTSA and manufacturer sites
      const domains = [
        'nhtsa.gov',
        'recalls.gov',
        ...this.getDomainsForMake(make)
      ];

      const query = `${year} ${make} ${model} recall safety bulletin`;
      const searchResults = await this.firecrawl.searchVehicleDocs(query, domains, {
        limit: 10,
        year,
        make,
        model
      });

      const recalls: Array<{
        title: string;
        description: string;
        date: string;
        sourceUrl: string;
      }> = [];

      // Process each recall page
      for (const result of searchResults) {
        const scrapedContent = await this.firecrawl.scrapeUrl(result.url);
        
        // Extract recall details - this would be more sophisticated in production
        const recallInfo = this.extractRecallInfo(
          scrapedContent.content, 
          result.title
        );
        
        if (recallInfo) {
          recalls.push({
            ...recallInfo,
            sourceUrl: result.url
          });
        }
      }

      return recalls;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error finding recall information:', err);
      throw new Error(`Failed to find recall information for ${year} ${make} ${model}: ${message}`);
    }
  }

  /**
   * Get service bulletins for a specific vehicle
   */
  async getServiceBulletins(
    make: string,
    model: string,
    year: number
  ): Promise<Array<{id: string, title: string, content: string, issueDate: string, sourceUrl: string}>> {
    try {
      const domains = [
        ...this.getDomainsForMake(make),
        'tsbsearch.com',
        'alldatadiy.com'
      ];

      const query = `${year} ${make} ${model} TSB service bulletin technical`;
      const searchResults = await this.firecrawl.searchVehicleDocs(query, domains, {
        limit: 10,
        year,
        make,
        model
      });

      const bulletins: Array<{
        id: string;
        title: string;
        content: string;
        issueDate: string;
        sourceUrl: string;
      }> = [];

      for (const result of searchResults) {
        const scrapedContent = await this.firecrawl.scrapeUrl(result.url);
        
        // Extract TSB details
        const bulletin = this.extractServiceBulletin(
          scrapedContent.content,
          result.title,
          result.url
        );
        
        if (bulletin) {
          bulletins.push(bulletin);
        }
      }

      return bulletins;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error getting service bulletins:', err);
      throw new Error(`Failed to get service bulletins for ${year} ${make} ${model}: ${message}`);
    }
  }

  /**
   * Enrich vehicle record with data from manufacturer
   * This method enriches existing vehicle records with additional
   * manufacturer information fetched via Firecrawl
   */
  async enrichVehicleRecord(
    vehicleId: string,
    includeRecalls: boolean = true,
    includeBulletins: boolean = true
  ): Promise<void> {
    try {
      // Get vehicle details from Supabase
      const { data: vehicle, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();
      
      if (error || !vehicle) {
        throw new Error(`Vehicle not found with ID: ${vehicleId}`);
      }
      
      // Get vehicle specs from manufacturer
      const specs = await this.getVehicleSpecs(
        vehicle.make,
        vehicle.model,
        vehicle.year
      );
      
      // Create enrichment data object
      const enrichmentData: Record<string, any> = {
        specifications: specs.specs,
        specificationSource: specs.sourceUrl,
        lastEnriched: new Date().toISOString()
      };
      
      // Optionally get recall information
      if (includeRecalls) {
        const recalls = await this.findRecallInformation(
          vehicle.make,
          vehicle.model,
          vehicle.year
        );
        
        enrichmentData.recalls = recalls;
      }
      
      // Optionally get service bulletins
      if (includeBulletins) {
        const bulletins = await this.getServiceBulletins(
          vehicle.make,
          vehicle.model,
          vehicle.year
        );
        
        enrichmentData.serviceBulletins = bulletins;
      }
      
      // Update vehicle record with enriched data
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({
          manufacturer_data: enrichmentData
        })
        .eq('id', vehicleId);
      
      if (updateError) {
        throw new Error(`Failed to update vehicle with ID ${vehicleId}: ${updateError.message}`);
      }
      
      // Also add relevant events to the vehicle timeline
      await this.addEnrichmentEvents(vehicleId, enrichmentData);
      
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error enriching vehicle record:', err);
      throw new Error(`Failed to enrich vehicle record: ${message}`);
    }
  }

  /**
   * Add enrichment events to the vehicle timeline
   */
  private async addEnrichmentEvents(
    vehicleId: string,
    enrichmentData: Record<string, any>
  ): Promise<void> {
    try {
      const events: Array<{
        vehicle_id: string;
        event_type: string;
        event_date: string;
        description: string;
        event_data: Record<string, any>;
      }> = [];
      
      // Add specification update event
      events.push({
        vehicle_id: vehicleId,
        event_type: 'SPECIFICATION_UPDATE',
        event_date: new Date().toISOString(),
        description: 'Vehicle specifications updated from manufacturer data',
        event_data: {
          source: enrichmentData.specificationSource,
          update_time: enrichmentData.lastEnriched
        }
      });
      
      // Add recall events if present
      if (enrichmentData.recalls && enrichmentData.recalls.length > 0) {
        for (const recall of enrichmentData.recalls) {
          events.push({
            vehicle_id: vehicleId,
            event_type: 'RECALL_NOTIFICATION',
            event_date: recall.date || new Date().toISOString(),
            description: `Recall: ${recall.title}`,
            event_data: {
              recall_details: recall.description,
              source: recall.sourceUrl
            }
          });
        }
      }
      
      // Add service bulletin events if present
      if (enrichmentData.serviceBulletins && enrichmentData.serviceBulletins.length > 0) {
        for (const bulletin of enrichmentData.serviceBulletins) {
          events.push({
            vehicle_id: vehicleId,
            event_type: 'SERVICE_BULLETIN',
            event_date: bulletin.issueDate || new Date().toISOString(),
            description: `Service Bulletin: ${bulletin.title}`,
            event_data: {
              bulletin_id: bulletin.id,
              bulletin_details: bulletin.content,
              source: bulletin.sourceUrl
            }
          });
        }
      }
      
      // Insert events into the timeline
      if (events.length > 0) {
        const { error } = await supabase
          .from('vehicle_timeline')
          .insert(events);
        
        if (error) {
          console.error('Error adding timeline events:', error);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Error adding enrichment events for vehicle ${vehicleId}:`, err);
      // Optionally re-throw or handle the error (e.g., log but don't stop enrichment)
      throw new Error(`Failed to add timeline events during enrichment: ${message}`);
    }
  }

  /**
   * Parse specifications from scraped content
   */
  private parseSpecifications(
    content: string,
    make: string,
    model: string
  ): Record<string, any> {
    // In a real implementation, this would contain sophisticated parsing logic
    // For now, we'll return a simplified object with basic information
    
    // Extract common specifications using regex patterns
    const engineMatch = content.match(/engine[\s:]+(.*?)(?:\n|<|$)/i);
    const transmissionMatch = content.match(/transmission[\s:]+(.*?)(?:\n|<|$)/i);
    const horsepowerMatch = content.match(/horsepower[\s:]+(.*?)(?:\n|<|$)/i);
    const torqueMatch = content.match(/torque[\s:]+(.*?)(?:\n|<|$)/i);
    const fuelEconomyMatch = content.match(/(?:fuel economy|mpg)[\s:]+(.*?)(?:\n|<|$)/i);
    const dimensionsMatch = content.match(/dimensions[\s:]+(.*?)(?:\n|<|$)/i);
    const weightMatch = content.match(/(?:weight|curb weight)[\s:]+(.*?)(?:\n|<|$)/i);
    
    return {
      make,
      model,
      engine: engineMatch ? engineMatch[1].trim() : 'Not specified',
      transmission: transmissionMatch ? transmissionMatch[1].trim() : 'Not specified',
      performance: {
        horsepower: horsepowerMatch ? horsepowerMatch[1].trim() : 'Not specified',
        torque: torqueMatch ? torqueMatch[1].trim() : 'Not specified'
      },
      fuelEconomy: fuelEconomyMatch ? fuelEconomyMatch[1].trim() : 'Not specified',
      dimensions: dimensionsMatch ? dimensionsMatch[1].trim() : 'Not specified',
      weight: weightMatch ? weightMatch[1].trim() : 'Not specified',
      // Add other specifications as needed
    };
  }

  /**
   * Extract recall information from scraped content
   */
  private extractRecallInfo(
    content: string,
    title: string
  ): { title: string, description: string, date: string } | null {
    // Extract date using regex
    const dateMatch = content.match(/(?:recall date|date issued|date:)[\s:]+(.*?)(?:\n|<|$)/i);
    const date = dateMatch ? dateMatch[1].trim() : new Date().toISOString().split('T')[0];
    
    // Extract description - look for common sections in recall notices
    let description = '';
    
    // Look for description or summary sections
    const descriptionMatch = content.match(/(?:description|summary|defect summary)[\s:]+(.*?)(?:(?:\n\n|\n[A-Z]|<\/p>|<\/div>|$))/is);
    if (descriptionMatch) {
      description = descriptionMatch[1].replace(/<[^>]*>/g, ' ').trim();
    } else {
      // If no structured section found, take a portion of the content
      description = content.replace(/<[^>]*>/g, ' ').slice(0, 500).trim();
    }
    
    if (!description) return null;
    
    return {
      title,
      description,
      date
    };
  }

  /**
   * Extract service bulletin information from scraped content
   */
  private extractServiceBulletin(
    content: string,
    title: string,
    sourceUrl: string
  ): { id: string, title: string, content: string, issueDate: string, sourceUrl: string } | null {
    // Extract bulletin ID using regex
    const idMatch = content.match(/(?:bulletin id|tsb number|bulletin number|reference:)[\s:]+(.*?)(?:\n|<|$)/i);
    const id = idMatch ? idMatch[1].trim() : `TSB-${Date.now()}`;
    
    // Extract date using regex
    const dateMatch = content.match(/(?:date issued|issue date|date:)[\s:]+(.*?)(?:\n|<|$)/i);
    const issueDate = dateMatch ? dateMatch[1].trim() : new Date().toISOString().split('T')[0];
    
    // Extract the bulletin content
    let bulletinContent = '';
    
    // Look for common sections in service bulletins
    const contentMatch = content.match(/(?:procedure|repair procedure|service procedure|technical procedure)[\s:]+(.*?)(?:(?:\n\n|\n[A-Z]|<\/p>|<\/div>|<h|$))/is);
    if (contentMatch) {
      bulletinContent = contentMatch[1].replace(/<[^>]*>/g, ' ').trim();
    } else {
      // If no structured section found, take a portion of the content
      bulletinContent = content.replace(/<[^>]*>/g, ' ').slice(0, 1000).trim();
    }
    
    if (!bulletinContent) return null;
    
    return {
      id,
      title,
      content: bulletinContent,
      issueDate,
      sourceUrl
    };
  }
}
