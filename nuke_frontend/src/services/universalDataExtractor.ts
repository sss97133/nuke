/**
 * Universal Data Extraction Framework
 * 
 * Expert-level data extraction from ANY vehicle listing source.
 * Uses AI-powered extraction with fallback to pattern matching.
 * Designed to automatically handle new sources without code changes.
 */

import { supabase } from '../lib/supabase';
import { VehicleDataExtractionService } from './vehicleDataExtractionService';
import type { ExtractedVehicleData } from './aiDataIngestion';

export interface DataSourceConfig {
  id: string;
  name: string;
  domain: string | string[];
  urlPatterns: RegExp[];
  extractionMethod: 'ai' | 'custom' | 'hybrid';
  customParser?: (html: string, url: string) => Promise<Partial<ExtractedVehicleData>>;
  metadata?: {
    listingType?: 'auction' | 'marketplace' | 'dealer' | 'classified';
    requiresAuth?: boolean;
    rateLimit?: number; // requests per minute
  };
}

export interface ExtractionResult {
  success: boolean;
  data: Partial<ExtractedVehicleData>;
  source: string;
  confidence: number;
  extractionMethod: 'ai' | 'custom' | 'pattern' | 'hybrid';
  errors?: string[];
}

export class UniversalDataExtractor {
  private sourceRegistry: Map<string, DataSourceConfig> = new Map();
  private aiExtractorCache: Map<string, any> = new Map();

  constructor() {
    this.initializeBuiltInSources();
  }

  /**
   * Register a new data source
   */
  registerSource(config: DataSourceConfig): void {
    this.sourceRegistry.set(config.id, config);
  }

  /**
   * Automatically discover and extract from any URL
   */
  async extractFromURL(url: string): Promise<ExtractionResult> {
    // Identify source
    const sourceConfig = this.identifySource(url);
    
    if (!sourceConfig) {
      // Unknown source - use AI extraction
      return await this.extractWithAI(url);
    }

    // Use configured extraction method
    switch (sourceConfig.extractionMethod) {
      case 'custom':
        return await this.extractWithCustomParser(sourceConfig, url);
      case 'hybrid':
        return await this.extractWithHybrid(sourceConfig, url);
      case 'ai':
      default:
        return await this.extractWithAI(url, sourceConfig);
    }
  }

  /**
   * Identify source from URL
   */
  private identifySource(url: string): DataSourceConfig | null {
    const urlLower = url.toLowerCase();
    
    for (const [id, config] of this.sourceRegistry.entries()) {
      // Check domain match
      const domains = Array.isArray(config.domain) ? config.domain : [config.domain];
      if (domains.some(domain => urlLower.includes(domain.toLowerCase()))) {
        // Check URL pattern match
        if (config.urlPatterns.some(pattern => pattern.test(url))) {
          return config;
        }
      }
    }
    
    return null;
  }

  /**
   * AI-powered extraction (works on any source)
   */
  private async extractWithAI(
    url: string,
    sourceConfig?: DataSourceConfig
  ): Promise<ExtractionResult> {
    try {
      // Fetch HTML via edge function
      const { data, error } = await supabase.functions.invoke('simple-scraper', {
        body: { url }
      });

      if (error || !data?.html) {
        throw new Error(`Failed to fetch: ${error?.message || 'No HTML returned'}`);
      }

      const html = data.html;
      const textContent = this.extractTextContent(html);

      // Use AI to extract structured data
      const { data: aiData, error: aiError } = await supabase.functions.invoke('extract-vehicle-data-ai', {
        body: {
          url,
          html: html.substring(0, 200000), // Limit HTML size
          textContent: textContent.substring(0, 50000), // Limit text size
          source: sourceConfig?.name || 'unknown'
        }
      });

      if (aiError || !aiData) {
        // Fallback to pattern extraction
        return this.extractWithPatterns(html, textContent, url);
      }

      // Normalize extracted data
      const normalized = this.normalizeExtractedData(aiData, url);

      return {
        success: true,
        data: normalized,
        source: sourceConfig?.name || 'unknown',
        confidence: aiData.confidence || 0.8,
        extractionMethod: 'ai'
      };
    } catch (error: any) {
      return {
        success: false,
        data: {},
        source: sourceConfig?.name || 'unknown',
        confidence: 0,
        extractionMethod: 'ai',
        errors: [error.message]
      };
    }
  }

  /**
   * Extract using custom parser
   */
  private async extractWithCustomParser(
    config: DataSourceConfig,
    url: string
  ): Promise<ExtractionResult> {
    if (!config.customParser) {
      return await this.extractWithAI(url, config);
    }

    try {
      const { data, error } = await supabase.functions.invoke('simple-scraper', {
        body: { url }
      });

      if (error || !data?.html) {
        throw new Error(`Failed to fetch: ${error?.message}`);
      }

      const extracted = await config.customParser(data.html, url);
      const normalized = this.normalizeExtractedData(extracted, url);

      return {
        success: true,
        data: normalized,
        source: config.name,
        confidence: 0.9,
        extractionMethod: 'custom'
      };
    } catch (error: any) {
      return {
        success: false,
        data: {},
        source: config.name,
        confidence: 0,
        extractionMethod: 'custom',
        errors: [error.message]
      };
    }
  }

  /**
   * Hybrid extraction (custom parser + AI fallback)
   */
  private async extractWithHybrid(
    config: DataSourceConfig,
    url: string
  ): Promise<ExtractionResult> {
    // Try custom parser first
    const customResult = await this.extractWithCustomParser(config, url);
    
    // If custom extraction has low confidence or missing critical fields, use AI
    if (customResult.confidence < 0.7 || !customResult.data.vin && !customResult.data.year) {
      const aiResult = await this.extractWithAI(url, config);
      
      // Merge results (AI fills gaps)
      return {
        success: aiResult.success || customResult.success,
        data: {
          ...customResult.data,
          ...aiResult.data // AI data overrides/extends custom data
        },
        source: config.name,
        confidence: Math.max(customResult.confidence, aiResult.confidence),
        extractionMethod: 'hybrid'
      };
    }

    return customResult;
  }

  /**
   * Pattern-based extraction (fallback when AI unavailable)
   */
  private extractWithPatterns(
    html: string,
    textContent: string,
    url: string
  ): ExtractionResult {
    const extracted: Partial<ExtractedVehicleData> = {};

    // Extract VIN
    const vinMatch = textContent.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (vinMatch && !/[IOQ]/.test(vinMatch[1])) {
      extracted.vin = vinMatch[1].toUpperCase();
    }

    // Extract year
    const yearMatch = textContent.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      extracted.year = parseInt(yearMatch[0]);
    }

    // Extract price
    const priceMatches = [
      textContent.match(/\$[\d,]+/g),
      textContent.match(/[\d,]+[\s]*(?:USD|dollars?)/gi)
    ].filter(Boolean);
    if (priceMatches[0]) {
      const priceStr = priceMatches[0][0].replace(/[^0-9]/g, '');
      extracted.price = parseInt(priceStr);
    }

    // Extract mileage
    const mileageMatches = [
      textContent.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles?|mi\.?)/i),
      textContent.match(/(\d{1,3}(?:,\d{3})*)\s*(?:k\s*miles?|k\s*mi\.?)/i)
    ].filter(Boolean);
    if (mileageMatches[0]) {
      const mileageStr = mileageMatches[0][1].replace(/,/g, '');
      extracted.mileage = parseInt(mileageStr);
    }

    // Extract images
    const imageMatches = html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
    const images: string[] = [];
    for (const match of imageMatches) {
      const imgUrl = match[1];
      if (imgUrl.startsWith('http') && !imgUrl.includes('logo') && !imgUrl.includes('icon')) {
        images.push(imgUrl);
      }
    }
    extracted.images = images.slice(0, 20); // Limit to 20 images

    // Use VehicleDataExtractionService to extract model/series/trim
    const fields = VehicleDataExtractionService.extractVehicleFields(
      extracted.make,
      extracted.model,
      textContent.substring(0, 5000), // Use first 5000 chars for extraction
      textContent.substring(0, 10000),
      extracted.year
    );

    extracted.make = fields.make;
    extracted.model = fields.model;
    extracted.series = fields.series || undefined;
    extracted.trim = fields.trim || undefined;

    return {
      success: Object.keys(extracted).length > 0,
      data: extracted,
      source: 'unknown',
      confidence: 0.6,
      extractionMethod: 'pattern'
    };
  }

  /**
   * Normalize extracted data to standard format
   */
  private normalizeExtractedData(
    data: any,
    url: string
  ): Partial<ExtractedVehicleData> {
    // Use VehicleDataExtractionService to normalize model/series/trim
    const normalized = VehicleDataExtractionService.extractVehicleFields(
      data.make || data.manufacturer,
      data.model,
      data.title || data.name,
      data.description,
      data.year
    );

    return {
      vin: data.vin || data.vehicle_identification_number,
      year: data.year || parseInt(data.model_year),
      make: normalized.make,
      model: normalized.model,
      series: normalized.series || data.series,
      trim: normalized.trim || data.trim,
      mileage: data.mileage || data.odometer || parseInt(data.miles),
      price: data.price || data.asking_price || data.list_price,
      color: data.color || data.exterior_color || data.paint_color,
      transmission: data.transmission || data.transmission_type,
      drivetrain: data.drivetrain || data.drive_type,
      engine: data.engine || data.engine_size || data.engine_type,
      engine_size: data.engine_size || data.displacement,
      body_type: data.body_style || data.body_type,
      description: data.description || data.notes,
      images: data.images || data.image_urls || [],
      listing_url: url
    };
  }

  /**
   * Extract text content from HTML
   */
  private extractTextContent(html: string): string {
    // Remove script and style tags
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // Extract text from common content containers
    const contentSelectors = [
      /<h1[^>]*>([^<]+)<\/h1>/gi,
      /<h2[^>]*>([^<]+)<\/h2>/gi,
      /<p[^>]*>([^<]+)<\/p>/gi,
      /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([^<]+)<\/div>/gi,
      /<span[^>]*>([^<]+)<\/span>/gi
    ];

    let extracted = '';
    for (const selector of contentSelectors) {
      const matches = html.matchAll(selector);
      for (const match of matches) {
        extracted += match[1] + ' ';
      }
    }

    // Fallback: strip all HTML tags
    if (extracted.length < 100) {
      extracted = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    }

    return extracted.trim();
  }

  /**
   * Initialize built-in source configurations
   */
  private initializeBuiltInSources(): void {
    // Bring a Trailer
    this.registerSource({
      id: 'bat',
      name: 'Bring a Trailer',
      domain: 'bringatrailer.com',
      urlPatterns: [/bringatrailer\.com\/listing\//],
      extractionMethod: 'hybrid',
      metadata: {
        listingType: 'auction',
        rateLimit: 10
      }
    });

    // Classic.com
    this.registerSource({
      id: 'classiccom',
      name: 'Classic.com',
      domain: 'classic.com',
      urlPatterns: [/classic\.com\/veh\//],
      extractionMethod: 'ai',
      metadata: {
        listingType: 'marketplace',
        rateLimit: 20
      }
    });

    // ClassicCars.com
    this.registerSource({
      id: 'classiccars',
      name: 'ClassicCars.com',
      domain: 'classiccars.com',
      urlPatterns: [/classiccars\.com\/view\//],
      extractionMethod: 'ai',
      metadata: {
        listingType: 'marketplace',
        rateLimit: 15
      }
    });

    // Affordable Classics
    this.registerSource({
      id: 'affordableclassics',
      name: 'Affordable Classics Inc',
      domain: 'affordableclassicsinc.com',
      urlPatterns: [/affordableclassicsinc\.com\/vehicle\//],
      extractionMethod: 'ai',
      metadata: {
        listingType: 'dealer',
        rateLimit: 10
      }
    });

    // Add more sources as needed...
  }

  /**
   * Get all registered sources
   */
  getRegisteredSources(): DataSourceConfig[] {
    return Array.from(this.sourceRegistry.values());
  }

  /**
   * Check if a URL can be extracted from
   */
  canExtractFrom(url: string): boolean {
    return this.identifySource(url) !== null || url.startsWith('http');
  }
}

// Export singleton instance
export const universalDataExtractor = new UniversalDataExtractor();

