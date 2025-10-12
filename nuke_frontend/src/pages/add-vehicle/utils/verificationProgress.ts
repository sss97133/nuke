// AddVehicle - Verification Progress Calculation
import { FIELD_GROUPS } from '../types';
import type { VehicleFormData, VerificationProgress, FieldGroup } from '../types';

// Point values for different field types
const FIELD_POINTS: Record<string, number> = {
  // Core fields (high value)
  make: 10, model: 10, year: 8, vin: 15, license_plate: 5,

  // Physical specs (medium value)
  color: 3, interior_color: 2, body_style: 5, doors: 2, seats: 2,

  // Engine & Performance (high value)
  fuel_type: 4, transmission: 5, engine_size: 6, displacement: 4,
  horsepower: 7, torque: 5, drivetrain: 4,

  // Dimensions (medium value)
  weight_lbs: 3, length_inches: 2, width_inches: 2, height_inches: 2, wheelbase_inches: 2,

  // Fuel economy (medium value)
  fuel_capacity_gallons: 2, mpg_city: 3, mpg_highway: 3, mpg_combined: 4,

  // Financial (high value)
  msrp: 5, current_value: 8, purchase_price: 10, purchase_date: 6,
  purchase_location: 3, asking_price: 5,

  // Ownership (high value)
  mileage: 8, previous_owners: 4, condition_rating: 6,

  // Modifications (medium value)
  modification_details: 5,

  // Legal & Insurance (medium value)
  maintenance_notes: 4, insurance_company: 3, insurance_policy_number: 2,
  registration_state: 2, registration_expiry: 2, inspection_expiry: 2,

  // System fields (low value)
  notes: 2, owner_name: 3
};

// Verification tiers and milestones
const VERIFICATION_TIERS = [
  { tier: 1, minPoints: 0, maxPoints: 49, label: 'Basic Entry', description: 'Core vehicle information' },
  { tier: 2, minPoints: 50, maxPoints: 99, label: 'Standard Verification', description: 'Detailed specifications' },
  { tier: 3, minPoints: 100, maxPoints: 149, label: 'Enhanced Profile', description: 'Complete vehicle history' },
  { tier: 4, minPoints: 150, maxPoints: 199, label: 'Professional Documentation', description: 'Comprehensive details' },
  { tier: 5, minPoints: 200, maxPoints: Infinity, label: 'Expert Certification', description: 'Maximum verification level' }
];

/**
 * Calculate verification progress based on form data
 */
export function calculateVerificationProgress(data: VehicleFormData): VerificationProgress {
  let totalPoints = 0;
  let fieldsCompleted = 0;
  const totalFields = Object.keys(FIELD_POINTS).length;

  // Calculate points for completed fields
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      const points = FIELD_POINTS[key] || 0;
      if (points > 0) {
        totalPoints += points;
        fieldsCompleted++;
      }
    }
  });

  // Special case: boolean fields should count if explicitly set to true
  if (data.is_modified) fieldsCompleted++;
  if (data.is_for_sale) fieldsCompleted++;
  if (data.is_public) fieldsCompleted++;

  // Find current tier
  const currentTier = VERIFICATION_TIERS.find(tier =>
    totalPoints >= tier.minPoints && totalPoints <= tier.maxPoints
  ) || VERIFICATION_TIERS[0];

  // Calculate completion percentage within current tier
  const tierRange = currentTier.maxPoints - currentTier.minPoints + 1;
  const tierProgress = Math.min(totalPoints - currentTier.minPoints, tierRange - 1);
  const completionPercentage = Math.round((tierProgress / tierRange) * 100);

  // Determine next milestone
  const nextTier = VERIFICATION_TIERS.find(tier => tier.tier === currentTier.tier + 1);
  const nextMilestone = nextTier
    ? `${nextTier.minPoints - totalPoints} more points to reach ${nextTier.label}`
    : 'Maximum verification level achieved!';

  return {
    tier: currentTier.tier,
    points: totalPoints,
    completionPercentage,
    nextMilestone,
    fieldsCompleted,
    totalFields
  };
}

/**
 * Get field suggestions based on current progress
 */
export function getFieldSuggestions(data: VehicleFormData, tier: number): string[] {
  const suggestions: string[] = [];

  if (tier === 1) {
    // Basic tier - focus on core fields
    FIELD_GROUPS.CORE.forEach(field => {
      if (!data[field as keyof VehicleFormData]) {
        suggestions.push(field);
      }
    });
  } else if (tier === 2) {
    // Standard tier - add physical specs
    [...FIELD_GROUPS.PHYSICAL, ...FIELD_GROUPS.ENGINE].forEach(field => {
      if (!data[field as keyof VehicleFormData]) {
        suggestions.push(field);
      }
    });
  } else if (tier >= 3) {
    // Higher tiers - comprehensive details
    Object.keys(FIELD_POINTS).forEach(field => {
      if (!data[field as keyof VehicleFormData]) {
        suggestions.push(field);
      }
    });
  }

  // Return top 5 highest-value missing fields
  return suggestions
    .sort((a, b) => (FIELD_POINTS[b] || 0) - (FIELD_POINTS[a] || 0))
    .slice(0, 5);
}

/**
 * Get tier information
 */
export function getTierInfo(tier: number) {
  return VERIFICATION_TIERS.find(t => t.tier === tier) || VERIFICATION_TIERS[0];
}