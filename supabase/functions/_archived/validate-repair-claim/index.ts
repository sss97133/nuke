import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ValidationRequest {
  timeline_event_id: string;
  vehicle_id: string;
  validator_user_id: string;
  validation_type: 'expert' | 'community' | 'owner';
  confidence_score: number;
  validation_notes?: string;
  expert_credentials?: {
    certification_type: string;
    certification_number?: string;
    years_experience: number;
    specialization: string[];
  };
}

interface ValidationResult {
  validation_id: string;
  overall_confidence: number;
  validation_breakdown: {
    title_verified: number;
    expert_certified: number;
    community_consensus: number;
    owner_claim: number;
    ai_detection: number;
  };
  recommendations: string[];
  next_actions: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    )

    const validationRequest: ValidationRequest = await req.json()

    // Get timeline event details
    const { data: timelineEvent, error: eventError } = await supabase
      .from('timeline_events')
      .select(`
        *,
        vehicle:vehicles!timeline_events_vehicle_id_fkey(
          year, make, model, vin, verification_status
        )
      `)
      .eq('id', validationRequest.timeline_event_id)
      .single()

    if (eventError || !timelineEvent) {
      throw new Error('Timeline event not found')
    }

    // Get existing validations for this event
    const { data: existingValidations } = await supabase
      .from('repair_validations')
      .select('*')
      .eq('timeline_event_id', validationRequest.timeline_event_id)

    // Calculate validation scores
    const validationScores = calculateValidationScores(
      validationRequest,
      existingValidations || [],
      timelineEvent
    )

    // Store new validation
    const { data: newValidation, error: validationError } = await supabase
      .from('repair_validations')
      .insert({
        timeline_event_id: validationRequest.timeline_event_id,
        vehicle_id: validationRequest.vehicle_id,
        validator_user_id: validationRequest.validator_user_id,
        validation_type: validationRequest.validation_type,
        confidence_score: validationRequest.confidence_score,
        validation_notes: validationRequest.validation_notes,
        expert_credentials: validationRequest.expert_credentials,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (validationError) {
      throw new Error('Failed to store validation')
    }

    // Update timeline event confidence
    await updateTimelineEventConfidence(
      supabase,
      validationRequest.timeline_event_id,
      validationScores.overall_confidence
    )

    // Generate recommendations
    const recommendations = generateRecommendations(validationScores, timelineEvent)

    // Check for training opportunities
    const trainingOpportunities = await identifyTrainingOpportunities(
      supabase,
      validationRequest.vehicle_id,
      validationScores
    )

    const result: ValidationResult = {
      validation_id: newValidation.id,
      overall_confidence: validationScores.overall_confidence,
      validation_breakdown: validationScores.breakdown,
      recommendations: recommendations,
      next_actions: trainingOpportunities
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Validation error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function calculateValidationScores(
  request: ValidationRequest,
  existingValidations: any[],
  timelineEvent: any
) {
  // Base confidence levels
  const confidenceLevels = {
    title_verified: 100,
    expert_certified: 95,
    community_consensus: 85,
    owner_claim: 60,
    ai_detection: 40
  }

  let breakdown = {
    title_verified: 0,
    expert_certified: 0,
    community_consensus: 0,
    owner_claim: 0,
    ai_detection: 40 // Base AI detection score
  }

  // Check vehicle verification status
  if (timelineEvent.vehicle?.verification_status === 'title_verified') {
    breakdown.title_verified = confidenceLevels.title_verified
  }

  // Process existing validations
  const expertValidations = existingValidations.filter(v => v.validation_type === 'expert')
  const communityValidations = existingValidations.filter(v => v.validation_type === 'community')
  const ownerValidations = existingValidations.filter(v => v.validation_type === 'owner')

  // Expert validation scoring
  if (expertValidations.length > 0) {
    const avgExpertScore = expertValidations.reduce((sum, v) => sum + v.confidence_score, 0) / expertValidations.length
    const expertCredibilityMultiplier = calculateExpertCredibility(expertValidations)
    breakdown.expert_certified = Math.min(avgExpertScore * expertCredibilityMultiplier, confidenceLevels.expert_certified)
  }

  // Add current validation
  if (request.validation_type === 'expert') {
    const credibilityMultiplier = calculateExpertCredibility([{ expert_credentials: request.expert_credentials }])
    const expertScore = Math.min(request.confidence_score * credibilityMultiplier, confidenceLevels.expert_certified)
    breakdown.expert_certified = Math.max(breakdown.expert_certified, expertScore)
  }

  // Community consensus (need at least 3 validations)
  if (communityValidations.length >= 3) {
    const avgCommunityScore = communityValidations.reduce((sum, v) => sum + v.confidence_score, 0) / communityValidations.length
    const consensusStrength = Math.min(communityValidations.length / 5.0, 1.0) // Stronger with more validations
    breakdown.community_consensus = avgCommunityScore * consensusStrength
  }

  // Owner validation
  if (ownerValidations.length > 0 || request.validation_type === 'owner') {
    breakdown.owner_claim = confidenceLevels.owner_claim
  }

  // Calculate overall confidence (weighted average)
  const weights = {
    title_verified: 0.4,
    expert_certified: 0.3,
    community_consensus: 0.2,
    owner_claim: 0.05,
    ai_detection: 0.05
  }

  let overall_confidence = 0
  for (const [key, score] of Object.entries(breakdown)) {
    overall_confidence += score * weights[key as keyof typeof weights]
  }

  return {
    overall_confidence: Math.round(overall_confidence),
    breakdown
  }
}

function calculateExpertCredibility(expertValidations: any[]): number {
  if (expertValidations.length === 0) return 1.0

  let totalCredibility = 0
  let count = 0

  for (const validation of expertValidations) {
    const creds = validation.expert_credentials
    if (!creds) continue

    let credibility = 0.5 // Base credibility

    // Certification type bonuses
    const certificationBonuses = {
      'ASE Master Technician': 0.4,
      'ASE Certified': 0.3,
      'Factory Certified': 0.35,
      'Certified Appraiser': 0.3,
      'Master Mechanic': 0.25
    }

    credibility += certificationBonuses[creds.certification_type] || 0.1

    // Experience bonus (up to 0.2)
    const experienceBonus = Math.min(creds.years_experience / 50.0, 0.2)
    credibility += experienceBonus

    // Specialization bonus
    if (creds.specialization && creds.specialization.length > 0) {
      credibility += 0.1
    }

    totalCredibility += Math.min(credibility, 1.0)
    count++
  }

  return count > 0 ? totalCredibility / count : 1.0
}

function generateRecommendations(validationScores: any, timelineEvent: any): string[] {
  const recommendations: string[] = []
  const confidence = validationScores.overall_confidence

  if (confidence < 70) {
    recommendations.push("Seek additional expert validation to increase confidence")
    recommendations.push("Add more detailed photos of the repair work")
    recommendations.push("Include repair receipts or documentation")
  }

  if (validationScores.breakdown.expert_certified === 0) {
    recommendations.push("Consider getting professional mechanic validation")
  }

  if (validationScores.breakdown.community_consensus < 50) {
    recommendations.push("Share with community for peer validation")
  }

  if (!timelineEvent.cost || timelineEvent.cost === 0) {
    recommendations.push("Add repair cost information for value impact analysis")
  }

  if (!timelineEvent.image_urls || timelineEvent.image_urls.length === 0) {
    recommendations.push("Add before/after photos to enable AI analysis")
  }

  return recommendations
}

async function identifyTrainingOpportunities(
  supabase: any,
  vehicleId: string,
  validationScores: any
): Promise<string[]> {
  const opportunities: string[] = []

  // High-confidence events are good training data
  if (validationScores.overall_confidence > 85) {
    opportunities.push("Add to vehicle-specific AI training dataset")
    opportunities.push("Use as reference example for similar repairs")
  }

  // Check if this creates a learning pattern
  const { data: similarEvents } = await supabase
    .from('timeline_events')
    .select('id, category, event_type')
    .eq('vehicle_id', vehicleId)
    .eq('category', 'repair') // Assuming we're validating a repair

  if (similarEvents && similarEvents.length >= 3) {
    opportunities.push("Sufficient data for repair pattern analysis")
    opportunities.push("Enable predictive maintenance recommendations")
  }

  return opportunities
}

async function updateTimelineEventConfidence(
  supabase: any,
  eventId: string,
  confidence: number
) {
  await supabase
    .from('timeline_events')
    .update({
      confidence_score: confidence,
      updated_at: new Date().toISOString()
    })
    .eq('id', eventId)
}