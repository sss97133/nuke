/**
 * Hierarchical vehicle model → series → trim relationships
 * This data structure enables arboreal connections for form dropdowns
 * Data can be improved over time as users add more accurate information
 */

export interface SeriesOption {
  code: string; // e.g., "K5", "C5", "C10", "K10"
  name: string; // Display name
  description?: string; // Optional description
  is2WD?: boolean; // For 2WD variants that might be reported as either
}

export interface TrimOption {
  name: string; // e.g., "Silverado", "Cheyenne", "Scottsdale"
  years?: { start?: number; end?: number }; // Year range if applicable
  description?: string;
}

export interface ModelSeriesTrim {
  model: string; // Base model name (e.g., "Blazer", "Suburban", "C/K")
  make: string; // Manufacturer (e.g., "Chevrolet", "GMC")
  series: SeriesOption[]; // Available series for this model
  trims: Record<string, TrimOption[]>; // Trims keyed by series code
  notes?: string; // Any special notes about this model
}

/**
 * Vehicle model hierarchy data
 * Organized by make → model → series → trim
 */
export const vehicleModelHierarchy: ModelSeriesTrim[] = [
  {
    model: 'Blazer',
    make: 'Chevrolet',
    series: [
      { code: 'K5', name: 'K5', description: '4WD Blazer' },
      { code: 'C5', name: 'C5', description: '2WD Blazer (rare, often just reported as K5)' },
    ],
    trims: {
      'K5': [
        { name: 'Base' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
        { name: 'Scout' },
        { name: 'Custom Deluxe' },
        { name: 'Chalet' },
        { name: 'Diesel' },
      ],
      'C5': [
        { name: 'Base' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
        { name: 'Custom Deluxe' },
      ],
    },
    notes: '2WD versions (C5) are rarely reported as such - often just called K5 Blazer',
  },
  {
    model: 'C/K',
    make: 'Chevrolet',
    series: [
      { code: 'C10', name: 'C10', description: '2WD 1/2 ton' },
      { code: 'C20', name: 'C20', description: '2WD 3/4 ton' },
      { code: 'C30', name: 'C30', description: '2WD 1 ton' },
      { code: 'K10', name: 'K10', description: '4WD 1/2 ton' },
      { code: 'K20', name: 'K20', description: '4WD 3/4 ton' },
      { code: 'K30', name: 'K30', description: '4WD 1 ton' },
    ],
    trims: {
      'C10': [
        { name: 'Base' },
        { name: 'Custom Deluxe' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
        { name: 'Scottsdale' },
        { name: 'Big 10' },
      ],
      'C20': [
        { name: 'Base' },
        { name: 'Custom Deluxe' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
        { name: 'Scottsdale' },
      ],
      'C30': [
        { name: 'Base' },
        { name: 'Custom Deluxe' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
      ],
      'K10': [
        { name: 'Base' },
        { name: 'Custom Deluxe' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
        { name: 'Scottsdale' },
        { name: 'Big 10' },
      ],
      'K20': [
        { name: 'Base' },
        { name: 'Custom Deluxe' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
        { name: 'Scottsdale' },
      ],
      'K30': [
        { name: 'Base' },
        { name: 'Custom Deluxe' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
      ],
    },
  },
  {
    model: 'Suburban',
    make: 'Chevrolet',
    series: [
      { code: 'C10', name: 'C10', description: '2WD 1/2 ton' },
      { code: 'C20', name: 'C20', description: '2WD 3/4 ton' },
      { code: 'K10', name: 'K10', description: '4WD 1/2 ton' },
      { code: 'K20', name: 'K20', description: '4WD 3/4 ton' },
    ],
    trims: {
      'C10': [
        { name: 'Base' },
        { name: 'Custom Deluxe' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
      ],
      'C20': [
        { name: 'Base' },
        { name: 'Custom Deluxe' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
      ],
      'K10': [
        { name: 'Base' },
        { name: 'Custom Deluxe' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
      ],
      'K20': [
        { name: 'Base' },
        { name: 'Custom Deluxe' },
        { name: 'Cheyenne' },
        { name: 'Silverado' },
      ],
    },
  },
  // GMC versions (similar structure)
  {
    model: 'Jimmy',
    make: 'GMC',
    series: [
      { code: 'K5', name: 'K5', description: '4WD Jimmy' },
      { code: 'C5', name: 'C5', description: '2WD Jimmy (rare)' },
    ],
    trims: {
      'K5': [
        { name: 'Base' },
        { name: 'Sierra' },
        { name: 'Sierra Classic' },
        { name: 'Sierra Grande' },
      ],
      'C5': [
        { name: 'Base' },
        { name: 'Sierra' },
        { name: 'Sierra Classic' },
      ],
    },
  },
  {
    model: 'Sierra',
    make: 'GMC',
    series: [
      { code: 'C1500', name: 'C1500', description: '2WD 1/2 ton' },
      { code: 'C2500', name: 'C2500', description: '2WD 3/4 ton' },
      { code: 'K1500', name: 'K1500', description: '4WD 1/2 ton' },
      { code: 'K2500', name: 'K2500', description: '4WD 3/4 ton' },
    ],
    trims: {
      'C1500': [
        { name: 'Base' },
        { name: 'Sierra' },
        { name: 'Sierra Classic' },
        { name: 'Sierra Grande' },
      ],
      'C2500': [
        { name: 'Base' },
        { name: 'Sierra' },
        { name: 'Sierra Classic' },
      ],
      'K1500': [
        { name: 'Base' },
        { name: 'Sierra' },
        { name: 'Sierra Classic' },
        { name: 'Sierra Grande' },
      ],
      'K2500': [
        { name: 'Base' },
        { name: 'Sierra' },
        { name: 'Sierra Classic' },
      ],
    },
  },
];

/**
 * Get available series options for a given make and model
 */
export function getSeriesOptions(make: string, model: string): SeriesOption[] {
  const hierarchy = vehicleModelHierarchy.find(
    h => h.make.toLowerCase() === make.toLowerCase() && 
         h.model.toLowerCase() === model.toLowerCase()
  );
  return hierarchy?.series || [];
}

/**
 * Get available trim options for a given make, model, and series
 */
export function getTrimOptions(make: string, model: string, series: string): TrimOption[] {
  const hierarchy = vehicleModelHierarchy.find(
    h => h.make.toLowerCase() === make.toLowerCase() && 
         h.model.toLowerCase() === model.toLowerCase()
  );
  if (!hierarchy) return [];
  
  // Get trims for the selected series
  const trims = hierarchy.trims[series] || [];
  
  // Also include trims from C5 if series is K5 and C5 exists (for 2WD variants)
  if (series === 'K5' && hierarchy.trims['C5']) {
    const c5Trims = hierarchy.trims['C5'] || [];
    // Merge and deduplicate
    const allTrims = [...trims, ...c5Trims];
    const uniqueTrims = allTrims.filter((trim, index, self) =>
      index === self.findIndex(t => t.name === trim.name)
    );
    return uniqueTrims;
  }
  
  return trims;
}

/**
 * Check if a model has hierarchical data available
 */
export function hasHierarchyData(make: string, model: string): boolean {
  return vehicleModelHierarchy.some(
    h => h.make.toLowerCase() === make.toLowerCase() && 
         h.model.toLowerCase() === model.toLowerCase()
  );
}

/**
 * Normalize model name (remove series from model field)
 * e.g., "K5 Blazer" → "Blazer"
 */
export function normalizeModelName(model: string): string {
  // Remove common series prefixes
  const seriesPrefixes = ['K5', 'C5', 'K10', 'C10', 'K20', 'C20', 'K30', 'C30', 'K1500', 'C1500', 'K2500', 'C2500'];
  let normalized = model;
  for (const prefix of seriesPrefixes) {
    if (normalized.startsWith(prefix + ' ')) {
      normalized = normalized.substring(prefix.length + 1);
      break;
    }
  }
  return normalized.trim();
}

