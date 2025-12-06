/**
 * Work Session Analyzer
 * 
 * Understands WHY a user documented a session
 * Each bundle of images tells a story - we need to read it
 * 
 * Session Types:
 * - inspection: Routine check, condition documentation
 * - work_start: Beginning of a job, before state
 * - work_progress: Mid-job documentation
 * - work_complete: Job finished, after state
 * - delivery: Handoff to owner
 * - problem_report: Issue documentation
 * - parts_inventory: Parts/materials documentation
 */

export type SessionPurpose = 
  | 'inspection'           // Routine check, condition update
  | 'intake'               // Vehicle arrival, initial state
  | 'work_start'           // Beginning a specific job
  | 'work_progress'        // Mid-work documentation
  | 'work_complete'        // Job finished
  | 'quality_check'        // Verification before delivery
  | 'delivery'             // Handoff to owner
  | 'problem_report'       // Issue/damage documentation
  | 'parts_inventory'      // Parts/materials logging
  | 'comparison'           // Before/after comparison set
  | 'unknown';

export interface SessionSignature {
  purpose: SessionPurpose;
  confidence: number;
  indicators: string[];
  continuityLink?: {
    previousSessionId?: string;
    daysGap?: number;
    expectedChanges?: string[];
  };
}

export interface ImagePattern {
  id: string;
  pattern: string;
  description: string;
  suggestsPurpose: SessionPurpose[];
  weight: number;
}

/**
 * Patterns that help identify session purpose
 */
export const SESSION_PATTERNS: ImagePattern[] = [
  // INSPECTION patterns
  {
    id: 'full_walkaround',
    pattern: 'Multiple angles covering all sides of vehicle exterior',
    description: 'Complete exterior documentation suggests inspection',
    suggestsPurpose: ['inspection', 'intake', 'delivery'],
    weight: 0.3
  },
  {
    id: 'consistent_distance',
    pattern: 'Images taken from similar distances, systematic',
    description: 'Systematic documentation suggests routine check',
    suggestsPurpose: ['inspection', 'quality_check'],
    weight: 0.2
  },
  {
    id: 'no_work_visible',
    pattern: 'Vehicle appears complete, no disassembly, no tools',
    description: 'No active work visible',
    suggestsPurpose: ['inspection', 'intake', 'delivery'],
    weight: 0.2
  },

  // WORK IN PROGRESS patterns
  {
    id: 'partial_disassembly',
    pattern: 'Components removed, exposed areas, in-progress state',
    description: 'Disassembly indicates active work',
    suggestsPurpose: ['work_start', 'work_progress'],
    weight: 0.4
  },
  {
    id: 'tools_visible',
    pattern: 'Tools, equipment, or work materials in frame',
    description: 'Active work environment',
    suggestsPurpose: ['work_progress'],
    weight: 0.3
  },
  {
    id: 'close_up_detail',
    pattern: 'Extreme close-ups of specific components/areas',
    description: 'Focus on specific work area',
    suggestsPurpose: ['work_progress', 'problem_report', 'quality_check'],
    weight: 0.2
  },

  // COMPLETION patterns
  {
    id: 'fresh_paint_finish',
    pattern: 'Freshly painted surfaces, wet look, booth environment',
    description: 'Fresh paint indicates job near completion',
    suggestsPurpose: ['work_complete', 'quality_check'],
    weight: 0.4
  },
  {
    id: 'reassembly_complete',
    pattern: 'Previously removed parts now installed',
    description: 'Reassembly complete',
    suggestsPurpose: ['work_complete'],
    weight: 0.35
  },
  {
    id: 'clean_environment',
    pattern: 'Clean floor, organized area, presentation setup',
    description: 'Prepared for delivery/viewing',
    suggestsPurpose: ['delivery', 'quality_check'],
    weight: 0.25
  },

  // PROBLEM patterns
  {
    id: 'damage_focus',
    pattern: 'Images focused on damage, rust, issues',
    description: 'Problem documentation',
    suggestsPurpose: ['problem_report', 'intake'],
    weight: 0.4
  },
  {
    id: 'measurement_reference',
    pattern: 'Ruler, tape measure, or reference objects in frame',
    description: 'Measuring damage or fitment',
    suggestsPurpose: ['problem_report', 'quality_check'],
    weight: 0.2
  },

  // PARTS patterns
  {
    id: 'parts_laid_out',
    pattern: 'Parts arranged on bench/floor, labeled or organized',
    description: 'Parts inventory or organization',
    suggestsPurpose: ['parts_inventory', 'work_start'],
    weight: 0.4
  },
  {
    id: 'packaging_boxes',
    pattern: 'New parts in packaging, shipping boxes',
    description: 'Parts arrival documentation',
    suggestsPurpose: ['parts_inventory'],
    weight: 0.3
  }
];

/**
 * Questions to determine session purpose
 * These are scalable binary questions for AI
 */
export interface SessionPurposeQuestion {
  id: string;
  question: string;
  indicatesPurpose: SessionPurpose[];
  weight: number;
}

export const SESSION_PURPOSE_QUESTIONS: SessionPurposeQuestion[] = [
  // Inspection indicators
  {
    id: 'is_walkaround',
    question: 'Do the images show a complete walkaround of the vehicle from multiple angles?',
    indicatesPurpose: ['inspection', 'intake', 'delivery'],
    weight: 0.25
  },
  {
    id: 'vehicle_complete',
    question: 'Does the vehicle appear fully assembled with no parts removed?',
    indicatesPurpose: ['inspection', 'delivery', 'quality_check'],
    weight: 0.2
  },
  {
    id: 'condition_focus',
    question: 'Do the images appear to document overall condition rather than specific work?',
    indicatesPurpose: ['inspection', 'intake'],
    weight: 0.2
  },

  // Work indicators
  {
    id: 'active_work',
    question: 'Are there signs of active work in progress (tools, disassembly, protective covering)?',
    indicatesPurpose: ['work_progress', 'work_start'],
    weight: 0.3
  },
  {
    id: 'work_environment',
    question: 'Are the images taken in a work environment (shop floor, lift, booth)?',
    indicatesPurpose: ['work_progress', 'work_start', 'work_complete'],
    weight: 0.15
  },
  {
    id: 'before_state',
    question: 'Do the images show a "before" state with visible issues to be addressed?',
    indicatesPurpose: ['work_start', 'intake', 'problem_report'],
    weight: 0.25
  },
  {
    id: 'after_state',
    question: 'Do the images show a clearly improved or repaired "after" state?',
    indicatesPurpose: ['work_complete', 'quality_check'],
    weight: 0.25
  },

  // Specific purpose indicators
  {
    id: 'fresh_paint',
    question: 'Is there freshly applied paint, primer, or clear coat visible?',
    indicatesPurpose: ['work_complete', 'work_progress'],
    weight: 0.3
  },
  {
    id: 'damage_documentation',
    question: 'Are the images specifically documenting damage, rust, or problems?',
    indicatesPurpose: ['problem_report', 'intake'],
    weight: 0.3
  },
  {
    id: 'parts_focus',
    question: 'Are the images focused on parts, materials, or components (not the whole vehicle)?',
    indicatesPurpose: ['parts_inventory', 'work_progress'],
    weight: 0.25
  },

  // Delivery/handoff indicators
  {
    id: 'presentation_setup',
    question: 'Does the vehicle appear cleaned and staged for presentation or delivery?',
    indicatesPurpose: ['delivery', 'quality_check'],
    weight: 0.3
  },
  {
    id: 'outdoor_final',
    question: 'Are these outdoor photos of a completed, clean vehicle?',
    indicatesPurpose: ['delivery'],
    weight: 0.25
  }
];

/**
 * Build prompt to analyze session purpose
 */
export function buildSessionPurposePrompt(imageCount: number, timeSpan: string): string {
  const questions = SESSION_PURPOSE_QUESTIONS
    .map((q, i) => `${i + 1}. ${q.question}`)
    .join('\n');

  return `Analyze this batch of ${imageCount} images taken over ${timeSpan} to determine the PURPOSE of this documentation session.

Answer each question with true or false based on the overall session (not individual images):

${questions}

Also provide:
- primary_purpose: The main reason for this session (one of: inspection, intake, work_start, work_progress, work_complete, quality_check, delivery, problem_report, parts_inventory, comparison)
- secondary_purpose: Optional secondary purpose if applicable
- confidence: 0-100 how confident you are
- session_summary: One sentence describing what this session documents

Return as JSON:
{
${SESSION_PURPOSE_QUESTIONS.map(q => `  "${q.id}": true|false`).join(',\n')},
  "primary_purpose": "string",
  "secondary_purpose": "string|null",
  "confidence": number,
  "session_summary": "string"
}`;
}

/**
 * Analyze continuity between sessions
 * Compare current session to previous to detect changes
 */
export interface ContinuityAnalysis {
  daysGap: number;
  expectedChanges: string[];
  detectedChanges: string[];
  unexpectedChanges: string[];
  continuityScore: number; // 0-1, how well this follows from previous
}

export function buildContinuityPrompt(
  currentSummary: string,
  previousSummary: string,
  previousDate: string,
  currentDate: string
): string {
  return `Compare these two documentation sessions for the same vehicle:

PREVIOUS SESSION (${previousDate}):
${previousSummary}

CURRENT SESSION (${currentDate}):
${currentSummary}

Analyze the continuity and changes:

1. What changes are visible between sessions?
2. Are these expected changes given the previous session's state?
3. Is there anything unexpected or concerning?
4. Does the current session logically follow from the previous?

For INSPECTION sessions specifically:
- Compare cleanliness/dirt level
- Note any new damage or wear
- Check if previous issues have been addressed

Return as JSON:
{
  "detected_changes": ["list of visible changes"],
  "expected_given_previous": true|false,
  "unexpected_findings": ["any concerning or unexpected changes"],
  "continuity_score": 0-100,
  "progression_summary": "One sentence describing the vehicle's progression"
}`;
}

/**
 * Calculate session purpose from AI answers
 */
export function calculateSessionPurpose(
  answers: Record<string, boolean>,
  aiPrimaryPurpose?: SessionPurpose
): SessionSignature {
  const purposeScores: Record<SessionPurpose, number> = {
    inspection: 0,
    intake: 0,
    work_start: 0,
    work_progress: 0,
    work_complete: 0,
    quality_check: 0,
    delivery: 0,
    problem_report: 0,
    parts_inventory: 0,
    comparison: 0,
    unknown: 0
  };

  const indicators: string[] = [];

  for (const question of SESSION_PURPOSE_QUESTIONS) {
    if (answers[question.id] === true) {
      for (const purpose of question.indicatesPurpose) {
        purposeScores[purpose] += question.weight;
      }
      indicators.push(question.question);
    }
  }

  // Find highest scoring purpose
  let maxScore = 0;
  let detectedPurpose: SessionPurpose = 'unknown';
  
  for (const [purpose, score] of Object.entries(purposeScores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedPurpose = purpose as SessionPurpose;
    }
  }

  // Use AI's determination if confidence is higher
  const finalPurpose = aiPrimaryPurpose || detectedPurpose;

  return {
    purpose: finalPurpose,
    confidence: Math.min(maxScore, 1),
    indicators
  };
}

/**
 * Session types that indicate "routine" vs "active work"
 */
export const ROUTINE_SESSIONS: SessionPurpose[] = ['inspection', 'intake', 'delivery', 'quality_check'];
export const WORK_SESSIONS: SessionPurpose[] = ['work_start', 'work_progress', 'work_complete'];
export const DOCUMENTATION_SESSIONS: SessionPurpose[] = ['problem_report', 'parts_inventory', 'comparison'];

export function isRoutineSession(purpose: SessionPurpose): boolean {
  return ROUTINE_SESSIONS.includes(purpose);
}

export function isWorkSession(purpose: SessionPurpose): boolean {
  return WORK_SESSIONS.includes(purpose);
}

export default {
  SESSION_PATTERNS,
  SESSION_PURPOSE_QUESTIONS,
  buildSessionPurposePrompt,
  buildContinuityPrompt,
  calculateSessionPurpose,
  isRoutineSession,
  isWorkSession
};
