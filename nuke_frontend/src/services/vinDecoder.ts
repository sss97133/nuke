/**
 * VIN Decoder Service
 * 
 * Multi-provider VIN decoding service supporting:
 * - NHTSA VPIC (free, public)
 * - Commercial APIs (extensible)
 * - Caching and fallback strategies
 */

export interface VINDecodeResult {
  vin: string;
  normalized_vin: string;
  valid: boolean;
  
  // Basic Info
  make?: string;
  model?: string;
  year?: number;
  trim?: string;
  
  // Detailed Specs
  body_type?: string;
  doors?: number;
  seats?: number;
  
  // Engine
  engine_size?: string;
  engine_cylinders?: number;
  engine_displacement_cc?: string;
  engine_displacement_liters?: string;
  fuel_type?: string;
  
  // Drivetrain
  transmission?: string;
  drivetrain?: string;
  
  // Other
  manufacturer?: string;
  plant_city?: string;
  plant_country?: string;
  vehicle_type?: string;
  gvwr?: string;
  brake_system?: string;
  
  // Metadata
  provider: 'nhtsa' | 'commercial' | 'cached' | 'legacy';
  confidence: number;
  decoded_at: string;
  error_message?: string;
  
  // Raw data for debugging
  raw_data?: any;
}

export interface RecallInfo {
  vin: string;
  recalls: Array<{
    campaign_number: string;
    component: string;
    summary: string;
    consequence: string;
    remedy: string;
    manufacturer_recall_number?: string;
    report_received_date?: string;
  }>;
  recall_count: number;
}

export interface VINValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
  confidence: number;
}

class VINDecoderService {
  private readonly NHTSA_VPIC_BASE = 'https://vpic.nhtsa.dot.gov/api';
  private readonly NHTSA_RECALLS_BASE = 'https://api.nhtsa.gov';
  private cache: Map<string, VINDecodeResult> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days
  
  /**
   * Validate VIN format and checksum
   */
  validateVIN(vin: string): VINValidationResult {
    if (!vin) {
      return { valid: false, normalized: '', error: 'VIN is required', confidence: 0 };
    }
    
    // Clean VIN
    const cleaned = String(vin).toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // Check for invalid characters (I, O, Q not used in VINs)
    if (/[IOQ]/.test(cleaned)) {
      return { 
        valid: false, 
        normalized: cleaned, 
        error: 'VIN contains invalid characters (I, O, Q)', 
        confidence: 0 
      };
    }

    // Legacy/collector chassis identifiers can be 4-16 characters.
    if (cleaned.length >= 4 && cleaned.length <= 16) {
      return {
        valid: true,
        normalized: cleaned,
        error: 'Legacy chassis/serial identifier (check digit not validated)',
        confidence: 0.6
      };
    }

    // Check length for modern VINs
    if (cleaned.length !== 17) {
      return { 
        valid: false, 
        normalized: cleaned, 
        error: `VIN must be 17 characters (modern) or 4-16 characters (legacy chassis)`,
        confidence: 0 
      };
    }
    
    // Calculate check digit (position 9)
    const checkDigit = this.calculateCheckDigit(cleaned);
    if (cleaned[8] !== checkDigit && cleaned[8] !== 'X') {
      // Some older/foreign VINs don't follow check digit rules
      return { 
        valid: true, 
        normalized: cleaned,
        error: 'Check digit mismatch (may be pre-1981 or non-US vehicle)',
        confidence: 0.7 
      };
    }
    
    return { 
      valid: true, 
      normalized: cleaned,
      confidence: 1.0
    };
  }
  
  /**
   * Calculate VIN check digit (ISO 3779 standard)
   */
  private calculateCheckDigit(vin: string): string {
    const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    const values: Record<string, number> = {
      'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8,
      'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'P': 7, 'R': 9,
      'S': 2, 'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9,
      '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 0
    };
    
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      sum += weights[i] * (values[vin[i]] || 0);
    }
    
    const remainder = sum % 11;
    return remainder === 10 ? 'X' : String(remainder);
  }
  
  /**
   * Decode VIN using NHTSA VPIC (free, public API)
   */
  async decodeVIN(vin: string): Promise<VINDecodeResult> {
    // Validate VIN
    const validation = this.validateVIN(vin);
    if (!validation.valid) {
      return {
        vin: vin,
        normalized_vin: validation.normalized,
        valid: false,
        error_message: validation.error,
        provider: 'nhtsa',
        confidence: 0,
        decoded_at: new Date().toISOString()
      };
    }

    // Legacy chassis identifiers (non-17) are valid but not decodable via NHTSA.
    if (validation.normalized.length !== 17) {
      return {
        vin: vin,
        normalized_vin: validation.normalized,
        valid: true,
        error_message: validation.error || 'Legacy chassis/serial identifier (no decode available)',
        provider: 'legacy',
        confidence: validation.confidence || 0.6,
        decoded_at: new Date().toISOString()
      };
    }
    
    const normalizedVIN = validation.normalized;
    
    // Check cache
    const cached = this.getFromCache(normalizedVIN);
    if (cached) {
      return { ...cached, provider: 'cached' };
    }
    
    try {
      // Call NHTSA VPIC API
      const response = await fetch(
        `${this.NHTSA_VPIC_BASE}/vehicles/DecodeVin/${normalizedVIN}?format=json`
      );
      
      if (!response.ok) {
        throw new Error(`NHTSA API error: ${response.status}`);
      }
      
      const data = await response.json();
      const results = data.Results || [];
      
      // Parse NHTSA response
      const decoded = this.parseNHTSAResponse(normalizedVIN, results);
      
      // Cache result
      this.addToCache(normalizedVIN, decoded);
      
      return decoded;
      
    } catch (error) {
      console.error('VIN decode error:', error);
      return {
        vin: vin,
        normalized_vin: normalizedVIN,
        valid: false,
        error_message: error instanceof Error ? error.message : 'Unknown error',
        provider: 'nhtsa',
        confidence: 0,
        decoded_at: new Date().toISOString()
      };
    }
  }
  
  /**
   * Parse NHTSA VPIC response into our format
   */
  private parseNHTSAResponse(vin: string, results: any[]): VINDecodeResult {
    const getValue = (variableId: number): string | null => {
      const item = results.find((r: any) => r.VariableId === variableId);
      return item?.Value || null;
    };
    
    // NHTSA Variable IDs (https://vpic.nhtsa.dot.gov/api/vehicles/getvehiclevariablelist?format=json)
    const make = getValue(26) || getValue(27); // Make / Manufacturer Name
    const model = getValue(28);
    const year = getValue(29);
    const trim = getValue(109);
    const bodyType = getValue(5);
    const doors = getValue(14);
    const seats = getValue(33);
    
    const engineSize = getValue(11); // Displacement (L)
    const engineCC = getValue(12); // Displacement (CC)
    const cylinders = getValue(9);
    const fuelType = getValue(24);
    
    const transmission = getValue(37); // Transmission Style
    const drivetrain = getValue(15); // Drive Type
    
    const manufacturer = getValue(27);
    const plantCity = getValue(76);
    const plantCountry = getValue(75);
    const vehicleType = getValue(39);
    const gvwr = getValue(25);
    const brakeSystem = getValue(6);
    
    // Error check from NHTSA
    const errorCode = getValue(143);
    const errorText = results.find((r: any) => r.Variable === 'Error Text')?.Value;
    
    const hasError = errorCode && errorCode !== '0';
    
    return {
      vin: vin,
      normalized_vin: vin,
      valid: !hasError,
      
      make: make || undefined,
      model: model || undefined,
      year: year ? parseInt(year) : undefined,
      trim: trim || undefined,
      
      body_type: bodyType || undefined,
      doors: doors ? parseInt(doors) : undefined,
      seats: seats ? parseInt(seats) : undefined,
      
      engine_size: engineSize || undefined,
      engine_cylinders: cylinders ? parseInt(cylinders) : undefined,
      engine_displacement_cc: engineCC || undefined,
      engine_displacement_liters: engineSize || undefined,
      fuel_type: fuelType || undefined,
      
      transmission: transmission || undefined,
      drivetrain: drivetrain || undefined,
      
      manufacturer: manufacturer || undefined,
      plant_city: plantCity || undefined,
      plant_country: plantCountry || undefined,
      vehicle_type: vehicleType || undefined,
      gvwr: gvwr || undefined,
      brake_system: brakeSystem || undefined,
      
      provider: 'nhtsa',
      confidence: hasError ? 0 : (make && model && year ? 0.95 : 0.5),
      decoded_at: new Date().toISOString(),
      error_message: hasError ? errorText : undefined,
      
      raw_data: results
    };
  }
  
  /**
   * Get recall information for a VIN
   */
  async getRecalls(vin: string): Promise<RecallInfo> {
    const validation = this.validateVIN(vin);
    if (!validation.valid) {
      return {
        vin: vin,
        recalls: [],
        recall_count: 0
      };
    }

    // Recalls are only available for modern 17-character VINs.
    if (validation.normalized.length !== 17) {
      return {
        vin: validation.normalized,
        recalls: [],
        recall_count: 0
      };
    }
    
    try {
      // NHTSA Recalls API
      const response = await fetch(
        `${this.NHTSA_RECALLS_BASE}/recalls/recallsByVehicle?make=&model=&modelYear=&vin=${validation.normalized}`
      );
      
      if (!response.ok) {
        throw new Error(`Recalls API error: ${response.status}`);
      }
      
      const data = await response.json();
      const recalls = (data.results || []).map((recall: any) => ({
        campaign_number: recall.NHTSACampaignNumber,
        component: recall.Component,
        summary: recall.Summary,
        consequence: recall.Consequence,
        remedy: recall.Remedy,
        manufacturer_recall_number: recall.Manufacturer,
        report_received_date: recall.ReportReceivedDate
      }));
      
      return {
        vin: validation.normalized,
        recalls: recalls,
        recall_count: recalls.length
      };
      
    } catch (error) {
      console.error('Recalls fetch error:', error);
      return {
        vin: validation.normalized,
        recalls: [],
        recall_count: 0
      };
    }
  }
  
  /**
   * Batch decode multiple VINs (for imports)
   */
  async batchDecodeVINs(vins: string[]): Promise<VINDecodeResult[]> {
    const results = await Promise.allSettled(
      vins.map(vin => this.decodeVIN(vin))
    );
    
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          vin: vins[index],
          normalized_vin: vins[index],
          valid: false,
          error_message: result.reason?.message || 'Batch decode failed',
          provider: 'nhtsa' as const,
          confidence: 0,
          decoded_at: new Date().toISOString()
        };
      }
    });
  }
  
  /**
   * Cache management
   */
  private getFromCache(vin: string): VINDecodeResult | null {
    const cached = this.cache.get(vin);
    const expiry = this.cacheExpiry.get(vin);
    
    if (cached && expiry && Date.now() < expiry) {
      return cached;
    }
    
    // Expired, remove from cache
    this.cache.delete(vin);
    this.cacheExpiry.delete(vin);
    return null;
  }
  
  private addToCache(vin: string, result: VINDecodeResult): void {
    this.cache.set(vin, result);
    this.cacheExpiry.set(vin, Date.now() + this.CACHE_TTL);
  }
  
  clearCache(): void {
    this.cache.clear();
    this.cacheExpiry.clear();
  }
}

// Singleton instance
export const vinDecoderService = new VINDecoderService();
export default vinDecoderService;

