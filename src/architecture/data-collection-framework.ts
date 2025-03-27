/**
 * Data Collection Framework
 * 
 * This module defines the core architecture for a flexible, extensible
 * data collection system that can adapt to new input methods while
 * maintaining consistent data structures.
 * 
 * The key principle is data normalization - regardless of source,
 * all vehicle data is transformed into standard formats for storage.
 * 
 * Each input source implements a normalizer that transforms its unique
 * format into our standard data model, allowing us to easily add new
 * data sources without changing the core data structure.
 */

import { supabase } from '@/integrations/supabase/client';

// ------------------------------------------------------------------
// Core data interfaces
// ------------------------------------------------------------------

/**
 * The core vehicle data model - this is our standardized format
 * ALL data collection methods must eventually produce data in this format
 */
export interface VehicleData {
  vin: string;  // Primary identifier
  make: string;
  model: string;
  year: number;
  trim?: string;
  color?: string;
  mileage?: number;
  fuelType?: string;
  engineSize?: string;
  transmissionType?: string;
  drivetrainType?: string;
  bodyStyle?: string;
  licensePlate?: string;
  registrationState?: string;
  lastUpdated: string; // ISO timestamp
  dataSource: string;  // Where this data originated
  confidence: number;  // 0-1 confidence score for this data
  // Extensible properties can be added in the future
  [key: string]: any;
}

/**
 * Service history record
 */
export interface ServiceRecord {
  id: string;
  vehicleId: string; // References a vehicle
  date: string;
  mileage: number;
  serviceType: string;
  description: string;
  cost?: number;
  provider?: string;
  parts?: PartUsage[];
  dataSource: string;
  confidence: number;
}

/**
 * Parts usage in service
 */
export interface PartUsage {
  partNumber: string;
  name: string;
  quantity: number;
  unitCost?: number;
  condition: 'new' | 'used' | 'refurbished';
}

/**
 * Ownership record
 */
export interface OwnershipRecord {
  id: string;
  vehicleId: string;
  startDate: string;
  endDate?: string;
  ownerType: 'individual' | 'business' | 'government' | 'unknown';
  ownerName?: string;
  location?: GeoLocation;
  dataSource: string;
  confidence: number;
}

/**
 * Geographic location
 */
export interface GeoLocation {
  latitude?: number;
  longitude?: number;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}

/**
 * Vehicle sensor data point
 */
export interface VehicleSensorData {
  id: string;
  vehicleId: string;
  timestamp: string;
  sensorType: string;
  value: any;
  unit?: string;
  confidence: number;
}

/**
 * Vehicle image
 */
export interface VehicleImage {
  id: string;
  vehicleId: string;
  url: string;
  timestamp: string;
  type: 'exterior' | 'interior' | 'damage' | 'part' | 'other';
  angle?: string;
  confidence: number; // AI confidence in associating this image with the vehicle
  labels?: string[]; // AI-generated labels
}

// ------------------------------------------------------------------
// Data source interfaces
// ------------------------------------------------------------------

/**
 * Data source metadata - defines capabilities of a data source
 */
export interface DataSourceMetadata {
  id: string;
  name: string;
  description: string;
  capabilities: {
    providesVehicleData: boolean;
    providesServiceHistory: boolean;
    providesOwnershipHistory: boolean;
    providesSensorData: boolean;
    providesImages: boolean;
    [key: string]: boolean; // Extensible for future capabilities
  };
  requiresAuthentication: boolean;
  authType?: 'api_key' | 'oauth' | 'basic' | 'custom';
  authConfig?: Record<string, any>;
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
}

/**
 * Core interface for all data collectors
 */
export interface DataCollector<T, R> {
  collect(input: T): Promise<R>;
  validate(data: R): Promise<boolean>;
  normalize(data: R): Promise<VehicleData | ServiceRecord | OwnershipRecord | VehicleSensorData | VehicleImage>;
  store(data: VehicleData | ServiceRecord | OwnershipRecord | VehicleSensorData | VehicleImage): Promise<boolean>;
}

// ------------------------------------------------------------------
// Data collectors - each implements the DataCollector interface
// for a specific data source
// ------------------------------------------------------------------

/**
 * Manual data entry collector
 */
export class ManualDataCollector implements DataCollector<any, VehicleData> {
  async collect(input: any): Promise<VehicleData> {
    // Manual data is already in our format, just validate and add metadata
    return {
      ...input,
      lastUpdated: new Date().toISOString(),
      dataSource: 'manual_entry',
      confidence: 1.0 // Assume human entry is correct
    };
  }

  async validate(data: VehicleData): Promise<boolean> {
    // Validation logic for manually entered data
    return !!(data.vin && data.make && data.model && data.year);
  }

  async normalize(data: VehicleData): Promise<VehicleData> {
    // Manual data is already normalized
    return data;
  }

  async store(data: VehicleData): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('vehicles')
        .upsert([data], { onConflict: 'vin' });
      
      return !error;
    } catch (err) {
      console.error('Error storing vehicle data:', err);
      return false;
    }
  }
}

/**
 * API data collector - template for connecting to external APIs
 */
export class ApiDataCollector implements DataCollector<string, any> {
  private apiEndpoint: string;
  private apiKey: string;
  
  constructor(apiEndpoint: string, apiKey: string) {
    this.apiEndpoint = apiEndpoint;
    this.apiKey = apiKey;
  }
  
  async collect(vin: string): Promise<any> {
    try {
      // Flexible API call that can be adapted to different providers
      const response = await fetch(`${this.apiEndpoint}?vin=${vin}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error('API data collection error:', err);
      throw err;
    }
  }
  
  async validate(data: any): Promise<boolean> {
    // Validate API response data
    return !!(data && data.vin); 
  }
  
  async normalize(apiData: any): Promise<VehicleData> {
    // Transform API-specific format to our standard format
    // This is where the magic of normalization happens
    // Each API collector would override this with custom logic
    
    return {
      vin: apiData.vin || '',
      make: apiData.make || '',
      model: apiData.model || '',
      year: parseInt(apiData.year) || 0,
      // Map other fields according to API response format
      lastUpdated: new Date().toISOString(),
      dataSource: 'external_api',
      confidence: 0.9 // Confidence in external data
    };
  }
  
  async store(data: VehicleData): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('vehicles')
        .upsert([data], { onConflict: 'vin' });
      
      return !error;
    } catch (err) {
      console.error('Error storing API vehicle data:', err);
      return false;
    }
  }
}

/**
 * Image analysis collector - processes images to extract vehicle data
 */
export class ImageAnalysisCollector implements DataCollector<string, any> {
  private aiVisionEndpoint: string;
  
  constructor(aiVisionEndpoint: string) {
    this.aiVisionEndpoint = aiVisionEndpoint;
  }
  
  async collect(imageUrl: string): Promise<any> {
    try {
      // Call AI vision API to analyze the image
      const response = await fetch(this.aiVisionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl })
      });
      
      if (!response.ok) {
        throw new Error(`AI Vision API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error('Image analysis error:', err);
      throw err;
    }
  }
  
  async validate(data: any): Promise<boolean> {
    // Validate AI vision response data
    return !!(data && data.vehicle_detected); 
  }
  
  async normalize(visionData: any): Promise<VehicleData | VehicleImage> {
    // If the vision API detected a vehicle, normalize the data
    if (visionData.vehicle_detected) {
      // This could be either vehicle data or just an image
      if (visionData.vin_detected) {
        // If VIN was detected, we can create vehicle data
        return {
          vin: visionData.vin || '',
          make: visionData.make || '',
          model: visionData.model || '',
          year: parseInt(visionData.year) || 0,
          color: visionData.color || '',
          lastUpdated: new Date().toISOString(),
          dataSource: 'image_analysis',
          confidence: visionData.confidence || 0.7
        };
      } else {
        // Otherwise just store the image with vehicle association if possible
        return {
          id: `img_${Date.now()}`,
          vehicleId: visionData.probable_vehicle_id || '',
          url: visionData.image_url,
          timestamp: new Date().toISOString(),
          type: visionData.image_type || 'exterior',
          confidence: visionData.confidence || 0.7,
          labels: visionData.labels || []
        };
      }
    }
    
    throw new Error('No vehicle detected in image');
  }
  
  async store(data: VehicleData | VehicleImage): Promise<boolean> {
    try {
      if ('url' in data) {
        // It's an image
        const { error } = await supabase
          .from('vehicle_images')
          .insert([data]);
        
        return !error;
      } else {
        // It's vehicle data
        const { error } = await supabase
          .from('vehicles')
          .upsert([data], { onConflict: 'vin' });
        
        return !error;
      }
    } catch (err) {
      console.error('Error storing image analysis data:', err);
      return false;
    }
  }
}

// ------------------------------------------------------------------
// Data Collector Registry - makes it easy to add new collectors
// ------------------------------------------------------------------

/**
 * Central registry for all data collectors
 * New data collection methods can be registered here without changing
 * the core system
 */
export class DataCollectorRegistry {
  private collectors: Map<string, DataCollector<any, any>> = new Map();
  private dataSourceMetadata: Map<string, DataSourceMetadata> = new Map();
  
  /**
   * Register a new data collector
   */
  registerCollector(id: string, collector: DataCollector<any, any>, metadata: DataSourceMetadata): void {
    this.collectors.set(id, collector);
    this.dataSourceMetadata.set(id, metadata);
  }
  
  /**
   * Get a collector by ID
   */
  getCollector(id: string): DataCollector<any, any> | undefined {
    return this.collectors.get(id);
  }
  
  /**
   * Get metadata for a collector
   */
  getCollectorMetadata(id: string): DataSourceMetadata | undefined {
    return this.dataSourceMetadata.get(id);
  }
  
  /**
   * Get all registered collectors
   */
  getAllCollectors(): Array<{ id: string, collector: DataCollector<any, any>, metadata: DataSourceMetadata }> {
    const result = [];
    for (const [id, collector] of this.collectors.entries()) {
      const metadata = this.dataSourceMetadata.get(id);
      if (metadata) {
        result.push({ id, collector, metadata });
      }
    }
    return result;
  }
  
  /**
   * Get collectors with specific capabilities
   */
  getCollectorsByCapability(capability: string): Array<{ id: string, collector: DataCollector<any, any>, metadata: DataSourceMetadata }> {
    return this.getAllCollectors().filter(item => 
      item.metadata.capabilities[capability] === true
    );
  }
}

// ------------------------------------------------------------------
// Data Collection Orchestrator - coordinates data collection
// ------------------------------------------------------------------

/**
 * Orchestrates data collection from multiple sources
 * and reconciles conflicts
 */
export class DataCollectionOrchestrator {
  private registry: DataCollectorRegistry;
  
  constructor(registry: DataCollectorRegistry) {
    this.registry = registry;
  }
  
  /**
   * Collect data about a vehicle from all possible sources
   */
  async collectAllVehicleData(vin: string): Promise<VehicleData | null> {
    const collectors = this.registry.getCollectorsByCapability('providesVehicleData');
    const results: VehicleData[] = [];
    
    // Collect data from all sources
    for (const { id, collector } of collectors) {
      try {
        const rawData = await collector.collect(vin);
        if (await collector.validate(rawData)) {
          const normalizedData = await collector.normalize(rawData) as VehicleData;
          results.push(normalizedData);
        }
      } catch (err) {
        console.error(`Error collecting data from ${id}:`, err);
        // Continue with other collectors even if one fails
      }
    }
    
    if (results.length === 0) {
      return null;
    }
    
    // Merge all results, giving preference to higher confidence data
    return this.mergeVehicleData(results);
  }
  
  /**
   * Intelligently merge vehicle data from multiple sources,
   * using confidence scores to resolve conflicts
   */
  private mergeVehicleData(dataPoints: VehicleData[]): VehicleData {
    // Sort by confidence score (highest first)
    const sortedData = [...dataPoints].sort((a, b) => b.confidence - a.confidence);
    const baseData = sortedData[0]; // Start with highest confidence data
    
    // Create a merged record using the most confident value for each field
    const fieldConfidence: Record<string, number> = {};
    const result: VehicleData = { ...baseData };
    
    // Initialize field confidence with base data
    for (const key in baseData) {
      fieldConfidence[key] = baseData.confidence;
    }
    
    // For each additional data point
    for (let i = 1; i < sortedData.length; i++) {
      const data = sortedData[i];
      
      // For each field in this data point
      for (const key in data) {
        // If this source has higher confidence for this field, use its value
        if (key !== 'confidence' && key !== 'lastUpdated' && data[key] && 
            data.confidence > (fieldConfidence[key] || 0)) {
          result[key] = data[key];
          fieldConfidence[key] = data.confidence;
        }
      }
    }
    
    // Update metadata
    result.lastUpdated = new Date().toISOString();
    
    // Calculate overall confidence as average of field confidences
    const confidenceValues = Object.values(fieldConfidence);
    result.confidence = confidenceValues.reduce((sum, val) => sum + val, 0) / confidenceValues.length;
    
    return result;
  }
  
  /**
   * Store reconciled vehicle data
   */
  async storeVehicleData(data: VehicleData): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('vehicles')
        .upsert([data], { onConflict: 'vin' });
      
      // Also store the raw data points for audit/history
      const { error: historyError } = await supabase
        .from('vehicle_data_history')
        .insert([{
          vin: data.vin,
          data,
          timestamp: new Date().toISOString()
        }]);
      
      return !error && !historyError;
    } catch (err) {
      console.error('Error storing reconciled vehicle data:', err);
      return false;
    }
  }
}

// ------------------------------------------------------------------
// Data Analysis Interfaces - define how to analyze collected data
// ------------------------------------------------------------------

/**
 * Analysis query parameters
 */
export interface AnalysisParameters {
  filters?: Record<string, any>;
  groupBy?: string[];
  timeRange?: {
    start: string;
    end: string;
  };
}

/**
 * Data analysis interface
 */
export interface DataAnalyzer<T> {
  analyze(params: AnalysisParameters): Promise<T>;
}

/**
 * Vehicle ownership patterns analyzer
 */
export class OwnershipPatternAnalyzer implements DataAnalyzer<any> {
  async analyze(params: AnalysisParameters): Promise<any> {
    try {
      let query = supabase
        .from('ownership_records')
        .select(`
          id,
          vehicleId,
          startDate,
          endDate,
          ownerType,
          vehicles(make, model, year)
        `);
      
      // Apply filters
      if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
          query = query.eq(key, value);
        }
      }
      
      // Apply time range if specified
      if (params.timeRange) {
        query = query
          .gte('startDate', params.timeRange.start)
          .lte('startDate', params.timeRange.end);
      }
      
      const { data, error } = await query;
      
      if (error) {
        throw error;
      }
      
      // Process data based on groupBy parameters
      if (params.groupBy && params.groupBy.length > 0) {
        return this.groupData(data, params.groupBy);
      }
      
      return data;
    } catch (err) {
      console.error('Ownership pattern analysis error:', err);
      throw err;
    }
  }
  
  private groupData(data: any[], groupByFields: string[]): any {
    // Group data by specified fields
    const result: Record<string, any> = {};
    
    for (const item of data) {
      let current = result;
      
      for (let i = 0; i < groupByFields.length; i++) {
        const field = groupByFields[i];
        const value = this.getNestedValue(item, field);
        
        if (i === groupByFields.length - 1) {
          // Last level, store items
          if (!current[value]) {
            current[value] = [];
          }
          current[value].push(item);
        } else {
          // Intermediate level
          if (!current[value]) {
            current[value] = {};
          }
          current = current[value];
        }
      }
    }
    
    return result;
  }
  
  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }
    
    return current;
  }
}

// ------------------------------------------------------------------
// Example usage of the framework
// ------------------------------------------------------------------

/**
 * Initialize the data collection framework
 */
export function initializeDataFramework(): DataCollectionOrchestrator {
  // Create registry
  const registry = new DataCollectorRegistry();
  
  // Register manual data collector
  registry.registerCollector(
    'manual_entry',
    new ManualDataCollector(),
    {
      id: 'manual_entry',
      name: 'Manual Data Entry',
      description: 'Data entered manually by users',
      capabilities: {
        providesVehicleData: true,
        providesServiceHistory: true,
        providesOwnershipHistory: true,
        providesSensorData: false,
        providesImages: false
      },
      requiresAuthentication: false
    }
  );
  
  // Register API data collector (examples)
  registry.registerCollector(
    'vindecoder_api',
    new ApiDataCollector(
      'https://api.vindecoder.eu/3.1',
      process.env.VINDECODER_API_KEY || ''
    ),
    {
      id: 'vindecoder_api',
      name: 'VIN Decoder API',
      description: 'Vehicle data from VIN decoder service',
      capabilities: {
        providesVehicleData: true,
        providesServiceHistory: false,
        providesOwnershipHistory: false,
        providesSensorData: false,
        providesImages: false
      },
      requiresAuthentication: true,
      authType: 'api_key'
    }
  );
  
  // Register image analysis collector
  registry.registerCollector(
    'image_analysis',
    new ImageAnalysisCollector(
      'https://api.vision.ai/vehicle-detection'
    ),
    {
      id: 'image_analysis',
      name: 'Image Analysis',
      description: 'Vehicle data extracted from images',
      capabilities: {
        providesVehicleData: true,
        providesServiceHistory: false,
        providesOwnershipHistory: false,
        providesSensorData: false,
        providesImages: true
      },
      requiresAuthentication: false
    }
  );
  
  // Create orchestrator
  return new DataCollectionOrchestrator(registry);
}
