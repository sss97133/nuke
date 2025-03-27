/**
 * Data Contracts for Vehicle-Centric Architecture
 * 
 * This file defines strict TypeScript interfaces that enforce data consistency
 * and deterministic behavior across the entire application.
 */

// Core Vehicle Data Contract
export interface VehicleRecord {
  id: string;                  // UUID primary key
  vin: string;                 // Vehicle Identification Number (normalized to uppercase)
  make: string;                // Manufacturer name (normalized)
  model: string;               // Model name (normalized)
  year: number;                // Model year as integer (YYYY)
  trim?: string;               // Trim level
  color?: string;              // Primary exterior color
  mileage?: number;            // Current odometer reading
  fuel_type?: string;          // Fuel type (gasoline, diesel, electric, etc.)
  engine_size?: string;        // Engine displacement or power
  transmission_type?: string;  // Transmission type
  drivetrain_type?: string;    // Drivetrain configuration
  body_style?: string;         // Body style classification
  license_plate?: string;      // License plate number
  registration_state?: string; // Registration state/province
  last_updated: string;        // ISO timestamp of last update
  data_source?: string;        // ID of the data source that provided/updated this record
  confidence: number;          // Confidence score from 0.0 to 1.0
  created_at: string;          // ISO timestamp of record creation
  additional_details?: Record<string, unknown>; // Extensible properties
}

// Event Timeline Contract
export interface TimelineEvent {
  id: string;                  // UUID primary key
  vehicle_id: string;          // Reference to vehicle.id
  event_type: EventType;       // Categorized event type
  event_date: string;          // ISO timestamp of when the event occurred
  description: string;         // Text description of the event
  data_source: string;         // ID of the data source that provided this event
  confidence: number;          // Confidence score from 0.0 to 1.0
  metadata?: Record<string, unknown>; // Additional event metadata
  created_at: string;          // ISO timestamp of record creation
}

// Service Record Contract
export interface ServiceRecord {
  id: string;                  // UUID primary key
  vehicle_id: string;          // Reference to vehicle.id
  service_date: string;        // ISO timestamp of service date
  mileage?: number;            // Odometer reading at service time
  service_type: string;        // Type of service performed
  description?: string;        // Detailed description
  cost?: number;               // Total cost of service
  provider?: string;           // Service provider name
  data_source: string;         // ID of the data source
  confidence: number;          // Confidence score from 0.0 to 1.0
  additional_details?: Record<string, unknown>; // Extensible properties
  created_at: string;          // ISO timestamp of record creation
}

// Parts Record Contract
export interface PartRecord {
  id: string;                  // UUID primary key
  service_record_id?: string;  // Optional reference to service_records.id
  part_number?: string;        // Manufacturer part number
  name: string;                // Part name/description
  quantity: number;            // Quantity used/installed
  unit_cost?: number;          // Cost per unit
  condition: PartCondition;    // Part condition classification
  additional_details?: Record<string, unknown>; // Extensible properties
  created_at: string;          // ISO timestamp of record creation
}

// Ownership Record Contract
export interface OwnershipRecord {
  id: string;                  // UUID primary key
  vehicle_id: string;          // Reference to vehicle.id
  start_date: string;          // ISO timestamp of ownership start
  end_date?: string;           // ISO timestamp of ownership end (null if current)
  owner_type: OwnerType;       // Type of owner
  owner_name?: string;         // Name of owner (if available)
  address?: string;            // Address
  city?: string;               // City
  state?: string;              // State/province
  country?: string;            // Country
  postal_code?: string;        // Postal/ZIP code
  latitude?: number;           // Geolocation latitude
  longitude?: number;          // Geolocation longitude
  data_source: string;         // ID of the data source
  confidence: number;          // Confidence score from 0.0 to 1.0
  additional_details?: Record<string, unknown>; // Extensible properties
  created_at: string;          // ISO timestamp of record creation
}

// Data Source Definition Contract
export interface DataSource {
  id: string;                  // Unique identifier for the source
  name: string;                // Display name
  description?: string;        // Detailed description
  capabilities: DataSourceCapabilities; // What this source can provide
  requires_authentication: boolean; // Whether auth is required
  auth_type?: string;          // Type of authentication if required
  auth_config?: Record<string, unknown>; // Auth configuration
  rate_limit?: RateLimit;      // API rate limiting
  created_at: string;          // ISO timestamp of record creation
  updated_at: string;          // ISO timestamp of last update
}

// User Preference Contract
export interface UserPreferences {
  id: string;                  // User ID or 'current_user'
  preferences: {
    theme: ThemePreference;    // UI theme preference
    fontSize: number;          // Font size scale factor
    spacing: SpacingPreference; // UI spacing density
    animations: boolean;       // Whether to show animations
    colorAccent: string;       // Accent color (hex)
    [key: string]: unknown;    // Additional preferences
  };
  created_at: string;          // ISO timestamp of record creation
  updated_at: string;          // ISO timestamp of last update
}

// User Interaction Contract
export interface UserInteraction {
  id: string;                  // UUID primary key
  user_id?: string;            // Reference to user ID (null for anonymous)
  element: string;             // UI element interacted with
  action: InteractionAction;   // Type of interaction
  timestamp: string;           // ISO timestamp of interaction
  metadata?: Record<string, unknown>; // Additional interaction data
}

// Data Collection Permission Contract
export interface DataCollectionPermission {
  id: string;                  // UUID primary key
  user_id: string;             // Reference to auth.users.id
  data_type: string;           // Type of data collection
  is_allowed: boolean;         // Whether collection is permitted
  scope?: Record<string, unknown>; // Permission scope details
  created_at: string;          // ISO timestamp of record creation
  updated_at: string;          // ISO timestamp of last update
}

// Vehicle Image Contract
export interface VehicleImage {
  id: string;                  // UUID primary key
  vehicle_id: string;          // Reference to vehicle.id
  url: string;                 // Image URL
  timestamp: string;           // ISO timestamp when image was taken
  image_type: ImageType;       // Type of image
  angle?: string;              // Camera angle
  confidence: number;          // Confidence score from 0.0 to 1.0
  labels?: Record<string, unknown>; // AI-generated labels
  additional_details?: Record<string, unknown>; // Extensible properties
  created_at: string;          // ISO timestamp of record creation
}

// Sensor Data Record Contract
export interface SensorDataRecord {
  id: string;                  // UUID primary key
  vehicle_id: string;          // Reference to vehicle.id
  timestamp: string;           // ISO timestamp of reading
  sensor_type: string;         // Type of sensor
  value: Record<string, unknown>; // Sensor reading data
  unit?: string;               // Unit of measurement
  confidence: number;          // Confidence score from 0.0 to 1.0
  additional_details?: Record<string, unknown>; // Extensible properties
  created_at: string;          // ISO timestamp of record creation
}

// Vehicle History Record Contract
export interface VehicleHistoryRecord {
  id: string;                  // UUID primary key
  vin: string;                 // Vehicle VIN
  data: Record<string, unknown>; // Complete vehicle data snapshot
  timestamp: string;           // ISO timestamp of record
  source?: string;             // Source of change
  change_type: ChangeType;     // Type of change
  changed_by?: string;         // ID of user or system making change
}

// Data Normalization Result
export interface NormalizationResult<T> {
  success: boolean;            // Whether normalization succeeded
  data?: T;                    // Normalized data (if success)
  errors?: NormalizationError[]; // Errors (if not success)
  warnings?: NormalizationWarning[]; // Warnings (even if success)
  confidence: number;          // Overall confidence in normalized result
  source_data: unknown;        // Original source data
  source_id: string;           // ID of data source
  timestamp: string;           // ISO timestamp of normalization
}

// Error during normalization
export interface NormalizationError {
  code: string;                // Error code
  field?: string;              // Field with error (if applicable)
  message: string;             // Human-readable error message
  severity: 'fatal' | 'error'; // Severity level
}

// Warning during normalization
export interface NormalizationWarning {
  code: string;                // Warning code
  field?: string;              // Field with warning (if applicable)
  message: string;             // Human-readable warning message
  severity: 'warning' | 'info'; // Severity level
}

// Data Source Capabilities
export interface DataSourceCapabilities {
  providesVehicleData: boolean;      // Basic vehicle info
  providesServiceHistory: boolean;   // Service records
  providesOwnershipHistory: boolean; // Ownership records
  providesSensorData: boolean;       // Sensor/telemetry data
  providesImages: boolean;           // Vehicle images
  [key: string]: boolean | unknown;  // Extensible capabilities
}

// API Rate Limit Configuration
export interface RateLimit {
  requests_per_second?: number;      // Max requests per second
  requests_per_minute?: number;      // Max requests per minute
  requests_per_hour?: number;        // Max requests per hour
  requests_per_day?: number;         // Max requests per day
  concurrent_requests?: number;      // Max concurrent requests
}

// Enums for strict type checking

export enum EventType {
  SERVICE = 'service',
  OWNERSHIP_CHANGE = 'ownership_change',
  REGISTRATION = 'registration',
  ACCIDENT = 'accident',
  RECALL = 'recall',
  MODIFICATION = 'modification',
  INSPECTION = 'inspection',
  OTHER = 'other'
}

export enum PartCondition {
  NEW = 'new',
  USED = 'used',
  REFURBISHED = 'refurbished',
  UNKNOWN = 'unknown'
}

export enum OwnerType {
  INDIVIDUAL = 'individual',
  BUSINESS = 'business',
  GOVERNMENT = 'government',
  UNKNOWN = 'unknown'
}

export enum ImageType {
  EXTERIOR = 'exterior',
  INTERIOR = 'interior',
  DAMAGE = 'damage',
  PART = 'part',
  OTHER = 'other'
}

export enum InteractionAction {
  CLICK = 'click',
  VIEW = 'view',
  EDIT = 'edit',
  SEARCH = 'search',
  FILTER = 'filter',
  SORT = 'sort',
  NAVIGATE = 'navigate'
}

export enum ThemePreference {
  LIGHT = 'light',
  DARK = 'dark',
  SYSTEM = 'system'
}

export enum SpacingPreference {
  COMPACT = 'compact',
  NORMAL = 'normal',
  SPACIOUS = 'spacious'
}

export enum ChangeType {
  INSERT = 'insert',
  UPDATE = 'update',
  DELETE = 'delete'
}

// Type guards for runtime validation

/**
 * Check if value is a valid VehicleRecord
 */
export function isVehicleRecord(value: unknown): value is VehicleRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<VehicleRecord>;
  
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    typeof v.vin === 'string' && v.vin.length > 0 &&
    typeof v.make === 'string' && v.make.length > 0 &&
    typeof v.model === 'string' && v.model.length > 0 &&
    typeof v.year === 'number' && v.year > 1900 && v.year <= new Date().getFullYear() + 1 &&
    typeof v.confidence === 'number' && v.confidence >= 0 && v.confidence <= 1 &&
    typeof v.created_at === 'string' && v.created_at.length > 0 &&
    typeof v.last_updated === 'string' && v.last_updated.length > 0
  );
}

/**
 * Check if value is a valid TimelineEvent
 */
export function isTimelineEvent(value: unknown): value is TimelineEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<TimelineEvent>;
  
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    typeof v.vehicle_id === 'string' && v.vehicle_id.length > 0 &&
    typeof v.event_type === 'string' && Object.values(EventType).includes(v.event_type as EventType) &&
    typeof v.event_date === 'string' && v.event_date.length > 0 &&
    typeof v.description === 'string' &&
    typeof v.data_source === 'string' && v.data_source.length > 0 &&
    typeof v.confidence === 'number' && v.confidence >= 0 && v.confidence <= 1 &&
    typeof v.created_at === 'string' && v.created_at.length > 0
  );
}

/**
 * Normalize a VIN to standard format
 * This ensures deterministic behavior when handling VINs
 */
export function normalizeVin(vin: string): string {
  // Remove all spaces, convert to uppercase
  return vin.replace(/\s+/g, '').toUpperCase();
}

/**
 * Normalize a make/manufacturer name
 * This ensures deterministic behavior when handling manufacturer names
 */
export function normalizeMake(make: string): string {
  // Trim spaces, convert to title case
  return make.trim().replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Normalize a model name
 * This ensures deterministic behavior when handling model names
 */
export function normalizeModel(model: string): string {
  // Trim spaces, preserve original casing but remove extra spaces
  return model.trim().replace(/\s+/g, ' ');
}

/**
 * Create a deterministic ID for deduplicating vehicle records
 */
export function createDeterministicVehicleId(vin: string): string {
  const normalizedVin = normalizeVin(vin);
  
  // Simple deterministic algorithm - in production you would use a more
  // sophisticated approach, possibly with a cryptographic hash
  let hash = 0;
  for (let i = 0; i < normalizedVin.length; i++) {
    const char = normalizedVin.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Convert to a positive hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Calculate a deterministic confidence score for vehicle data
 * based on the completeness and source reliability
 */
export function calculateVehicleDataConfidence(
  data: Partial<VehicleRecord>, 
  sourceReliability: number
): number {
  // Start with the source reliability score
  let confidence = sourceReliability;
  
  // Required fields must be present
  if (!data.vin || !data.make || !data.model || !data.year) {
    return 0;
  }
  
  // Calculate completeness score based on optional fields
  const optionalFields = [
    'trim', 'color', 'mileage', 'fuel_type', 
    'engine_size', 'transmission_type', 'drivetrain_type', 
    'body_style', 'license_plate', 'registration_state'
  ];
  
  const presentOptionalFields = optionalFields.filter(field => 
    data[field as keyof Partial<VehicleRecord>] !== undefined &&
    data[field as keyof Partial<VehicleRecord>] !== null &&
    data[field as keyof Partial<VehicleRecord>] !== ''
  );
  
  // Completeness factor (0.0 - 0.5)
  const completeness = (presentOptionalFields.length / optionalFields.length) * 0.5;
  
  // Adjust confidence by completeness
  confidence = confidence * (0.5 + completeness);
  
  // Ensure confidence is within bounds
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Generic data validator that ensures objects conform to expected types
 * with the option to throw errors for missing required fields
 */
export function validateData<T>(
  data: unknown, 
  requiredFields: (keyof T)[], 
  typeValidators: Partial<Record<keyof T, (val: unknown) => boolean>>,
  throwOnError = false
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  const result = { isValid: true, errors };
  
  if (!data || typeof data !== 'object') {
    result.isValid = false;
    errors.push('Data must be an object');
    if (throwOnError) throw new Error('Data must be an object');
    return result;
  }
  
  const dataObj = data as Partial<T>;
  
  // Check required fields
  for (const field of requiredFields) {
    if (dataObj[field] === undefined || dataObj[field] === null) {
      result.isValid = false;
      errors.push(`Required field '${String(field)}' is missing`);
    }
  }
  
  // Check field types
  for (const [field, validator] of Object.entries(typeValidators)) {
    const value = dataObj[field as keyof T];
    
    if (value !== undefined && value !== null && !validator!(value)) {
      result.isValid = false;
      errors.push(`Field '${field}' has invalid type or format`);
    }
  }
  
  if (throwOnError && !result.isValid) {
    throw new Error(`Data validation failed: ${errors.join(', ')}`);
  }
  
  return result;
}
