// Define base type interfaces
interface VehicleData {
  id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  trim?: string;
  color?: string;
  mileage?: number;
  data_source?: string;
  confidence?: number;
  additional_details?: Record<string, unknown>;
  last_updated?: string;
  [key: string]: unknown;
}

interface TimelineEventData {
  id: string;
  vehicle_id: string;
  event_type: string;
  event_date: string;
  description: string;
  data_source: string;
  confidence: number;
  details?: Record<string, unknown>;
}

/**
 * Base interface for all data source connectors in the multi-source framework
 * 
 * Each connector implements standardized methods for fetching, transforming,
 * and validating vehicle data across different sources.
 */
export interface ConnectorInterface {
  // Core methods that all connectors should implement
  enrichVehicleData?(vehicle: VehicleData): Promise<VehicleData>;
  generateSmartTimeline?(vehicle: VehicleData): Promise<TimelineEventData[]>;
  evaluateConfidence?(vehicleData: VehicleData[], field: string): Promise<{
    recommendedValue: unknown;
    confidence: number;
    reasoning: string;
  }>;
  generateVehicleDescription?(vehicle: VehicleData): Promise<string>;
}

/**
 * Data Source Information for UI display
 */
export interface DataSourceInfo {
  id: string;
  name: string;
  isConnected: boolean;
  icon: string;
  description?: string;
}

/**
 * Configuration for each connector
 */
export interface ConnectorConfig {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  apiKey?: string;
  baseUrl?: string;
  credentials?: Record<string, string>;
  options?: Record<string, unknown>;
}

/**
 * Registry of available connectors in the system
 */
export const CONNECTOR_REGISTRY = {
  GEMINI_AI: 'gemini_ai',
  BAT_AUCTION: 'bat_connector',
  VIN_DECODER: 'vin_decoder',
  NHTSA_DATA: 'nhtsa_data',
  SERVICE_RECORDS: 'service_records',
  MANUAL_ENTRY: 'manual_entry'
};
