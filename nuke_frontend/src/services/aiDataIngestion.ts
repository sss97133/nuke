/**
 * AI Data Ingestion Service
 * 
 * Extracts structured data from any user input format with maximum accuracy.
 * Supports: VINs, URLs, images, natural language, partial vehicle info
 */

import { supabase } from '../lib/supabase';
import vinDecoderService from './vinDecoder';
import { listingURLParser, type ParsedListing } from './listingURLParser';

export interface ExtractedVehicleData {
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileage?: number;
  price?: number;
  color?: string;
  transmission?: string;
  drivetrain?: string;
  engine?: string;
  body_type?: string;
  engine_size?: string;
  location?: string;
  description?: string;
  images?: string[];
}

export interface ExtractedReceiptData {
  vendor?: string;
  date?: string;
  total?: number;
  items?: Array<{
    name: string;
    price?: number;
    quantity?: number;
  }>;
  vehicle_vin?: string;
}

export interface ExtractionResult {
  inputType: 'vin' | 'url' | 'image' | 'text' | 'search' | 'org_search' | 'unknown';
  vehicleData?: ExtractedVehicleData;
  receiptData?: ExtractedReceiptData;
  confidence: number;
  source?: string;
  provider?: string; // AI provider used (openai, anthropic)
  model?: string; // AI model used
  rawData?: any;
  errors?: string[];
}

class AIDataIngestionService {
  /**
   * Main extraction method - accepts any input format
   * @param input Text string or File (image)
   * @param userId User ID
   * @param textContext Optional text context (only used when input is a File)
   */
  async extractData(input: string | File, userId?: string, textContext?: string): Promise<ExtractionResult> {
    try {
      // Handle file input (images)
      if (input instanceof File) {
        return await this.extractFromImage(input, userId, textContext);
      }

      // Handle text/string input
      const textInput = String(input).trim();
      
      // Classify input type
      const inputType = this.classifyInput(textInput);
      
      switch (inputType) {
        case 'vin':
          return await this.extractFromVIN(textInput);
        
        case 'url':
          return await this.extractFromURL(textInput, userId);
        
        case 'org_search':
          // Return special result indicating this is an organization search query
          return {
            inputType: 'org_search',
            confidence: 1.0,
            source: 'intent_classification',
            rawData: { query: textInput }
          };
        
        case 'search':
          // Return special result indicating this is a search query
          return {
            inputType: 'search',
            confidence: 1.0,
            source: 'intent_classification',
            rawData: { query: textInput }
          };
        
        case 'text':
          return await this.extractFromText(textInput, userId);
        
        default:
          return {
            inputType: 'unknown',
            confidence: 0,
            errors: ['Unable to classify input type']
          };
      }
    } catch (error: any) {
      console.error('Data extraction error:', error);
      return {
        inputType: 'unknown',
        confidence: 0,
        errors: [error.message || 'Unknown extraction error']
      };
    }
  }

  /**
   * Classify input type from text
   */
  private classifyInput(input: string): 'vin' | 'url' | 'text' | 'search' | 'org_search' | 'unknown' {
    const trimmed = input.trim().toLowerCase();
    
    // Check for URL
    if (trimmed.match(/^https?:\/\//i) || trimmed.match(/^www\./i)) {
      // Skip PDF/document URLs - these should be handled by AddBrochureUrl component
      if (trimmed.includes('.pdf') || 
          trimmed.includes('/pdf') || 
          trimmed.includes('catalog') || 
          trimmed.includes('manual') || 
          trimmed.includes('tds') ||
          trimmed.includes('document') ||
          trimmed.includes('brochure')) {
        return 'search'; // Treat as search to avoid scraping
      }
      return 'url';
    }
    
    // Check for VIN (17 characters, alphanumeric, no I/O/Q)
    const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/i;
    const cleanedVIN = trimmed.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (vinPattern.test(cleanedVIN) && !/[IOQ]/.test(cleanedVIN)) {
      return 'vin';
    }
    
    // Check for partial VIN (11+ characters)
    if (cleanedVIN.length >= 11 && cleanedVIN.length < 17 && !/[IOQ]/.test(cleanedVIN)) {
      return 'vin'; // Still treat as VIN, but may need decoding
    }
    
    // Check for organization/garage/shop search patterns
    const orgSearchPatterns = [
      /.*(garage|shop|dealer|organization|business|mechanic|fabricator|painter|upholstery).*(near me|close|local|around)/i,
      /.*(show|find|search|get|list).*(garage|shop|dealer|organization|business|mechanic|fabricator|painter|upholstery).*(near|close|local|around)/i,
      /.*(near me|close|local|around).*(garage|shop|dealer|organization|business|mechanic|fabricator|painter|upholstery)/i,
      /.*(working on|working with|have|has).*(squarebody|square body|truck|suburban|blazer|gmc|chevrolet|chevy)/i
    ];
    
    for (const pattern of orgSearchPatterns) {
      if (pattern.test(trimmed)) {
        return 'org_search';
      }
    }
    
    // Check for year-only input (should be treated as search, not vehicle data)
    // Matches 4-digit years (1885-2099)
    const yearOnlyPattern = /^\s*(\d{4})\s*$/;
    if (yearOnlyPattern.test(trimmed)) {
      const year = parseInt(trimmed);
      if (year >= 1885 && year <= 2099) {
        return 'search';
      }
    }
    
    // Check for image/vehicle search query patterns (show me, find, search, pictures of, etc.)
    const searchPatterns = [
      /^(show|find|search|get|display|list|see|view).*(picture|image|photo|pic|vehicle|car|truck|part|fender|door|hood|trunk|wheel|tire|engine|interior|exterior)/i,
      /.*(show me|find me|search for|look for|i want to see|i need|show pictures|show images|find pictures|find images)/i,
      /^(pictures?|images?|photos?|pics?)\s+(of|with|showing)/i,
      /.*(with|having|showing|featuring).*(fender|door|hood|trunk|wheel|tire|engine|interior|exterior|part)/i
    ];
    
    for (const pattern of searchPatterns) {
      if (pattern.test(trimmed)) {
        return 'search';
      }
    }
    
    // Default to text for natural language processing (data extraction)
    return 'text';
  }

  /**
   * Extract data from VIN
   */
  private async extractFromVIN(vin: string): Promise<ExtractionResult> {
    try {
      const cleanedVIN = vin.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      
      // Validate and decode VIN
      const decodeResult = await vinDecoderService.decodeVIN(cleanedVIN);
      
      if (!decodeResult.valid) {
        return {
          inputType: 'vin',
          confidence: 0,
          errors: [decodeResult.error_message || 'Invalid VIN']
        };
      }

      return {
        inputType: 'vin',
        vehicleData: {
          vin: decodeResult.normalized_vin,
          year: decodeResult.year || undefined,
          make: decodeResult.make || undefined,
          model: decodeResult.model || undefined,
          trim: decodeResult.trim || undefined,
          engine_size: decodeResult.engine_size || undefined,
          transmission: decodeResult.transmission || undefined,
          drivetrain: decodeResult.drivetrain || undefined,
          body_type: decodeResult.body_type || undefined
        },
        confidence: decodeResult.confidence,
        source: 'vin_decoder',
        rawData: decodeResult
      };
    } catch (error: any) {
      return {
        inputType: 'vin',
        confidence: 0,
        errors: [error.message || 'VIN decoding failed']
      };
    }
  }

  /**
   * Extract data from URL (listing pages)
   */
  private async extractFromURL(url: string, userId?: string): Promise<ExtractionResult> {
    try {
      const parsed = await listingURLParser.parseListingURL(url);
      
      return {
        inputType: 'url',
        vehicleData: {
          vin: parsed.vin,
          year: parsed.year,
          make: parsed.make,
          model: parsed.model,
          trim: parsed.trim,
          mileage: parsed.mileage,
          price: parsed.price || parsed.sold_price,
          color: parsed.exterior_color,
          transmission: parsed.transmission,
          drivetrain: parsed.drivetrain,
          engine: parsed.engine,
          location: parsed.location,
          description: parsed.description,
          images: parsed.images
        },
        confidence: parsed.vin ? 0.95 : 0.85, // Higher confidence with VIN
        source: parsed.source,
        rawData: parsed
      };
    } catch (error: any) {
      return {
        inputType: 'url',
        confidence: 0,
        errors: [error.message || 'URL parsing failed']
      };
    }
  }

  /**
   * Extract data from natural language text using AI
   */
  private async extractFromText(text: string, userId?: string): Promise<ExtractionResult> {
    try {
      // Call edge function for AI-powered extraction
      const { data, error } = await supabase.functions.invoke('extract-and-route-data', {
        body: {
          input: text,
          inputType: 'text',
          userId: userId || null
        }
      });

      if (error) throw error;

      if (!data || !data.success) {
        return {
          inputType: 'text',
          confidence: 0,
          errors: data?.errors || ['AI extraction failed']
        };
      }

      return {
        inputType: 'text',
        vehicleData: data.vehicleData,
        receiptData: data.receiptData,
        confidence: data.confidence || 0.7,
        source: 'ai_extraction',
        provider: data.provider,
        model: data.model,
        rawData: data
      };
    } catch (error: any) {
      console.error('Text extraction error:', error);
      return {
        inputType: 'text',
        confidence: 0,
        errors: [error.message || 'Text extraction failed']
      };
    }
  }

  /**
   * Extract data from image using AI
   * @param file Image file
   * @param userId User ID
   * @param textContext Optional text context to provide with the image
   */
  private async extractFromImage(file: File, userId?: string, textContext?: string): Promise<ExtractionResult> {
    try {
      // Upload image to Supabase Storage first
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `temp/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('vehicle-images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('vehicle-images')
        .getPublicUrl(filePath);

      const imageUrl = urlData.publicUrl;

      // Call edge function for AI-powered image analysis
      // Include text context if provided
      const requestBody: any = {
        input: imageUrl,
        inputType: 'image',
        userId: userId || null,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type
      };
      
      // Add text context if provided
      if (textContext && textContext.trim()) {
        requestBody.textContext = textContext.trim();
      }
      
      const { data, error } = await supabase.functions.invoke('extract-and-route-data', {
        body: requestBody
      });

      if (error) throw error;

      if (!data || !data.success) {
        return {
          inputType: 'image',
          confidence: 0,
          errors: data?.errors || ['Image extraction failed']
        };
      }

      return {
        inputType: 'image',
        vehicleData: data.vehicleData,
        receiptData: data.receiptData,
        confidence: data.confidence || 0.7,
        source: 'ai_image_analysis',
        provider: data.provider,
        model: data.model,
        rawData: data
      };
    } catch (error: any) {
      console.error('Image extraction error:', error);
      return {
        inputType: 'image',
        confidence: 0,
        errors: [error.message || 'Image extraction failed']
      };
    }
  }
}

export const aiDataIngestion = new AIDataIngestionService();

