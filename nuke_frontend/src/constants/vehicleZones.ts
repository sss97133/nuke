/**
 * Vehicle Zone Constants
 *
 * Canonical zone taxonomy for the Nuke platform. The 41-zone `vehicle_zone`
 * system replaces the legacy `angle` column values ("front", "front_3/4",
 * "exterior_three_quarter", etc.). All new code should reference these
 * constants instead of hardcoding zone strings.
 *
 * Zone values are stored in `vehicle_images.vehicle_zone` and classified by
 * YONO (zone classifier, 72.8% val_acc) with confidence in `zone_confidence`.
 */

// ---------------------------------------------------------------------------
// Zone Categories -- groups of zones for UI sectioning and coverage checks
// ---------------------------------------------------------------------------

export const ZONE_CATEGORIES = {
  EXTERIOR: [
    'ext_front',
    'ext_front_driver',
    'ext_front_passenger',
    'ext_driver_side',
    'ext_passenger_side',
    'ext_rear',
    'ext_rear_driver',
    'ext_rear_passenger',
    'ext_roof',
    'ext_undercarriage',
  ],
  PANELS: [
    'panel_hood',
    'panel_trunk',
    'panel_door_fl',
    'panel_door_fr',
    'panel_door_rl',
    'panel_door_rr',
    'panel_fender_fl',
    'panel_fender_fr',
    'panel_fender_rl',
    'panel_fender_rr',
  ],
  WHEELS: [
    'wheel_fl',
    'wheel_fr',
    'wheel_rl',
    'wheel_rr',
  ],
  INTERIOR: [
    'int_dashboard',
    'int_front_seats',
    'int_rear_seats',
    'int_cargo',
    'int_headliner',
    'int_door_panel_fl',
    'int_door_panel_fr',
    'int_door_panel_rl',
    'int_door_panel_rr',
  ],
  MECHANICAL: [
    'mech_engine_bay',
    'mech_transmission',
    'mech_suspension',
  ],
  DETAIL: [
    'detail_vin',
    'detail_badge',
    'detail_damage',
    'detail_odometer',
  ],
  OTHER: [
    'other',
  ],
} as const;

/** Flat list of every valid zone value */
export const ALL_ZONES: string[] = Object.values(ZONE_CATEGORIES).flat();

// ---------------------------------------------------------------------------
// Legacy angle -> zone migration map
// ---------------------------------------------------------------------------

/**
 * Maps old `angle` column values to the closest `vehicle_zone` equivalent.
 * Used during the migration period while DB records still carry legacy values.
 *
 * DEPRECATED: The `angle` column is deprecated. Use `vehicle_zone` directly.
 */
export const ANGLE_TO_ZONE_MAP: Record<string, string> = {
  // Old simple angle strings
  'front': 'ext_front',
  'front_3/4': 'ext_front_driver',
  'side': 'ext_driver_side',
  'rear_3/4': 'ext_rear_driver',
  'rear': 'ext_rear',
  'interior': 'int_dashboard',
  'engine_bay': 'mech_engine_bay',
  'undercarriage': 'ext_undercarriage',
  'detail': 'detail_vin',
  'document': 'other',
  'unknown': 'other',

  // Old verbose angle strings (from AI analysis pipeline)
  'exterior_front': 'ext_front',
  'exterior_rear': 'ext_rear',
  'exterior_side': 'ext_driver_side',
  'exterior_three_quarter': 'ext_front_driver',
  'three_quarter': 'ext_front_driver',
  'front_quarter': 'ext_front_driver',
  'rear_quarter': 'ext_rear_driver',
  'interior_dashboard': 'int_dashboard',
  'interior_front_seats': 'int_front_seats',
  'interior_rear_seats': 'int_rear_seats',
  'interior_door': 'int_door_panel_fl',
  'detail_shot': 'detail_damage',
};

/**
 * Maps old `angle_family` values (from ai_angle_classifications_audit) to zones.
 *
 * DEPRECATED: Use `vehicle_zone` directly.
 */
export const ANGLE_FAMILY_TO_ZONE_MAP: Record<string, string> = {
  'front_corner': 'ext_front_driver',
  'front': 'ext_front',
  'rear_corner': 'ext_rear_driver',
  'rear': 'ext_rear',
  'side': 'ext_driver_side',
  'interior': 'int_dashboard',
  'dash': 'int_dashboard',
  'engine_bay': 'mech_engine_bay',
  'vin_plate': 'detail_vin',
  'document': 'other',
};

// ---------------------------------------------------------------------------
// Human-readable labels for zones
// ---------------------------------------------------------------------------

export const ZONE_LABELS: Record<string, string> = {
  // Exterior
  'ext_front': 'Front',
  'ext_front_driver': 'Front 3/4 Driver',
  'ext_front_passenger': 'Front 3/4 Passenger',
  'ext_driver_side': 'Driver Side',
  'ext_passenger_side': 'Passenger Side',
  'ext_rear': 'Rear',
  'ext_rear_driver': 'Rear 3/4 Driver',
  'ext_rear_passenger': 'Rear 3/4 Passenger',
  'ext_roof': 'Roof',
  'ext_undercarriage': 'Undercarriage',

  // Panels
  'panel_hood': 'Hood',
  'panel_trunk': 'Trunk/Tailgate',
  'panel_door_fl': 'Door - Front Left',
  'panel_door_fr': 'Door - Front Right',
  'panel_door_rl': 'Door - Rear Left',
  'panel_door_rr': 'Door - Rear Right',
  'panel_fender_fl': 'Fender - Front Left',
  'panel_fender_fr': 'Fender - Front Right',
  'panel_fender_rl': 'Fender - Rear Left',
  'panel_fender_rr': 'Fender - Rear Right',

  // Wheels
  'wheel_fl': 'Wheel - Front Left',
  'wheel_fr': 'Wheel - Front Right',
  'wheel_rl': 'Wheel - Rear Left',
  'wheel_rr': 'Wheel - Rear Right',

  // Interior
  'int_dashboard': 'Dashboard',
  'int_front_seats': 'Front Seats',
  'int_rear_seats': 'Rear Seats',
  'int_cargo': 'Cargo Area',
  'int_headliner': 'Headliner',
  'int_door_panel_fl': 'Door Panel - Front Left',
  'int_door_panel_fr': 'Door Panel - Front Right',
  'int_door_panel_rl': 'Door Panel - Rear Left',
  'int_door_panel_rr': 'Door Panel - Rear Right',

  // Mechanical
  'mech_engine_bay': 'Engine Bay',
  'mech_transmission': 'Transmission',
  'mech_suspension': 'Suspension',

  // Detail
  'detail_vin': 'VIN Plate',
  'detail_badge': 'Badge / Emblem',
  'detail_damage': 'Damage Detail',
  'detail_odometer': 'Odometer',

  // Other
  'other': 'Other',
};

// ---------------------------------------------------------------------------
// Display priority scoring -- used by imageDisplayPriority service
// ---------------------------------------------------------------------------

/**
 * Zone-based display priority scores. Higher = shown earlier in galleries.
 * "Money shots" (3/4 views) are highest priority, followed by primary
 * exterior views, then interior, then mechanical, then details.
 */
export const ZONE_DISPLAY_PRIORITY: Record<string, number> = {
  // Money shots -- the hero images buyers want to see first
  'ext_front_driver': 100,
  'ext_front_passenger': 95,
  'ext_rear_driver': 90,
  'ext_rear_passenger': 85,

  // Primary exterior views
  'ext_front': 80,
  'ext_rear': 75,
  'ext_driver_side': 70,
  'ext_passenger_side': 65,
  'ext_roof': 40,

  // Panels (moderate interest)
  'panel_hood': 35,
  'panel_trunk': 34,
  'panel_door_fl': 33,
  'panel_door_fr': 32,
  'panel_door_rl': 31,
  'panel_door_rr': 30,
  'panel_fender_fl': 29,
  'panel_fender_fr': 28,
  'panel_fender_rl': 27,
  'panel_fender_rr': 26,

  // Interior
  'int_dashboard': 60,
  'int_front_seats': 55,
  'int_rear_seats': 50,
  'int_cargo': 45,
  'int_headliner': 38,
  'int_door_panel_fl': 36,
  'int_door_panel_fr': 36,
  'int_door_panel_rl': 36,
  'int_door_panel_rr': 36,

  // Mechanical
  'mech_engine_bay': 58,
  'mech_transmission': 25,
  'mech_suspension': 24,

  // Wheels
  'wheel_fl': 22,
  'wheel_fr': 21,
  'wheel_rl': 20,
  'wheel_rr': 19,

  // Undercarriage
  'ext_undercarriage': 15,

  // Detail
  'detail_vin': 18,
  'detail_badge': 12,
  'detail_damage': 10,
  'detail_odometer': 16,

  // Other
  'other': 5,
};

// ---------------------------------------------------------------------------
// Coverage definitions -- used by imageCoverageTracker service
// ---------------------------------------------------------------------------

/**
 * Essential zones that constitute "complete coverage" of a vehicle.
 * A listing with at least one image in each of these zones is considered
 * well-documented.
 */
export const ESSENTIAL_ZONES: string[] = [
  'ext_front',
  'ext_front_driver',
  'ext_rear',
  'ext_rear_driver',
  'ext_driver_side',
  'ext_passenger_side',
  'int_dashboard',
  'int_front_seats',
  'mech_engine_bay',
  'detail_vin',
];

/**
 * Minimum zone coverage needed per category for a "complete" listing.
 * Keys are category names from ZONE_CATEGORIES.
 */
export const MINIMUM_CATEGORY_COVERAGE: Record<string, number> = {
  EXTERIOR: 4,   // At least 4 of 10 exterior zones
  INTERIOR: 2,   // At least dashboard + front seats
  MECHANICAL: 1, // At least engine bay
  DETAIL: 1,     // At least VIN
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a legacy angle string to a vehicle_zone value.
 * Returns the zone if already a valid zone, otherwise maps via ANGLE_TO_ZONE_MAP.
 * Falls back to 'other' for unrecognized values.
 */
export function resolveToZone(angleOrZone: string | null | undefined): string {
  if (!angleOrZone) return 'other';
  const normalized = angleOrZone.trim().toLowerCase();
  if (ALL_ZONES.includes(normalized)) return normalized;
  return ANGLE_TO_ZONE_MAP[normalized] || 'other';
}

/**
 * Get the human-readable label for a zone value.
 * Falls back to title-casing the raw zone string.
 */
export function getZoneLabel(zone: string): string {
  return ZONE_LABELS[zone] || zone.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get the zone category (EXTERIOR, INTERIOR, etc.) for a zone value.
 * Returns null if the zone is not in any category.
 */
export function getZoneCategory(zone: string): string | null {
  for (const [category, zones] of Object.entries(ZONE_CATEGORIES)) {
    if ((zones as readonly string[]).includes(zone)) return category;
  }
  return null;
}
