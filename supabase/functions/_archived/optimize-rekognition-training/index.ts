import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TrainingOptimizationRequest {
  vehicle_id?: string;
  system_focus?: string; // "braking", "engine", "body", etc.
  optimization_goal?: "accuracy" | "specificity" | "recall" | "automotive_focus";
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
      system_focus,
      optimization_goal = "automotive_focus"
    }: TrainingOptimizationRequest = await req.json()

    console.log(`🧠 Optimizing Rekognition training for ${vehicle_id || 'all vehicles'}`);
    console.log(`Focus: ${system_focus || 'general'}, Goal: ${optimization_goal}`);

    // Analyze current tag performance and identify optimization opportunities
    const analysis = await analyzeTagPerformance(supabase, vehicle_id, system_focus)

    // Generate training recommendations
    const recommendations = generateTrainingRecommendations(analysis, optimization_goal)

    // Create curated training datasets
    const curatedDatasets = await buildCuratedDatasets(supabase, vehicle_id, system_focus, recommendations)

    // Generate custom label mappings for automotive specificity
    const customMappings = generateAutomotiveSpecificMappings(analysis)

    return new Response(
      JSON.stringify({
        success: true,
        analysis: analysis,
        recommendations: recommendations,
        curated_datasets: curatedDatasets,
        custom_mappings: customMappings,
        optimization_summary: {
          current_accuracy: analysis.current_accuracy,
          projected_improvement: recommendations.projected_improvement,
          training_data_quality: analysis.training_data_quality,
          automotive_specificity: analysis.automotive_specificity
        },
        generated_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Training optimization error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function analyzeTagPerformance(supabase: any, vehicleId?: string, systemFocus?: string) {
  // Get all validated tags (human corrections, verifications, rejections)
  let query = supabase
    .from('image_tags')
    .select(`
      *,
      vehicle_images!inner(
        vehicle_id,
        image_url,
        area
      )
    `)
    .not('ai_detection_data', 'is', null)

  if (vehicleId) {
    query = query.eq('vehicle_images.vehicle_id', vehicleId)
  }

  const { data: tags, error } = await query

  if (error) throw error

  // Analyze performance metrics
  const performanceMetrics = {
    total_ai_tags: tags.length,
    verified_correct: tags.filter((t: any) => t.verified === true).length,
    human_corrected: tags.filter((t: any) => t.parent_tag_id !== null).length,
    rejected: tags.filter((t: any) => t.validation_status === 'rejected').length,
    low_confidence: tags.filter((t: any) => (t.automated_confidence || 0) < 70).length,

    // Automotive-specific analysis
    automotive_tags: tags.filter((t: any) => isAutomotiveTag(t.tag_name)).length,
    generic_tags: tags.filter((t: any) => isGenericTag(t.tag_name)).length,

    // System-specific breakdown
    system_distribution: analyzeSystemDistribution(tags),

    // Confidence distribution
    confidence_distribution: analyzeConfidenceDistribution(tags),

    // Common failure patterns
    failure_patterns: identifyFailurePatterns(tags)
  }

  // Calculate derived metrics
  const totalValidated = performanceMetrics.verified_correct + performanceMetrics.human_corrected + performanceMetrics.rejected
  const accuracyRate = totalValidated > 0 ? performanceMetrics.verified_correct / totalValidated : 0
  const correctionRate = totalValidated > 0 ? performanceMetrics.human_corrected / totalValidated : 0
  const rejectionRate = totalValidated > 0 ? performanceMetrics.rejected / totalValidated : 0

  return {
    ...performanceMetrics,
    current_accuracy: accuracyRate * 100,
    correction_rate: correctionRate * 100,
    rejection_rate: rejectionRate * 100,
    automotive_specificity: (performanceMetrics.automotive_tags / performanceMetrics.total_ai_tags) * 100,
    training_data_quality: calculateTrainingDataQuality(performanceMetrics),
    optimization_opportunities: identifyOptimizationOpportunities(performanceMetrics, systemFocus)
  }
}

function generateTrainingRecommendations(analysis: any, goal: string) {
  const recommendations = {
    priority_actions: [] as string[],
    dataset_improvements: [] as string[],
    custom_model_suggestions: [] as string[],
    label_refinements: [] as string[],
    projected_improvement: 0
  }

  // Priority actions based on current performance
  if (analysis.rejection_rate > 20) {
    recommendations.priority_actions.push("High rejection rate detected - focus on precision training")
    recommendations.projected_improvement += 15
  }

  if (analysis.automotive_specificity < 30) {
    recommendations.priority_actions.push("Low automotive specificity - build automotive-focused training set")
    recommendations.projected_improvement += 25
  }

  if (analysis.correction_rate > 15) {
    recommendations.priority_actions.push("High correction rate - use human corrections as high-value training examples")
    recommendations.projected_improvement += 20
  }

  // Dataset improvements
  if (analysis.system_distribution.braking < 5) {
    recommendations.dataset_improvements.push("Add more brake system images (discs, calipers, brake lines)")
  }

  if (analysis.system_distribution.powertrain < 10) {
    recommendations.dataset_improvements.push("Need engine bay, transmission, drivetrain images")
  }

  if (analysis.failure_patterns.rust_overdetection > 0.3) {
    recommendations.dataset_improvements.push("Add negative examples - clean metal surfaces without rust")
  }

  // Custom model suggestions based on goal
  switch (goal) {
    case "automotive_focus":
      recommendations.custom_model_suggestions.push("Train automotive-specific custom labels")
      recommendations.custom_model_suggestions.push("Create vehicle system hierarchy (powertrain → engine → component)")
      recommendations.custom_model_suggestions.push("Build condition assessment model (excellent → poor)")
      break

    case "accuracy":
      recommendations.custom_model_suggestions.push("Focus on high-confidence positive examples")
      recommendations.custom_model_suggestions.push("Add extensive negative example training")
      break

    case "specificity":
      recommendations.custom_model_suggestions.push("Replace generic tags with specific automotive terms")
      recommendations.custom_model_suggestions.push("Train fine-grained component recognition")
      break
  }

  // Label refinements
  const genericToSpecific = {
    "Machine": ["Engine", "Transmission", "Differential", "Brake System"],
    "Metal": ["Engine Block", "Brake Disc", "Frame Member", "Body Panel"],
    "Rust": ["Surface Rust", "Scale Rust", "Perforation", "Rust Staining"],
    "Wheel": ["Steel Wheel", "Alloy Wheel", "Spare Tire", "Hub Assembly"]
  }

  Object.entries(genericToSpecific).forEach(([generic, specific]) => {
    recommendations.label_refinements.push(`Replace "${generic}" with specific options: ${specific.join(', ')}`)
  })

  return recommendations
}

async function buildCuratedDatasets(supabase: any, vehicleId?: string, systemFocus?: string, recommendations: any) {
  // Get high-quality training examples
  let query = supabase
    .from('image_tags')
    .select(`
      *,
      vehicle_images!inner(
        image_url,
        vehicle_id,
        exif_data
      )
    `)

  if (vehicleId) {
    query = query.eq('vehicle_images.vehicle_id', vehicleId)
  }

  const { data: allTags } = await query

  // Curate different dataset types
  const datasets = {
    gold_standard: curateGoldStandardDataset(allTags),
    negative_examples: curateNegativeExamples(allTags),
    system_specific: systemFocus ? curateSystemSpecificDataset(allTags, systemFocus) : {},
    edge_cases: curateEdgeCases(allTags),
    progressive_difficulty: createProgressiveTrainingSet(allTags)
  }

  return datasets
}

function curateGoldStandardDataset(tags: any[]) {
  // High-confidence, human-verified examples
  return tags
    .filter(tag =>
      tag.verified === true &&
      (tag.automated_confidence || 0) > 85 &&
      tag.validation_status !== 'rejected'
    )
    .map(tag => ({
      image_url: tag.vehicle_images.image_url,
      label: tag.tag_name,
      confidence: tag.automated_confidence,
      bbox: {
        x: tag.x_position / 100,
        y: tag.y_position / 100,
        width: tag.width / 100,
        height: tag.height / 100
      },
      training_weight: 2.0, // Higher weight for gold standard
      quality_score: calculateQualityScore(tag)
    }))
    .sort((a, b) => b.quality_score - a.quality_score)
}

function curateNegativeExamples(tags: any[]) {
  // Rejected or corrected examples - crucial for reducing false positives
  return tags
    .filter(tag =>
      tag.validation_status === 'rejected' ||
      tag.parent_tag_id !== null
    )
    .map(tag => ({
      image_url: tag.vehicle_images.image_url,
      original_label: tag.tag_name,
      correct_label: tag.parent_tag_id ? "corrected_label" : "no_detection",
      bbox: {
        x: tag.x_position / 100,
        y: tag.y_position / 100,
        width: tag.width / 100,
        height: tag.height / 100
      },
      training_weight: 1.5, // Important for precision
      negative_example: true
    }))
}

function curateSystemSpecificDataset(tags: any[], systemFocus: string) {
  const systemKeywords = {
    'braking': ['brake', 'disc', 'caliper', 'brake line', 'brake pad'],
    'powertrain': ['engine', 'transmission', 'differential', 'driveshaft'],
    'body': ['rust', 'panel', 'door', 'fender', 'bumper', 'paint'],
    'suspension': ['wheel', 'tire', 'strut', 'spring', 'shock'],
    'electrical': ['battery', 'alternator', 'wiring', 'fuse', 'relay']
  }

  const keywords = systemKeywords[systemFocus as keyof typeof systemKeywords] || []

  return tags
    .filter(tag =>
      keywords.some(keyword => tag.tag_name.toLowerCase().includes(keyword))
    )
    .map(tag => ({
      image_url: tag.vehicle_images.image_url,
      label: tag.tag_name,
      system: systemFocus,
      confidence: tag.automated_confidence,
      bbox: {
        x: tag.x_position / 100,
        y: tag.y_position / 100,
        width: tag.width / 100,
        height: tag.height / 100
      },
      system_specific_weight: 1.3
    }))
}

function generateAutomotiveSpecificMappings(analysis: any) {
  // Create mappings from generic Rekognition labels to specific automotive terms
  const mappings = {
    label_hierarchy: {
      // Generic → Automotive Specific
      "Machine": {
        automotive_alternatives: ["Engine", "Transmission", "Brake System", "Differential"],
        confidence_boost: 0.1,
        context_keywords: ["bay", "under", "mechanical"]
      },
      "Metal": {
        automotive_alternatives: ["Body Panel", "Engine Block", "Brake Disc", "Frame Member"],
        confidence_boost: 0.15,
        context_keywords: ["automotive", "vehicle", "car"]
      },
      "Wheel": {
        automotive_alternatives: ["Steel Wheel", "Alloy Wheel", "Spare Tire"],
        confidence_boost: 0.2,
        context_keywords: ["tire", "rim", "hub"]
      }
    },

    condition_assessment: {
      // Condition-based modifiers
      "Rust": ["Surface Rust", "Scale Rust", "Perforation", "Rust Through"],
      "Corrosion": ["Light Corrosion", "Heavy Corrosion", "Galvanic Corrosion"],
      "Wear": ["Light Wear", "Moderate Wear", "Severe Wear", "Replacement Needed"]
    },

    contextual_boosting: {
      // Boost confidence based on image context
      engine_bay: {
        boost_labels: ["Engine", "Alternator", "Battery", "Radiator", "Belt"],
        boost_factor: 0.2
      },
      undercarriage: {
        boost_labels: ["Brake", "Differential", "Exhaust", "Frame", "Suspension"],
        boost_factor: 0.25
      },
      interior: {
        boost_labels: ["Dashboard", "Seat", "Console", "Gauge", "Switch"],
        boost_factor: 0.15
      }
    }
  }

  return mappings
}

// Helper functions
function isAutomotiveTag(tagName: string): boolean {
  const automotiveTerms = [
    'engine', 'brake', 'wheel', 'tire', 'transmission', 'differential',
    'radiator', 'battery', 'alternator', 'exhaust', 'suspension', 'frame',
    'dashboard', 'seat', 'gauge', 'steering', 'pedal', 'clutch'
  ]
  return automotiveTerms.some(term => tagName.toLowerCase().includes(term))
}

function isGenericTag(tagName: string): boolean {
  const genericTerms = ['machine', 'metal', 'object', 'part', 'component', 'device', 'equipment']
  return genericTerms.some(term => tagName.toLowerCase().includes(term))
}

function analyzeSystemDistribution(tags: any[]) {
  const systems = { braking: 0, powertrain: 0, body: 0, suspension: 0, electrical: 0, other: 0 }

  tags.forEach((tag: any) => {
    const tagName = tag.tag_name.toLowerCase()
    if (tagName.includes('brake')) systems.braking++
    else if (tagName.includes('engine') || tagName.includes('transmission')) systems.powertrain++
    else if (tagName.includes('rust') || tagName.includes('panel') || tagName.includes('body')) systems.body++
    else if (tagName.includes('wheel') || tagName.includes('tire') || tagName.includes('suspension')) systems.suspension++
    else if (tagName.includes('electrical') || tagName.includes('battery') || tagName.includes('wiring')) systems.electrical++
    else systems.other++
  })

  return systems
}

function analyzeConfidenceDistribution(tags: any[]) {
  const distribution = { high: 0, medium: 0, low: 0 }

  tags.forEach((tag: any) => {
    const conf = tag.automated_confidence || 0
    if (conf >= 85) distribution.high++
    else if (conf >= 65) distribution.medium++
    else distribution.low++
  })

  return distribution
}

function identifyFailurePatterns(tags: any[]) {
  const patterns = {
    rust_overdetection: 0,
    generic_labeling: 0,
    low_confidence_acceptance: 0,
    bbox_inaccuracy: 0
  }

  const rejectedTags = tags.filter((t: any) => t.validation_status === 'rejected')
  const total = rejectedTags.length

  if (total > 0) {
    patterns.rust_overdetection = rejectedTags.filter((t: any) =>
      t.tag_name.toLowerCase().includes('rust') || t.tag_name.toLowerCase().includes('corrosion')
    ).length / total

    patterns.generic_labeling = rejectedTags.filter((t: any) =>
      isGenericTag(t.tag_name)
    ).length / total

    patterns.low_confidence_acceptance = rejectedTags.filter((t: any) =>
      (t.automated_confidence || 0) < 70
    ).length / total
  }

  return patterns
}

function calculateTrainingDataQuality(metrics: any): number {
  // Quality score based on validation ratio, confidence distribution, automotive specificity
  const validationRatio = (metrics.verified_correct + metrics.human_corrected) / metrics.total_ai_tags
  const automotiveRatio = metrics.automotive_tags / metrics.total_ai_tags
  const confidenceQuality = 1 - (metrics.low_confidence / metrics.total_ai_tags)

  return Math.round((validationRatio * 0.4 + automotiveRatio * 0.3 + confidenceQuality * 0.3) * 100)
}

function identifyOptimizationOpportunities(metrics: any, systemFocus?: string) {
  const opportunities = []

  if (metrics.automotive_specificity < 40) {
    opportunities.push("Low automotive specificity - prioritize vehicle-specific training data")
  }

  if (metrics.rejection_rate > 25) {
    opportunities.push("High false positive rate - add negative training examples")
  }

  if (metrics.system_distribution.braking < 5 && systemFocus === 'braking') {
    opportunities.push("Insufficient brake system training data")
  }

  if (metrics.confidence_distribution.low > metrics.confidence_distribution.high) {
    opportunities.push("Too many low-confidence detections - improve model certainty")
  }

  return opportunities
}

function curateEdgeCases(tags: any[]) {
  // Challenging examples that help improve robustness
  return tags
    .filter(tag =>
      (tag.automated_confidence || 0) >= 60 &&
      (tag.automated_confidence || 0) <= 75 && // Medium confidence
      (tag.verified === true || tag.validation_status === 'rejected')
    )
    .slice(0, 50) // Limit edge cases to manageable set
}

function createProgressiveTrainingSet(tags: any[]) {
  // Organize training data by difficulty level
  const easy = tags.filter(tag => (tag.automated_confidence || 0) > 90 && tag.verified === true)
  const medium = tags.filter(tag => (tag.automated_confidence || 0) > 75 && (tag.automated_confidence || 0) <= 90)
  const hard = tags.filter(tag => (tag.automated_confidence || 0) <= 75 && tag.verified === true)

  return { easy: easy.slice(0, 100), medium: medium.slice(0, 75), hard: hard.slice(0, 50) }
}

function calculateQualityScore(tag: any): number {
  let score = tag.automated_confidence || 0

  if (tag.verified === true) score += 20
  if (tag.x_position && tag.y_position && tag.width && tag.height) score += 10 // Has bbox
  if (isAutomotiveTag(tag.tag_name)) score += 15
  if (tag.validation_status !== 'rejected') score += 5

  return Math.min(score, 100)
}