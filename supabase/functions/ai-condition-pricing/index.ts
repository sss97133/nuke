/**
 * AI Condition-Based Pricing System
 * 
 * Uses computer vision to analyze vehicle condition from images
 * and adjust pricing based on actual visual evidence.
 * 
 * This is what makes your system revolutionary - pricing based on 
 * what the AI can actually SEE, not just year/make/model.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { vehicle_id } = await req.json()
    
    console.log(`🔍 Starting AI condition analysis for vehicle ${vehicle_id}`)
    
    // 1. Get vehicle and images
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicle_id)
      .single()
    
    if (!vehicle) {
      throw new Error('Vehicle not found')
    }
    
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('vehicle_id', vehicle_id)
      .order('created_at', { ascending: false })
    
    if (!images || images.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No images available for condition analysis'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // 2. Analyze images for condition indicators
    const conditionAnalysis = await analyzeVehicleCondition(images)
    
    // 3. Get existing pricing data
    const { data: currentPricing } = await supabase
      .from('vehicle_price_discoveries')
      .select('*')
      .eq('vehicle_id', vehicle_id)
      .order('discovered_at', { ascending: false })
      .limit(1)
      .single()
    
    // 4. Calculate condition-adjusted pricing
    const adjustedPricing = calculateConditionAdjustedPrice(
      currentPricing,
      conditionAnalysis,
      vehicle
    )
    
    // 5. Store results
    await storeConditionAnalysis(vehicle_id, conditionAnalysis, adjustedPricing)
    
    // 6. Update vehicle with condition-adjusted pricing
    await supabase
      .from('vehicles')
      .update({
        current_value: adjustedPricing.final_price,
        condition_rating: conditionAnalysis.overall_condition_score,
        price_confidence: adjustedPricing.confidence,
        price_last_updated: new Date().toISOString()
      })
      .eq('id', vehicle_id)
    
    console.log(`✅ Condition analysis complete: ${conditionAnalysis.overall_condition_score}/10 condition, $${adjustedPricing.final_price}`)
    
    return new Response(JSON.stringify({
      success: true,
      vehicle_id,
      condition_analysis: conditionAnalysis,
      pricing_adjustment: adjustedPricing
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('❌ Condition analysis error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

/**
 * Analyze vehicle condition from images using AI
 */
async function analyzeVehicleCondition(images: any[]) {
  console.log(`🤖 Analyzing ${images.length} images for condition`)
  
  const analyses = await Promise.all(
    images.slice(0, 20).map(async (image) => { // Limit to 20 images for performance
      return await analyzeImageForCondition(image)
    })
  )
  
  // Aggregate all analyses into overall condition assessment
  return aggregateConditionAnalyses(analyses)
}

/**
 * Analyze individual image for condition indicators
 */
async function analyzeImageForCondition(image: any) {
  try {
    // Get existing image tags (from your current AI tagging system)
    const { data: tags } = await supabase
      .from('image_tags')
      .select('*')
      .eq('image_id', image.id)
    
    if (!tags || tags.length === 0) {
      return {
        image_id: image.id,
        condition_indicators: [],
        rust_severity: 0,
        paint_quality: 5, // Default neutral
        body_condition: 5,
        interior_condition: 5,
        confidence: 0
      }
    }
    
    // Analyze tags for condition indicators
    const conditionIndicators = extractConditionFromTags(tags)
    
    return {
      image_id: image.id,
      image_url: image.image_url,
      condition_indicators: conditionIndicators,
      rust_severity: assessRustSeverity(tags),
      paint_quality: assessPaintQuality(tags),
      body_condition: assessBodyCondition(tags),
      interior_condition: assessInteriorCondition(tags),
      modification_quality: assessModificationQuality(tags),
      confidence: calculateTagConfidence(tags)
    }
    
  } catch (error) {
    console.error('Error analyzing image condition:', error)
    return {
      image_id: image.id,
      condition_indicators: [],
      rust_severity: 0,
      paint_quality: 5,
      body_condition: 5,
      interior_condition: 5,
      confidence: 0
    }
  }
}

/**
 * Extract condition indicators from AI tags
 */
function extractConditionFromTags(tags: any[]) {
  const conditionKeywords = {
    // Positive indicators
    excellent: ['pristine', 'mint', 'perfect', 'flawless', 'show quality', 'concours'],
    good: ['clean', 'nice', 'solid', 'straight', 'rust free', 'original'],
    
    // Negative indicators  
    poor: ['rust', 'dent', 'damage', 'worn', 'faded', 'cracked', 'broken'],
    project: ['needs work', 'project', 'restore', 'repair', 'fix']
  }
  
  const indicators: any[] = []
  
  tags.forEach(tag => {
    const tagText = (tag.tag_name || tag.text || '').toLowerCase()
    
    Object.entries(conditionKeywords).forEach(([category, keywords]) => {
      keywords.forEach(keyword => {
        if (tagText.includes(keyword)) {
          indicators.push({
            category,
            keyword,
            confidence: tag.confidence || 0.5,
            tag_type: tag.tag_type
          })
        }
      })
    })
  })
  
  return indicators
}

/**
 * Assess rust severity from tags (0-10 scale)
 */
function assessRustSeverity(tags: any[]): number {
  const rustTags = tags.filter(tag => 
    (tag.tag_name || tag.text || '').toLowerCase().includes('rust')
  )
  
  if (rustTags.length === 0) return 0 // No rust detected
  
  // Assess severity based on rust-related keywords
  let maxSeverity = 0
  
  rustTags.forEach(tag => {
    const text = (tag.tag_name || tag.text || '').toLowerCase()
    
    if (text.includes('rust through') || text.includes('rust hole')) {
      maxSeverity = Math.max(maxSeverity, 9) // Severe
    } else if (text.includes('heavy rust') || text.includes('rust damage')) {
      maxSeverity = Math.max(maxSeverity, 7) // Heavy
    } else if (text.includes('surface rust') || text.includes('light rust')) {
      maxSeverity = Math.max(maxSeverity, 3) // Light
    } else if (text.includes('rust')) {
      maxSeverity = Math.max(maxSeverity, 5) // Moderate
    }
  })
  
  return maxSeverity
}

/**
 * Assess paint quality from tags (1-10 scale)
 */
function assessPaintQuality(tags: any[]): number {
  const paintTags = tags.filter(tag => {
    const text = (tag.tag_name || tag.text || '').toLowerCase()
    return text.includes('paint') || text.includes('color') || text.includes('finish')
  })
  
  if (paintTags.length === 0) return 5 // Default neutral
  
  let qualityScore = 5
  
  paintTags.forEach(tag => {
    const text = (tag.tag_name || tag.text || '').toLowerCase()
    
    if (text.includes('fresh paint') || text.includes('new paint')) {
      qualityScore = Math.max(qualityScore, 9)
    } else if (text.includes('good paint') || text.includes('nice paint')) {
      qualityScore = Math.max(qualityScore, 7)
    } else if (text.includes('faded') || text.includes('scratched')) {
      qualityScore = Math.min(qualityScore, 4)
    } else if (text.includes('primer') || text.includes('bare metal')) {
      qualityScore = Math.min(qualityScore, 2)
    }
  })
  
  return qualityScore
}

/**
 * Assess body condition from tags (1-10 scale)
 */
function assessBodyCondition(tags: any[]): number {
  const bodyTags = tags.filter(tag => {
    const text = (tag.tag_name || tag.text || '').toLowerCase()
    return text.includes('body') || text.includes('panel') || text.includes('dent') || 
           text.includes('straight') || text.includes('damage')
  })
  
  if (bodyTags.length === 0) return 5 // Default neutral
  
  let conditionScore = 5
  
  bodyTags.forEach(tag => {
    const text = (tag.tag_name || tag.text || '').toLowerCase()
    
    if (text.includes('straight') || text.includes('clean body')) {
      conditionScore = Math.max(conditionScore, 8)
    } else if (text.includes('minor dent') || text.includes('small dent')) {
      conditionScore = Math.min(conditionScore, 6)
    } else if (text.includes('major dent') || text.includes('damage')) {
      conditionScore = Math.min(conditionScore, 3)
    }
  })
  
  return conditionScore
}

/**
 * Assess interior condition from tags (1-10 scale)
 */
function assessInteriorCondition(tags: any[]): number {
  const interiorTags = tags.filter(tag => {
    const text = (tag.tag_name || tag.text || '').toLowerCase()
    return text.includes('interior') || text.includes('seat') || text.includes('dash') ||
           text.includes('carpet') || text.includes('upholstery')
  })
  
  if (interiorTags.length === 0) return 5 // Default neutral
  
  let conditionScore = 5
  
  interiorTags.forEach(tag => {
    const text = (tag.tag_name || tag.text || '').toLowerCase()
    
    if (text.includes('new interior') || text.includes('restored interior')) {
      conditionScore = Math.max(conditionScore, 9)
    } else if (text.includes('good interior') || text.includes('clean interior')) {
      conditionScore = Math.max(conditionScore, 7)
    } else if (text.includes('worn') || text.includes('faded')) {
      conditionScore = Math.min(conditionScore, 4)
    } else if (text.includes('torn') || text.includes('damaged')) {
      conditionScore = Math.min(conditionScore, 2)
    }
  })
  
  return conditionScore
}

/**
 * Assess modification quality from tags (1-10 scale)
 */
function assessModificationQuality(tags: any[]): number {
  const modTags = tags.filter(tag => {
    const text = (tag.tag_name || tag.text || '').toLowerCase()
    return text.includes('mod') || text.includes('custom') || text.includes('upgrade') ||
           text.includes('aftermarket') || tag.tag_type === 'modification'
  })
  
  if (modTags.length === 0) return 5 // No mods = neutral
  
  let qualityScore = 5
  
  modTags.forEach(tag => {
    const text = (tag.tag_name || tag.text || '').toLowerCase()
    
    // High-quality mod indicators
    if (text.includes('professional') || text.includes('quality install')) {
      qualityScore = Math.max(qualityScore, 8)
    } else if (text.includes('clean install') || text.includes('well done')) {
      qualityScore = Math.max(qualityScore, 7)
    } else if (text.includes('hack job') || text.includes('poor install')) {
      qualityScore = Math.min(qualityScore, 2)
    }
  })
  
  return qualityScore
}

/**
 * Calculate confidence based on tag quality
 */
function calculateTagConfidence(tags: any[]): number {
  if (tags.length === 0) return 0
  
  const avgConfidence = tags.reduce((sum, tag) => 
    sum + (tag.confidence || 0.5), 0
  ) / tags.length
  
  // Boost confidence based on tag count (more tags = more confidence)
  const tagCountBonus = Math.min(tags.length * 5, 30) // Max 30% bonus
  
  return Math.min(100, (avgConfidence * 70) + tagCountBonus)
}

/**
 * Aggregate all image analyses into overall condition assessment
 */
function aggregateConditionAnalyses(analyses: any[]) {
  const validAnalyses = analyses.filter(a => a.confidence > 0)
  
  if (validAnalyses.length === 0) {
    return {
      overall_condition_score: 5,
      rust_severity: 0,
      paint_quality: 5,
      body_condition: 5,
      interior_condition: 5,
      modification_quality: 5,
      confidence: 0,
      image_count: analyses.length,
      condition_summary: 'Insufficient data for condition assessment'
    }
  }
  
  // Weight by confidence and average
  const weightedAverage = (field: string) => {
    const totalWeight = validAnalyses.reduce((sum, a) => sum + a.confidence, 0)
    const weightedSum = validAnalyses.reduce((sum, a) => 
      sum + (a[field] * a.confidence), 0
    )
    return totalWeight > 0 ? weightedSum / totalWeight : 5
  }
  
  const rustSeverity = Math.max(...validAnalyses.map(a => a.rust_severity))
  const paintQuality = weightedAverage('paint_quality')
  const bodyCondition = weightedAverage('body_condition')
  const interiorCondition = weightedAverage('interior_condition')
  const modificationQuality = weightedAverage('modification_quality')
  
  // Calculate overall condition (rust is a major factor)
  const overallCondition = Math.max(1, Math.min(10, 
    (paintQuality * 0.3) + 
    (bodyCondition * 0.3) + 
    (interiorCondition * 0.2) + 
    (modificationQuality * 0.1) + 
    ((10 - rustSeverity) * 0.1) // Rust reduces overall score
  ))
  
  const avgConfidence = validAnalyses.reduce((sum, a) => 
    sum + a.confidence, 0
  ) / validAnalyses.length
  
  return {
    overall_condition_score: Math.round(overallCondition * 10) / 10,
    rust_severity: rustSeverity,
    paint_quality: Math.round(paintQuality * 10) / 10,
    body_condition: Math.round(bodyCondition * 10) / 10,
    interior_condition: Math.round(interiorCondition * 10) / 10,
    modification_quality: Math.round(modificationQuality * 10) / 10,
    confidence: Math.round(avgConfidence),
    image_count: analyses.length,
    analyzed_images: validAnalyses.length,
    condition_summary: generateConditionSummary(overallCondition, rustSeverity, paintQuality)
  }
}

/**
 * Generate human-readable condition summary
 */
function generateConditionSummary(overall: number, rust: number, paint: number): string {
  if (overall >= 8.5) {
    return 'Excellent condition - show quality vehicle'
  } else if (overall >= 7.5) {
    return 'Very good condition - well maintained'
  } else if (overall >= 6.5) {
    return 'Good condition - solid driver'
  } else if (overall >= 5.5) {
    return 'Fair condition - some issues present'
  } else if (overall >= 4.0) {
    return 'Poor condition - needs significant work'
  } else {
    return 'Project condition - restoration required'
  }
}

/**
 * Calculate condition-adjusted pricing
 */
function calculateConditionAdjustedPrice(currentPricing: any, conditionAnalysis: any, vehicle: any) {
  const basePrice = currentPricing?.estimated_value || 20000 // Fallback base price
  
  // Condition multipliers based on overall condition score
  const conditionMultipliers = {
    10: 1.40,  // Perfect = 40% premium
    9: 1.25,   // Excellent = 25% premium  
    8: 1.10,   // Very good = 10% premium
    7: 1.00,   // Good = baseline
    6: 0.90,   // Fair = 10% discount
    5: 0.80,   // Poor = 20% discount
    4: 0.65,   // Project = 35% discount
    3: 0.50,   // Rough = 50% discount
    2: 0.35,   // Parts car = 65% discount
    1: 0.20    // Scrap = 80% discount
  }
  
  const conditionScore = Math.round(conditionAnalysis.overall_condition_score)
  const multiplier = conditionMultipliers[conditionScore] || 0.80
  
  // Additional rust penalty
  const rustPenalty = conditionAnalysis.rust_severity > 5 ? 
    (conditionAnalysis.rust_severity - 5) * 0.02 : 0 // 2% penalty per rust point above 5
  
  // Modification quality adjustment
  const modAdjustment = conditionAnalysis.modification_quality > 7 ? 0.05 : 
                       conditionAnalysis.modification_quality < 4 ? -0.10 : 0
  
  const finalMultiplier = Math.max(0.15, multiplier - rustPenalty + modAdjustment)
  const finalPrice = Math.round(basePrice * finalMultiplier)
  
  // Confidence boost from condition analysis
  const baseConfidence = currentPricing?.confidence || 50
  const conditionConfidenceBoost = Math.min(25, conditionAnalysis.confidence * 0.3)
  const finalConfidence = Math.min(95, baseConfidence + conditionConfidenceBoost)
  
  return {
    base_price: basePrice,
    condition_multiplier: Math.round(finalMultiplier * 100) / 100,
    rust_penalty: Math.round(rustPenalty * 100) / 100,
    modification_adjustment: Math.round(modAdjustment * 100) / 100,
    final_price: finalPrice,
    confidence: Math.round(finalConfidence),
    price_change: finalPrice - basePrice,
    price_change_percent: Math.round(((finalPrice - basePrice) / basePrice) * 100)
  }
}

/**
 * Store condition analysis results
 */
async function storeConditionAnalysis(vehicleId: string, conditionAnalysis: any, pricingAdjustment: any) {
  await supabase.from('vehicle_condition_analyses').upsert({
    vehicle_id: vehicleId,
    overall_condition_score: conditionAnalysis.overall_condition_score,
    rust_severity: conditionAnalysis.rust_severity,
    paint_quality: conditionAnalysis.paint_quality,
    body_condition: conditionAnalysis.body_condition,
    interior_condition: conditionAnalysis.interior_condition,
    modification_quality: conditionAnalysis.modification_quality,
    confidence: conditionAnalysis.confidence,
    image_count: conditionAnalysis.image_count,
    analyzed_images: conditionAnalysis.analyzed_images,
    condition_summary: conditionAnalysis.condition_summary,
    base_price: pricingAdjustment.base_price,
    condition_multiplier: pricingAdjustment.condition_multiplier,
    final_price: pricingAdjustment.final_price,
    price_change: pricingAdjustment.price_change,
    analyzed_at: new Date().toISOString()
  })
}