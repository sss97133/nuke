/**
 * Vehicle Field Confidence Scoring Utility
 * 
 * Calculates confidence scores for vehicle fields based on:
 * - User-provided data vs computed data
 * - Image evidence (title, VIN, speedometer, exterior angles, engine bay)
 * - Field completeness
 */

export interface ImageEvidence {
  labels: string[];
  areas: string[];
  sensitiveTypes: string[];
}

export interface FieldSource {
  field_name: string;
  field_value: string;
  source_type: string;
  user_id?: string;
}

export interface ScoringResult {
  score: number;
  met: string[];
  next: string[];
}

/**
 * Analyze image evidence for field validation
 */
export function analyzeImageEvidence(images: Array<{ labels?: string[]; area?: string; sensitive_type?: string }>): ImageEvidence {
  const labelsList = images.flatMap((r) => Array.isArray(r.labels) ? r.labels : []);
  const areaList = images.map((r) => r.area).filter(Boolean);
  const sensitiveTypes = images.map((r) => r.sensitive_type).filter(Boolean);

  return {
    labels: labelsList,
    areas: areaList,
    sensitiveTypes
  };
}

/**
 * Calculate confidence score for a specific vehicle field
 */
export function calculateFieldScore(
  fieldName: string,
  sources: FieldSource[],
  imageEvidence: ImageEvidence
): ScoringResult {
  const entry = sources.find((s) => s.field_name === fieldName);
  const userProvided = !!entry?.user_id || entry?.source_type === 'human_input';
  const valuePresent = !!entry?.field_value;

  const { labels, areas, sensitiveTypes } = imageEvidence;
  const hasTitle = sensitiveTypes.some((t) => t === 'title') || labels.includes('paperwork');
  const hasVinImg = labels.includes('vin') || areas.includes('dash');
  const hasExteriorSet = labels.filter((l) => l === 'exterior').length;
  const hasSpeedo = labels.includes('speedometer') || areas.includes('dash');
  const hasEngineImgs = areas.includes('engine_bay');

  let score = 0;
  const met: string[] = [];
  const next: string[] = [];

  const boost = (pts: number, why: string) => {
    score += pts;
    met.push(why);
  };

  const want = (why: string) => {
    next.push(why);
  };

  switch (fieldName) {
    case 'make':
    case 'model':
    case 'year':
    case 'vin': {
      if (userProvided) {
        boost(90, 'Provided by signed-in user');
      } else if (valuePresent) {
        boost(70, 'Provided');
      }
      if (hasTitle || hasVinImg) {
        boost(10, 'Paperwork/VIN image evidence');
      } else {
        want('Add title or VIN/frame-stamp image');
      }
      break;
    }
    case 'color': {
      if (valuePresent) {
        boost(40, 'Color provided');
      } else {
        want('Provide color');
      }
      const extScore = Math.min(60, hasExteriorSet * 8);
      if (extScore > 0) {
        boost(extScore, `Exterior coverage (${hasExteriorSet} angles)`);
      } else {
        want('Add exterior images from multiple angles');
      }
      break;
    }
    case 'mileage': {
      if (valuePresent) {
        boost(50, 'Mileage provided');
      } else {
        want('Enter mileage');
      }
      if (hasSpeedo) {
        boost(50, 'Speedometer image evidence');
      } else {
        want('Add speedometer photo');
      }
      break;
    }
    case 'engine': {
      if (valuePresent) {
        boost(50, 'Engine info provided');
      } else {
        want('Enter engine details');
      }
      if (hasEngineImgs) {
        boost(50, 'Engine bay images');
      } else {
        want('Add engine bay photos');
      }
      break;
    }
    case 'body_style':
    case 'doors':
    case 'seats': {
      if (valuePresent) {
        boost(100, 'Field complete');
      } else {
        want('Fill this field');
      }
      break;
    }
    case 'transmission': {
      if (valuePresent) {
        boost(80, 'Provided');
      } else {
        want('Provide transmission');
      }
      break;
    }
    default: {
      if (valuePresent) {
        boost(60, 'Provided');
      } else {
        want('Provide this data');
      }
    }
  }

  score = Math.max(0, Math.min(100, score));

  return { score, met, next };
}

/**
 * Calculate scores for multiple fields at once
 */
export function calculateFieldScores(
  fields: string[],
  sources: FieldSource[],
  images: Array<{ labels?: string[]; area?: string; sensitive_type?: string }>
): Map<string, ScoringResult> {
  const imageEvidence = analyzeImageEvidence(images);
  const results = new Map<string, ScoringResult>();

  for (const fieldName of fields) {
    results.set(fieldName, calculateFieldScore(fieldName, sources, imageEvidence));
  }

  return results;
}

