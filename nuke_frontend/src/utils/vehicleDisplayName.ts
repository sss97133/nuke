/**
 * Utility functions for formatting vehicle display names
 */

export interface VehicleNameParts {
  year: number;
  make: string;
  model?: string;
  series?: string;
  trim?: string;
  body_style?: string;
  engine_size?: string;
  transmission?: string;
}

/**
 * Get the primary vehicle name (Year Make Model/Series)
 */
export function getVehiclePrimaryName(vehicle: VehicleNameParts): string {
  const parts = [
    vehicle.year,
    vehicle.make,
    vehicle.model || vehicle.series || ''
  ].filter(Boolean);
  
  return parts.join(' ').trim();
}

/**
 * Get the secondary vehicle details (Trim, Body Style)
 */
export function getVehicleSecondaryDetails(vehicle: VehicleNameParts): string | null {
  const parts = [];
  
  // Add series if model exists (to avoid duplication)
  if (vehicle.model && vehicle.series && vehicle.series !== vehicle.model) {
    parts.push(vehicle.series);
  }
  
  // Add trim
  if (vehicle.trim) {
    parts.push(vehicle.trim);
  }
  
  // Add body style if not already in model/series
  if (vehicle.body_style) {
    const bodyLower = vehicle.body_style.toLowerCase();
    const modelLower = (vehicle.model || '').toLowerCase();
    const seriesLower = (vehicle.series || '').toLowerCase();
    
    if (!modelLower.includes(bodyLower) && !seriesLower.includes(bodyLower)) {
      parts.push(vehicle.body_style);
    }
  }
  
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Get the powertrain details (Engine + Transmission)
 */
export function getVehiclePowertrainDetails(vehicle: VehicleNameParts): string | null {
  const parts = [];
  
  if (vehicle.engine_size) {
    parts.push(vehicle.engine_size);
  }
  
  if (vehicle.transmission) {
    parts.push(vehicle.transmission);
  }
  
  return parts.length > 0 ? parts.join(' • ') : null;
}

/**
 * Get the complete vehicle display name
 * Format: "Year Make Model/Series"
 * Secondary: "Trim Body"
 * Tertiary: "Engine • Transmission"
 */
export function getVehicleDisplayName(vehicle: VehicleNameParts, includeDetails: boolean = false): string {
  const primary = getVehiclePrimaryName(vehicle);
  
  if (!includeDetails) {
    return primary;
  }
  
  const secondary = getVehicleSecondaryDetails(vehicle);
  const powertrain = getVehiclePowertrainDetails(vehicle);
  
  const parts = [primary];
  if (secondary) parts.push(`(${secondary})`);
  if (powertrain) parts.push(`[${powertrain}]`);
  
  return parts.join(' ');
}

/**
 * Format vehicle name with structured hierarchy for UI display
 */
export function getVehicleNameHierarchy(vehicle: VehicleNameParts) {
  return {
    primary: getVehiclePrimaryName(vehicle),
    secondary: getVehicleSecondaryDetails(vehicle),
    powertrain: getVehiclePowertrainDetails(vehicle)
  };
}

