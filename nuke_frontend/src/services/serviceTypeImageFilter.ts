/**
 * Service Type Image Filter
 * 
 * Scalable system for filtering images based on service type
 * Each service type has specific questions that determine relevance
 * 
 * The algorithm: Ask targeted yes/no questions that are:
 * 1. Specific to the service type
 * 2. Scalable (binary, fast to answer)
 * 3. Tunable (prompt engineering)
 */

export type ServiceType = 
  | 'body_shop'
  | 'mechanic'
  | 'upholstery'
  | 'paint_shop'
  | 'restoration'
  | 'performance'
  | 'detailing'
  | 'general';

export interface ImageFilterQuestion {
  id: string;
  question: string;
  weight: number; // 0-1, how important this question is
  required: boolean; // Must be true to include image
}

export interface ServiceTypeFilter {
  serviceType: ServiceType;
  displayName: string;
  description: string;
  questions: ImageFilterQuestion[];
  minimumScore: number; // 0-1, minimum weighted score to include
}

/**
 * Service-specific filter definitions
 * These are the prompts that tune our algorithm
 */
export const SERVICE_TYPE_FILTERS: Record<ServiceType, ServiceTypeFilter> = {
  body_shop: {
    serviceType: 'body_shop',
    displayName: 'Body Shop',
    description: 'Collision repair, dent removal, panel work',
    minimumScore: 0.6,
    questions: [
      {
        id: 'shows_body_damage',
        question: 'Does this image show body damage, dents, rust, or panel work?',
        weight: 0.3,
        required: false
      },
      {
        id: 'shows_paint_prep',
        question: 'Does this image show paint preparation (sanding, primer, masking, booth)?',
        weight: 0.25,
        required: false
      },
      {
        id: 'shows_welding_fabrication',
        question: 'Does this image show welding, cutting, or metal fabrication?',
        weight: 0.2,
        required: false
      },
      {
        id: 'shows_panel_work',
        question: 'Does this image show panel removal, replacement, or alignment?',
        weight: 0.15,
        required: false
      },
      {
        id: 'in_shop_environment',
        question: 'Is this image taken inside a body shop, paint booth, or garage work area?',
        weight: 0.1,
        required: false
      }
    ]
  },

  mechanic: {
    serviceType: 'mechanic',
    displayName: 'Mechanic / Garage',
    description: 'Engine work, mechanical repairs, diagnostics',
    minimumScore: 0.6,
    questions: [
      {
        id: 'shows_engine_work',
        question: 'Does this image show engine, transmission, or drivetrain components?',
        weight: 0.3,
        required: false
      },
      {
        id: 'shows_tools_equipment',
        question: 'Does this image show mechanical tools, lifts, or diagnostic equipment?',
        weight: 0.2,
        required: false
      },
      {
        id: 'shows_repairs',
        question: 'Does this image show active repair work or disassembled components?',
        weight: 0.25,
        required: false
      },
      {
        id: 'shows_fluid_work',
        question: 'Does this image show fluid changes, leaks, or fluid-related work?',
        weight: 0.15,
        required: false
      },
      {
        id: 'in_garage',
        question: 'Is this image taken inside a garage or on a lift?',
        weight: 0.1,
        required: false
      }
    ]
  },

  upholstery: {
    serviceType: 'upholstery',
    displayName: 'Upholstery Shop',
    description: 'Seat work, headliner, carpet, trim',
    minimumScore: 0.6,
    questions: [
      {
        id: 'shows_interior_fabric',
        question: 'Does this image show seats, fabric, leather, or interior materials?',
        weight: 0.3,
        required: false
      },
      {
        id: 'shows_sewing_cutting',
        question: 'Does this image show sewing, cutting patterns, or stitching work?',
        weight: 0.25,
        required: false
      },
      {
        id: 'shows_interior_removal',
        question: 'Does this image show interior trim removal or seat removal?',
        weight: 0.2,
        required: false
      },
      {
        id: 'shows_headliner_carpet',
        question: 'Does this image show headliner, carpet, or door panel work?',
        weight: 0.15,
        required: false
      },
      {
        id: 'in_upholstery_shop',
        question: 'Is this image taken in an upholstery shop environment?',
        weight: 0.1,
        required: false
      }
    ]
  },

  paint_shop: {
    serviceType: 'paint_shop',
    displayName: 'Paint Shop',
    description: 'Paint, clear coat, color matching',
    minimumScore: 0.7,
    questions: [
      {
        id: 'shows_paint_work',
        question: 'Does this image show paint application, wet paint, or spray guns?',
        weight: 0.35,
        required: false
      },
      {
        id: 'in_paint_booth',
        question: 'Is this image taken inside a paint booth or spray area?',
        weight: 0.25,
        required: false
      },
      {
        id: 'shows_prep_work',
        question: 'Does this image show sanding, primer, or masking for paint?',
        weight: 0.2,
        required: false
      },
      {
        id: 'shows_color_matching',
        question: 'Does this image show color mixing, matching, or paint materials?',
        weight: 0.1,
        required: false
      },
      {
        id: 'shows_finished_paint',
        question: 'Does this image show freshly painted surface with clear coat?',
        weight: 0.1,
        required: false
      }
    ]
  },

  restoration: {
    serviceType: 'restoration',
    displayName: 'Restoration Shop',
    description: 'Full vehicle restoration, classic cars',
    minimumScore: 0.5,
    questions: [
      {
        id: 'shows_classic_vehicle',
        question: 'Does this image show a classic or vintage vehicle (pre-1990)?',
        weight: 0.2,
        required: false
      },
      {
        id: 'shows_disassembly',
        question: 'Does this image show significant vehicle disassembly?',
        weight: 0.2,
        required: false
      },
      {
        id: 'shows_rebuild_progress',
        question: 'Does this image show rebuild or restoration in progress?',
        weight: 0.25,
        required: false
      },
      {
        id: 'shows_part_refurbish',
        question: 'Does this image show parts being cleaned, rebuilt, or refinished?',
        weight: 0.2,
        required: false
      },
      {
        id: 'shows_documentation',
        question: 'Does this image document condition or progress for records?',
        weight: 0.15,
        required: false
      }
    ]
  },

  performance: {
    serviceType: 'performance',
    displayName: 'Performance Shop',
    description: 'Upgrades, tuning, racing modifications',
    minimumScore: 0.6,
    questions: [
      {
        id: 'shows_performance_parts',
        question: 'Does this image show performance parts (intake, exhaust, turbo, etc)?',
        weight: 0.3,
        required: false
      },
      {
        id: 'shows_dyno_tuning',
        question: 'Does this image show dyno testing or ECU tuning?',
        weight: 0.25,
        required: false
      },
      {
        id: 'shows_suspension_brakes',
        question: 'Does this image show suspension, brake, or handling upgrades?',
        weight: 0.2,
        required: false
      },
      {
        id: 'shows_racing_equipment',
        question: 'Does this image show racing equipment (roll cage, harness, etc)?',
        weight: 0.15,
        required: false
      },
      {
        id: 'shows_installation',
        question: 'Does this image show active installation of performance parts?',
        weight: 0.1,
        required: false
      }
    ]
  },

  detailing: {
    serviceType: 'detailing',
    displayName: 'Detailing',
    description: 'Cleaning, polishing, protection',
    minimumScore: 0.6,
    questions: [
      {
        id: 'shows_cleaning',
        question: 'Does this image show washing, cleaning, or decontamination?',
        weight: 0.25,
        required: false
      },
      {
        id: 'shows_polishing',
        question: 'Does this image show paint correction, buffing, or polishing?',
        weight: 0.25,
        required: false
      },
      {
        id: 'shows_protection',
        question: 'Does this image show wax, sealant, ceramic coating, or PPF?',
        weight: 0.2,
        required: false
      },
      {
        id: 'shows_interior_detail',
        question: 'Does this image show interior cleaning or conditioning?',
        weight: 0.2,
        required: false
      },
      {
        id: 'shows_detail_products',
        question: 'Does this image show detailing products or equipment?',
        weight: 0.1,
        required: false
      }
    ]
  },

  general: {
    serviceType: 'general',
    displayName: 'General Service',
    description: 'General automotive work',
    minimumScore: 0.3,
    questions: [
      {
        id: 'shows_vehicle',
        question: 'Does this image show a vehicle or vehicle parts?',
        weight: 0.4,
        required: true
      },
      {
        id: 'shows_work',
        question: 'Does this image show work being performed?',
        weight: 0.3,
        required: false
      },
      {
        id: 'in_shop',
        question: 'Is this image taken in a shop or work environment?',
        weight: 0.3,
        required: false
      }
    ]
  }
};

/**
 * Get the filter for a specific service type
 */
export function getServiceTypeFilter(type: ServiceType): ServiceTypeFilter {
  return SERVICE_TYPE_FILTERS[type] || SERVICE_TYPE_FILTERS.general;
}

/**
 * Build AI prompt for filtering images
 */
export function buildImageFilterPrompt(
  serviceType: ServiceType,
  imageUrl: string
): string {
  const filter = getServiceTypeFilter(serviceType);
  
  const questionsText = filter.questions
    .map((q, i) => `${i + 1}. ${q.question}`)
    .join('\n');

  return `You are analyzing an image for relevance to a ${filter.displayName} (${filter.description}).

Analyze this image and answer each question with true or false:

${questionsText}

Return ONLY a JSON object with the question IDs as keys and boolean values:
{
${filter.questions.map(q => `  "${q.id}": true|false`).join(',\n')}
}

Be strict - only answer true if the image CLEARLY shows what the question asks.
Random photos, outdoor scenes, or unrelated content should get false for all questions.`;
}

/**
 * Calculate relevance score from AI answers
 */
export function calculateRelevanceScore(
  serviceType: ServiceType,
  answers: Record<string, boolean>
): { score: number; relevant: boolean; reasons: string[] } {
  const filter = getServiceTypeFilter(serviceType);
  
  let weightedSum = 0;
  let totalWeight = 0;
  const reasons: string[] = [];

  for (const question of filter.questions) {
    const answer = answers[question.id];
    
    // If required question is false, image is not relevant
    if (question.required && answer === false) {
      return { score: 0, relevant: false, reasons: [`Required: ${question.question}`] };
    }

    if (answer === true) {
      weightedSum += question.weight;
      reasons.push(question.question.replace('Does this image show ', '').replace('?', ''));
    }
    totalWeight += question.weight;
  }

  const score = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const relevant = score >= filter.minimumScore;

  return { score, relevant, reasons };
}

/**
 * Map business_type to ServiceType
 */
export function businessTypeToServiceType(businessType: string | null): ServiceType {
  if (!businessType) return 'general';
  
  const typeMap: Record<string, ServiceType> = {
    'body_shop': 'body_shop',
    'garage': 'mechanic',
    'mechanic': 'mechanic',
    'upholstery_shop': 'upholstery',
    'upholstery': 'upholstery',
    'paint_shop': 'paint_shop',
    'restoration_shop': 'restoration',
    'restoration': 'restoration',
    'performance_shop': 'performance',
    'performance': 'performance',
    'detailing': 'detailing',
    'detail_shop': 'detailing'
  };

  return typeMap[businessType.toLowerCase()] || 'general';
}

export default {
  SERVICE_TYPE_FILTERS,
  getServiceTypeFilter,
  buildImageFilterPrompt,
  calculateRelevanceScore,
  businessTypeToServiceType
};

