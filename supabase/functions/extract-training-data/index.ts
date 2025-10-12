import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TrainingDataRequest {
  vehicle_id?: string;
  limit?: number;
  include_corrections?: boolean;
  include_rejections?: boolean;
  min_confidence?: number;
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

    const {
      vehicle_id,
      limit = 1000,
      include_corrections = true,
      include_rejections = true,
      min_confidence = 60
    }: TrainingDataRequest = await req.json()

    console.log(`🧠 Extracting training data for vehicle: ${vehicle_id || 'all'}`);

    // Get high-value training examples
    const trainingData = await extractTrainingExamples(
      supabase,
      vehicle_id,
      limit,
      include_corrections,
      include_rejections,
      min_confidence
    );

    // Generate training insights
    const insights = generateTrainingInsights(trainingData);

    // Create training dataset export
    const exportData = formatForTraining(trainingData);

    return new Response(
      JSON.stringify({
        success: true,
        training_examples: trainingData.length,
        insights: insights,
        export_data: exportData,
        extracted_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Training data extraction error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function extractTrainingExamples(
  supabase: any,
  vehicleId?: string,
  limit: number = 1000,
  includeCorrections: boolean = true,
  includeRejections: boolean = true,
  minConfidence: number = 60
) {
  const conditions = []
  let query = supabase
    .from('tag_analysis_view')
    .select(`
      id,
      vehicle_id,
      image_url,
      tag_name,
      tag_type,
      source_type,
      confidence,
      automated_confidence,
      verified,
      validation_status,
      x_position,
      y_position,
      width,
      height,
      ai_detection_data,
      training_feedback,
      parent_tag_id,
      tag_origin_type,
      reliability_score
    `)

  // Filter by vehicle if specified
  if (vehicleId) {
    query = query.eq('vehicle_id', vehicleId)
  }

  // Include different types of training examples
  const statusConditions = []

  // Always include verified AI tags
  statusConditions.push("(source_type = 'ai' AND verified = true)")

  // Include manual tags
  statusConditions.push("(source_type = 'manual')")

  // Include corrections if requested
  if (includeCorrections) {
    statusConditions.push("(manual_override = true)")
    statusConditions.push("(parent_tag_id IS NOT NULL)")
  }

  // Include rejections if requested
  if (includeRejections) {
    statusConditions.push("(validation_status = 'rejected')")
  }

  // Apply confidence filter for AI tags
  query = query.or(statusConditions.join(','))

  const { data, error } = await query
    .order('reliability_score', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Database query error: ${error.message}`)
  }

  return data || []
}

function generateTrainingInsights(trainingData: any[]) {
  const insights = {
    total_examples: trainingData.length,
    by_source_type: {} as any,
    by_tag_type: {} as any,
    by_validation_status: {} as any,
    confidence_distribution: {
      high: 0,    // 90-100%
      medium: 0,  // 70-89%
      low: 0      // Below 70%
    },
    training_value_score: 0,
    recommendations: [] as string[]
  }

  // Analyze distribution
  trainingData.forEach(example => {
    // Source type distribution
    insights.by_source_type[example.source_type] = (insights.by_source_type[example.source_type] || 0) + 1

    // Tag type distribution
    insights.by_tag_type[example.tag_type] = (insights.by_tag_type[example.tag_type] || 0) + 1

    // Validation status distribution
    insights.by_validation_status[example.validation_status] = (insights.by_validation_status[example.validation_status] || 0) + 1

    // Confidence distribution
    if (example.reliability_score >= 90) {
      insights.confidence_distribution.high++
    } else if (example.reliability_score >= 70) {
      insights.confidence_distribution.medium++
    } else {
      insights.confidence_distribution.low++
    }

    // Add to training value score
    insights.training_value_score += example.reliability_score
  })

  // Calculate average training value
  insights.training_value_score = Math.round(insights.training_value_score / trainingData.length)

  // Generate recommendations
  if (insights.confidence_distribution.high / trainingData.length > 0.6) {
    insights.recommendations.push("Excellent dataset quality - ready for advanced model training")
  }

  if (insights.by_source_type['manual'] && insights.by_source_type['ai']) {
    const ratio = insights.by_source_type['ai'] / insights.by_source_type['manual']
    if (ratio > 3) {
      insights.recommendations.push("Consider adding more manual validation to balance AI/human examples")
    }
  }

  const correctionCount = trainingData.filter(d => d.parent_tag_id).length
  if (correctionCount > 10) {
    insights.recommendations.push(`${correctionCount} human corrections provide excellent learning signal`)
  }

  const rejectionCount = insights.by_validation_status['rejected'] || 0
  if (rejectionCount > 5) {
    insights.recommendations.push(`${rejectionCount} rejection examples help avoid false positives`)
  }

  return insights
}

function formatForTraining(trainingData: any[]) {
  return trainingData.map(example => ({
    // Image information
    image_url: example.image_url,
    vehicle_id: example.vehicle_id,

    // Tag information
    label: example.tag_name,
    category: example.tag_type,

    // Bounding box (normalized 0-100 to 0-1)
    bbox: {
      x: example.x_position / 100,
      y: example.y_position / 100,
      width: example.width / 100,
      height: example.height / 100
    },

    // Training metadata
    ground_truth_source: example.source_type,
    confidence: example.confidence,
    verified: example.verified,
    validation_status: example.validation_status,
    training_weight: calculateTrainingWeight(example),

    // AI detection context
    ai_prediction: example.ai_detection_data ? {
      original_confidence: example.automated_confidence,
      rekognition_label: example.ai_detection_data.rekognition_label,
      model_version: example.ai_detection_data.model_version
    } : null,

    // Human validation context
    human_feedback: {
      is_correction: !!example.parent_tag_id,
      is_rejection: example.validation_status === 'rejected',
      is_manual_creation: example.source_type === 'manual',
      reliability_score: example.reliability_score
    }
  }))
}

function calculateTrainingWeight(example: any): number {
  let weight = 1.0

  // Boost weight for human corrections (these are gold standard)
  if (example.parent_tag_id) {
    weight *= 2.0
  }

  // Boost weight for expert validations
  if (example.source_type === 'expert') {
    weight *= 1.5
  }

  // Boost weight for verified AI predictions (positive reinforcement)
  if (example.source_type === 'ai' && example.verified) {
    weight *= 1.3
  }

  // Boost weight for rejections (negative examples are valuable)
  if (example.validation_status === 'rejected') {
    weight *= 1.2
  }

  // Reduce weight for low-confidence examples
  if (example.reliability_score < 70) {
    weight *= 0.8
  }

  return Math.round(weight * 100) / 100
}