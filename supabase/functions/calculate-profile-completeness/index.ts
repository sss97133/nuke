/**
 * PROFILE COMPLETENESS CALCULATOR
 * 
 * Calculates how complete a vehicle profile is based on data in all tables
 * Weighted scoring: Critical tables (SPID, receipts) worth more than optional (certifications)
 * 
 * Returns completeness score (0-100) and breakdown by table
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Table weights (out of 100 total points)
const TABLE_WEIGHTS = {
  // Critical data (40 points total)
  vehicles_basic: 10,        // Year, make, model, VIN
  vehicle_spid_data: 10,     // Factory specs
  vehicle_images: 10,        // Photos
  timeline_events: 10,       // Work history
  
  // Important data (30 points total)
  receipts: 10,              // Purchase documentation
  reference_documents: 10,   // Manuals, brochures
  image_tags: 5,             // Image organization
  vehicle_modifications: 5,  // Mod documentation
  
  // Valuable data (20 points total)
  maintenance_records: 5,    // Service history
  part_identifications: 5,   // Parts catalog
  title_documents: 5,        // Legal docs
  vehicle_validations: 5,    // Verification data
  
  // Optional data (10 points total)
  certifications: 3,         // NCRS, etc.
  market_listings: 2,        // Historical listings
  vehicle_awards: 2,         // Show awards
  expert_assessments: 3      // Professional appraisals
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { vehicle_id } = await req.json()
    if (!vehicle_id) throw new Error('Missing vehicle_id')

    const completeness = await calculateCompleteness(supabase, vehicle_id)

    return new Response(
      JSON.stringify(completeness),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function calculateCompleteness(supabase: any, vehicleId: string) {
  // Query all tables in parallel
  const [
    vehicle,
    spidData,
    images,
    timeline,
    receipts,
    refDocs,
    imageTags,
    modifications,
    maintenance,
    partIds,
    titleDocs,
    validations,
    certs,
    listings,
    awards,
    assessments
  ] = await Promise.all([
    supabase.from('vehicles').select('*').eq('id', vehicleId).single(),
    supabase.from('vehicle_spid_data').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
    supabase.from('vehicle_images').select('id').eq('vehicle_id', vehicleId),
    supabase.from('timeline_events').select('id').eq('vehicle_id', vehicleId),
    supabase.from('receipts').select('id').eq('vehicle_id', vehicleId),
    supabase.from('reference_documents').select('id').eq('vehicle_id', vehicleId),
    supabase.from('image_tags').select('id').eq('vehicle_id', vehicleId),
    supabase.from('vehicle_modifications').select('id').eq('vehicle_id', vehicleId),
    supabase.from('maintenance_records').select('id').eq('vehicle_id', vehicleId),
    supabase.from('part_identifications').select('id').eq('vehicle_id', vehicleId),
    supabase.from('title_documents').select('id').eq('vehicle_id', vehicleId),
    supabase.from('vehicle_validations').select('id').eq('vehicle_id', vehicleId),
    supabase.from('certifications').select('id').eq('vehicle_id', vehicleId),
    supabase.from('market_listings').select('id').eq('vehicle_id', vehicleId),
    supabase.from('vehicle_awards').select('id').eq('vehicle_id', vehicleId),
    supabase.from('expert_assessments').select('id').eq('vehicle_id', vehicleId)
  ])

  let totalScore = 0
  const breakdown: any = {}

  // Score vehicles_basic
  const vehicleData = vehicle.data || {}
  const basicFieldsPresent = [
    vehicleData.year,
    vehicleData.make,
    vehicleData.model,
    vehicleData.vin
  ].filter(Boolean).length
  const basicScore = (basicFieldsPresent / 4) * TABLE_WEIGHTS.vehicles_basic
  totalScore += basicScore
  breakdown.vehicles_basic = {
    score: parseFloat(basicScore.toFixed(2)),
    maxScore: TABLE_WEIGHTS.vehicles_basic,
    present: basicFieldsPresent,
    total: 4,
    percent: (basicFieldsPresent / 4) * 100
  }

  // Score SPID data
  const hasSPID = !!spidData.data
  const spidScore = hasSPID ? TABLE_WEIGHTS.vehicle_spid_data : 0
  totalScore += spidScore
  breakdown.vehicle_spid_data = {
    score: spidScore,
    maxScore: TABLE_WEIGHTS.vehicle_spid_data,
    present: hasSPID ? 1 : 0,
    total: 1,
    percent: hasSPID ? 100 : 0
  }

  // Score images (scale: 0 images = 0%, 10+ = 100%)
  const imageCount = images.data?.length || 0
  const imageScore = Math.min(imageCount / 10, 1) * TABLE_WEIGHTS.vehicle_images
  totalScore += imageScore
  breakdown.vehicle_images = {
    score: parseFloat(imageScore.toFixed(2)),
    maxScore: TABLE_WEIGHTS.vehicle_images,
    present: imageCount,
    total: 10,
    percent: Math.min((imageCount / 10) * 100, 100)
  }

  // Score timeline (scale: 0 = 0%, 20+ = 100%)
  const timelineCount = timeline.data?.length || 0
  const timelineScore = Math.min(timelineCount / 20, 1) * TABLE_WEIGHTS.timeline_events
  totalScore += timelineScore
  breakdown.timeline_events = {
    score: parseFloat(timelineScore.toFixed(2)),
    maxScore: TABLE_WEIGHTS.timeline_events,
    present: timelineCount,
    total: 20,
    percent: Math.min((timelineCount / 20) * 100, 100)
  }

  // Score receipts (scale: 0 = 0%, 10+ = 100%)
  const receiptCount = receipts.data?.length || 0
  const receiptScore = Math.min(receiptCount / 10, 1) * TABLE_WEIGHTS.receipts
  totalScore += receiptScore
  breakdown.receipts = {
    score: parseFloat(receiptScore.toFixed(2)),
    maxScore: TABLE_WEIGHTS.receipts,
    present: receiptCount,
    total: 10,
    percent: Math.min((receiptCount / 10) * 100, 100)
  }

  // Score reference docs (scale: 0 = 0%, 5+ = 100%)
  const refDocCount = refDocs.data?.length || 0
  const refDocScore = Math.min(refDocCount / 5, 1) * TABLE_WEIGHTS.reference_documents
  totalScore += refDocScore
  breakdown.reference_documents = {
    score: parseFloat(refDocScore.toFixed(2)),
    maxScore: TABLE_WEIGHTS.reference_documents,
    present: refDocCount,
    total: 5,
    percent: Math.min((refDocCount / 5) * 100, 100)
  }

  // Score image tags (scale: 0 = 0%, 50+ = 100%)
  const tagCount = imageTags.data?.length || 0
  const tagScore = Math.min(tagCount / 50, 1) * TABLE_WEIGHTS.image_tags
  totalScore += tagScore
  breakdown.image_tags = {
    score: parseFloat(tagScore.toFixed(2)),
    maxScore: TABLE_WEIGHTS.image_tags,
    present: tagCount,
    total: 50,
    percent: Math.min((tagCount / 50) * 100, 100)
  }

  // Score modifications (scale: presence)
  const modCount = modifications.data?.length || 0
  const modScore = modCount > 0 ? TABLE_WEIGHTS.vehicle_modifications : 0
  totalScore += modScore
  breakdown.vehicle_modifications = {
    score: modScore,
    maxScore: TABLE_WEIGHTS.vehicle_modifications,
    present: modCount,
    total: 1,
    percent: modCount > 0 ? 100 : 0
  }

  // Score remaining tables similarly
  const maintCount = maintenance.data?.length || 0
  const maintScore = Math.min(maintCount / 5, 1) * TABLE_WEIGHTS.maintenance_records
  totalScore += maintScore
  breakdown.maintenance_records = {
    score: parseFloat(maintScore.toFixed(2)),
    maxScore: TABLE_WEIGHTS.maintenance_records,
    present: maintCount,
    total: 5,
    percent: Math.min((maintCount / 5) * 100, 100)
  }

  const partIdCount = partIds.data?.length || 0
  const partIdScore = Math.min(partIdCount / 20, 1) * TABLE_WEIGHTS.part_identifications
  totalScore += partIdScore
  breakdown.part_identifications = {
    score: parseFloat(partIdScore.toFixed(2)),
    maxScore: TABLE_WEIGHTS.part_identifications,
    present: partIdCount,
    total: 20,
    percent: Math.min((partIdCount / 20) * 100, 100)
  }

  const titleCount = titleDocs.data?.length || 0
  const titleScore = titleCount > 0 ? TABLE_WEIGHTS.title_documents : 0
  totalScore += titleScore
  breakdown.title_documents = {
    score: titleScore,
    maxScore: TABLE_WEIGHTS.title_documents,
    present: titleCount,
    total: 1,
    percent: titleCount > 0 ? 100 : 0
  }

  const validCount = validations.data?.length || 0
  const validScore = Math.min(validCount / 3, 1) * TABLE_WEIGHTS.vehicle_validations
  totalScore += validScore
  breakdown.vehicle_validations = {
    score: parseFloat(validScore.toFixed(2)),
    maxScore: TABLE_WEIGHTS.vehicle_validations,
    present: validCount,
    total: 3,
    percent: Math.min((validCount / 3) * 100, 100)
  }

  // Optional tables
  const certCount = certs.data?.length || 0
  const certScore = certCount > 0 ? TABLE_WEIGHTS.certifications : 0
  totalScore += certScore
  breakdown.certifications = {
    score: certScore,
    maxScore: TABLE_WEIGHTS.certifications,
    present: certCount,
    total: 1,
    percent: certCount > 0 ? 100 : 0
  }

  const listingCount = listings.data?.length || 0
  const listingScore = listingCount > 0 ? TABLE_WEIGHTS.market_listings : 0
  totalScore += listingScore
  breakdown.market_listings = {
    score: listingScore,
    maxScore: TABLE_WEIGHTS.market_listings,
    present: listingCount,
    total: 1,
    percent: listingCount > 0 ? 100 : 0
  }

  const awardCount = awards.data?.length || 0
  const awardScore = awardCount > 0 ? TABLE_WEIGHTS.vehicle_awards : 0
  totalScore += awardScore
  breakdown.vehicle_awards = {
    score: awardScore,
    maxScore: TABLE_WEIGHTS.vehicle_awards,
    present: awardCount,
    total: 1,
    percent: awardCount > 0 ? 100 : 0
  }

  const assessCount = assessments.data?.length || 0
  const assessScore = assessCount > 0 ? TABLE_WEIGHTS.expert_assessments : 0
  totalScore += assessScore
  breakdown.expert_assessments = {
    score: assessScore,
    maxScore: TABLE_WEIGHTS.expert_assessments,
    present: assessCount,
    total: 1,
    percent: assessCount > 0 ? 100 : 0
  }

  // Calculate tier (what level of documentation)
  let tier = 'minimal'
  let tierDescription = 'Basic vehicle info only'
  
  if (totalScore >= 80) {
    tier = 'complete'
    tierDescription = 'Comprehensive documentation - ready for professional appraisal'
  } else if (totalScore >= 60) {
    tier = 'excellent'
    tierDescription = 'Well-documented - high confidence analysis possible'
  } else if (totalScore >= 40) {
    tier = 'good'
    tierDescription = 'Good documentation - most questions answerable'
  } else if (totalScore >= 20) {
    tier = 'fair'
    tierDescription = 'Some documentation - basic analysis possible'
  }

  // Identify top priorities (missing high-value tables)
  const priorities = []
  if (!spidData.data) {
    priorities.push({
      table: 'vehicle_spid_data',
      value: TABLE_WEIGHTS.vehicle_spid_data,
      action: 'Photograph SPID sheet (glove box label)',
      impact: 'Enables factory spec validation'
    })
  }
  if (receiptCount === 0) {
    priorities.push({
      table: 'receipts',
      value: TABLE_WEIGHTS.receipts,
      action: 'Upload receipts for parts/work',
      impact: 'Validates modifications and work history'
    })
  }
  if (refDocCount === 0) {
    priorities.push({
      table: 'reference_documents',
      value: TABLE_WEIGHTS.reference_documents,
      action: 'Upload factory manual or brochure',
      impact: 'Enables correctness verification'
    })
  }
  if (imageCount < 10) {
    priorities.push({
      table: 'vehicle_images',
      value: TABLE_WEIGHTS.vehicle_images * ((10 - imageCount) / 10),
      action: `Add ${10 - imageCount} more photos for complete coverage`,
      impact: 'Better visual documentation'
    })
  }

  return {
    vehicle_id: vehicleId,
    completeness_score: parseFloat(totalScore.toFixed(2)),
    tier,
    tier_description: tierDescription,
    breakdown,
    priorities: priorities.sort((a, b) => b.value - a.value).slice(0, 5),
    context_implications: {
      image_processing_cost: totalScore >= 60 ? 'ultra_low' : totalScore >= 30 ? 'low' : 'high',
      confidence_level: totalScore >= 60 ? 'high' : totalScore >= 30 ? 'medium' : 'low',
      ready_for_professional_appraisal: totalScore >= 80
    },
    summary: {
      total_items: Object.values(breakdown).reduce((sum: number, b: any) => sum + b.present, 0),
      critical_complete: (breakdown.vehicles_basic.score + breakdown.vehicle_spid_data.score + 
                         breakdown.vehicle_images.score + breakdown.timeline_events.score) / 40 * 100,
      important_complete: (breakdown.receipts.score + breakdown.reference_documents.score + 
                          breakdown.image_tags.score + breakdown.vehicle_modifications.score) / 30 * 100
    }
  }
}

