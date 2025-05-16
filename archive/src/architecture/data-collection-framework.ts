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
  // Additional properties can be added in the future
  [key: string]: string | number | boolean | undefined;
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
  value: string | number | boolean;
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
  authConfig?: Record<string, string | number | boolean>;
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

export interface ManualInput {
  vin: string;
  make: string;
  model: string;
  year: number;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Manual data entry collector
 */
export class ManualDataCollector implements DataCollector<ManualInput, VehicleData> {
  async collect(input: ManualInput): Promise<VehicleData> {
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

export interface ApiResponse {
  vin: string;
  make?: string;
  model?: string;
  year?: number;
  [key: string]: string | number | boolean | undefined;
}

/**
 * API data collector - template for connecting to external APIs
 */
export class ApiDataCollector implements DataCollector<string, ApiResponse> {
  private apiEndpoint: string;
  private apiKey: string;
  
  constructor(apiEndpoint: string, apiKey: string) {
    this.apiEndpoint = apiEndpoint;
    this.apiKey = apiKey;
  }
  
  async collect(vin: string): Promise<ApiResponse> {
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
  
  async validate(data: ApiResponse): Promise<boolean> {
    // Validate API response data
    return !!(data && data.vin); 
  }
  
  async normalize(apiData: ApiResponse): Promise<VehicleData> {
    // Transform API data into our standard format
    const { vin, ...rest } = apiData;
    return {
      vin,
      make: rest.make || '',
      model: rest.model || '',
      year: rest.year || 0,
      lastUpdated: new Date().toISOString(),
      dataSource: 'api',
      confidence: 0.8, // API data is generally reliable but not perfect
      ...rest
    };
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

export interface VisionData {
  imageUrl: string;
  detections: {
    make?: string;
    model?: string;
    year?: number;
    color?: string;
    bodyStyle?: string;
    confidence: number;
  };
  metadata: Record<string, string | number | boolean>;
}

/**
 * Image analysis collector - uses AI vision to extract vehicle data from images
 */
export class ImageAnalysisCollector implements DataCollector<string, VisionData> {
  private aiVisionEndpoint: string;
  
  constructor(aiVisionEndpoint: string) {
    this.aiVisionEndpoint = aiVisionEndpoint;
  }
  
  async collect(imageUrl: string): Promise<VisionData> {
    try {
      const response = await fetch(this.aiVisionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl })
      });
      
      if (!response.ok) {
        throw new Error(`Vision API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error('Vision analysis error:', err);
      throw err;
    }
  }
  
  async validate(data: VisionData): Promise<boolean> {
    return !!(data && data.detections && data.detections.confidence > 0.5);
  }
  
  async normalize(visionData: VisionData): Promise<VehicleData | VehicleImage> {
    if (visionData.detections.make && visionData.detections.model) {
      // If we detected vehicle details, create a vehicle record
      return {
        vin: '', // Vision can't detect VIN
        make: visionData.detections.make,
        model: visionData.detections.model,
        year: visionData.detections.year || 0,
        color: visionData.detections.color,
        bodyStyle: visionData.detections.bodyStyle,
        lastUpdated: new Date().toISOString(),
        dataSource: 'vision',
        confidence: visionData.detections.confidence
      };
    } else {
      // Otherwise just store as an image
      return {
        id: '', // Will be set by database
        vehicleId: '', // Will need to be linked later
        url: visionData.imageUrl,
        timestamp: new Date().toISOString(),
        type: 'exterior',
        confidence: visionData.detections.confidence,
        labels: Object.keys(visionData.detections)
      };
    }
  }
  
  async store(data: VehicleData | VehicleImage): Promise<boolean> {
    try {
      if ('vin' in data) {
        // Store vehicle data
        const { error } = await supabase
          .from('vehicles')
          .upsert([data], { onConflict: 'vin' });
        return !error;
      } else {
        // Store image data
        const { error } = await supabase
          .from('vehicle_images')
          .insert([data]);
        return !error;
      }
    } catch (err) {
      console.error('Error storing vision data:', err);
      return false;
    }
  }
}

/**
 * Registry for managing data collectors
 */
export class DataCollectorRegistry {
  private collectors: Map<string, DataCollector<unknown, unknown>> = new Map();
  private dataSourceMetadata: Map<string, DataSourceMetadata> = new Map();
  
  registerCollector(id: string, collector: DataCollector<unknown, unknown>, metadata: DataSourceMetadata): void {
    this.collectors.set(id, collector);
    this.dataSourceMetadata.set(id, metadata);
  }
  
  getCollector(id: string): DataCollector<unknown, unknown> | undefined {
    return this.collectors.get(id);
  }
  
  getCollectorMetadata(id: string): DataSourceMetadata | undefined {
    return this.dataSourceMetadata.get(id);
  }
  
  getAllCollectors(): Array<{ id: string, collector: DataCollector<unknown, unknown>, metadata: DataSourceMetadata }> {
    return Array.from(this.collectors.entries()).map(([id, collector]) => ({
      id,
      collector,
      metadata: this.dataSourceMetadata.get(id)!
    }));
  }
  
  getCollectorsByCapability(capability: string): Array<{ id: string, collector: DataCollector<unknown, unknown>, metadata: DataSourceMetadata }> {
    return this.getAllCollectors().filter(({ metadata }) => 
      metadata.capabilities[capability]
    );
  }
}

/**
 * Orchestrator for coordinating data collection across multiple sources
 */
export class DataCollectionOrchestrator {
  private registry: DataCollectorRegistry;
  
  constructor(registry: DataCollectorRegistry) {
    this.registry = registry;
  }
  
  async collectAllVehicleData(vin: string): Promise<VehicleData | null> {
    const collectors = this.registry.getCollectorsByCapability('providesVehicleData');
    const dataPoints: VehicleData[] = [];
    
    for (const { collector } of collectors) {
      try {
        const rawData = await collector.collect(vin);
        if (await collector.validate(rawData)) {
          const normalizedData = await collector.normalize(rawData);
          if ('vin' in normalizedData) {
            dataPoints.push(normalizedData);
          }
        }
      } catch (err) {
        console.error(`Error collecting data from collector:`, err);
        // Continue with other collectors
      }
    }
    
    if (dataPoints.length === 0) {
      return null;
    }
    
    // Merge all data points, preferring higher confidence values
    const mergedData = this.mergeVehicleData(dataPoints);
    await this.storeVehicleData(mergedData);
    
    return mergedData;
  }
  
  private mergeVehicleData(dataPoints: VehicleData[]): VehicleData {
    // Sort by confidence, highest first
    const sorted = [...dataPoints].sort((a, b) => b.confidence - a.confidence);
    const base = sorted[0];
    
    // Merge additional data points
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      for (const [key, value] of Object.entries(current)) {
        if (key !== 'confidence' && key !== 'lastUpdated' && !base[key]) {
          base[key] = value;
        }
      }
    }
    
    return base;
  }
  
  async storeVehicleData(data: VehicleData): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('vehicles')
        .upsert([data], { onConflict: 'vin' });
      
      return !error;
    } catch (err) {
      console.error('Error storing merged vehicle data:', err);
      return false;
    }
  }
}

export interface AnalysisParameters {
  filters?: Record<string, string | number | boolean>;
  groupBy?: string[];
  timeRange?: {
    start: string;
    end: string;
  };
}

export interface DataAnalyzer<T> {
  analyze(params: AnalysisParameters): Promise<T>;
}

export interface OwnershipAnalysisData {
  totalOwners: number;
  averageDuration: number;
  commonLocations: string[];
  ownerTypes: Record<string, number>;
}

export interface OwnershipAnalysisResult {
  data: OwnershipAnalysisData;
  metadata: {
    timestamp: string;
    parameters: AnalysisParameters;
  };
}

export class OwnershipPatternAnalyzer implements DataAnalyzer<OwnershipAnalysisResult> {
  async analyze(params: AnalysisParameters): Promise<OwnershipAnalysisResult> {
    try {
      const { data, error } = await supabase
        .from('ownership_records')
        .select('*')
        .order('startDate', { ascending: true });
        
      if (error) throw error;
      
      const result: OwnershipAnalysisResult = {
        data: {
          totalOwners: data.length,
          averageDuration: this.calculateAverageDuration(data),
          commonLocations: this.findCommonLocations(data),
          ownerTypes: this.countOwnerTypes(data)
        },
        metadata: {
          timestamp: new Date().toISOString(),
          parameters: params
        }
      };
      
      return result;
    } catch (err) {
      console.error('Error analyzing ownership patterns:', err);
      throw err;
    }
  }

  private calculateAverageDuration(data: OwnershipRecord[]): number {
    // Implementation
    return 0;
  }

  private findCommonLocations(data: OwnershipRecord[]): string[] {
    // Implementation
    return [];
  }

  private countOwnerTypes(data: OwnershipRecord[]): Record<string, number> {
    // Implementation
    return {};
  }
  
  private groupData(data: OwnershipRecord[], groupByFields: string[]): Record<string, OwnershipRecord[]> {
    const result: Record<string, OwnershipRecord[]> = {};
    
    for (const record of data) {
      const recordObj = { ...record } as unknown as Record<string, unknown>;
      const key = groupByFields.map(field => this.getNestedValue(recordObj, field)).join('|');
      result[key] = result[key] || [];
      result[key].push(record);
    }
    
    return result;
  }
  
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current: unknown, part: string) => {
      return (current as Record<string, unknown>)?.[part];
    }, obj);
  }
}

export function initializeDataFramework(): DataCollectionOrchestrator {
  const registry = new DataCollectorRegistry();
  
  // Register collectors with their metadata
  registry.registerCollector('manual', new ManualDataCollector(), {
    id: 'manual',
    name: 'Manual Data Entry',
    description: 'Manual vehicle data entry by users',
    capabilities: {
      providesVehicleData: true,
      providesServiceHistory: true,
      providesOwnershipHistory: true,
      providesSensorData: false,
      providesImages: false
    },
    requiresAuthentication: false
  });
  
  return new DataCollectionOrchestrator(registry);
}
