import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ImageMatchEvidence {
  imageUrl: string
  matchType: 'gps' | 'timestamp' | 'visual' | 'patina' | 'damage'
  confidence: number
  details: string
}

interface VehicleMatchResult {
  vehicleId: string
  matchScore: number
  evidence: ImageMatchEvidence[]
  shouldMerge: boolean
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { source_vehicle_id, target_listing_url, user_id } = await req.json()
    
    if (!source_vehicle_id || !target_listing_url) {
      return new Response(
        JSON.stringify({ error: 'source_vehicle_id and target_listing_url required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get source vehicle (user's 1974 Blazer)
    const { data: sourceVehicle, error: sourceError } = await supabase
      .from('vehicles')
      .select('*, vehicle_images(*)')
      .eq('id', source_vehicle_id)
      .single()

    if (sourceError || !sourceVehicle) {
      return new Response(
        JSON.stringify({ error: 'Source vehicle not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse the listing URL to get images
    const { data: parsedListing, error: parseError } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url: target_listing_url }
    })

    if (parseError || !parsedListing?.data) {
      return new Response(
        JSON.stringify({ error: 'Failed to parse listing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const listingImages = parsedListing.data.images || []
    
    if (listingImages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No images found in listing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get source vehicle images with GPS and timestamp data
    const sourceImages = (sourceVehicle.vehicle_images || []).filter((img: any) => 
      img.exif_data?.location || (img.latitude && img.longitude) || img.taken_at
    )

    if (sourceImages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Source vehicle has no images with GPS or timestamp data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Comparing ${sourceImages.length} source images with ${listingImages.length} listing images`)

    // Match vehicles by analyzing images
    const matchResult = await matchVehiclesByImages(
      sourceImages,
      listingImages,
      sourceVehicle,
      parsedListing.data,
      supabase
    )

    // If strong match, merge the vehicles
    if (matchResult.shouldMerge) {
      const mergeResult = await mergeVehicles(
        source_vehicle_id,
        parsedListing.data,
        target_listing_url,
        user_id,
        matchResult.evidence,
        supabase
      )

      return new Response(
        JSON.stringify({
          success: true,
          matched: true,
          merged: true,
          matchScore: matchResult.matchScore,
          evidence: matchResult.evidence,
          mergeResult
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        matched: matchResult.matchScore > 0.5,
        merged: false,
        matchScore: matchResult.matchScore,
        evidence: matchResult.evidence,
        message: matchResult.matchScore > 0.5 
          ? 'Potential match found, but confidence too low for automatic merge'
          : 'No strong match found'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error in match-vehicles-by-images:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * Match vehicles by analyzing images for:
 * - GPS location matches
 * - Timestamp proximity
 * - Visual similarity (patina, damage patterns)
 */
async function matchVehiclesByImages(
  sourceImages: any[],
  listingImages: string[],
  sourceVehicle: any,
  listingData: any,
  supabase: any
): Promise<VehicleMatchResult> {
  const evidence: ImageMatchEvidence[] = []
  let matchScore = 0

  // 1. GPS Location Matching
  const gpsMatches = await matchByGPS(sourceImages, listingImages, supabase)
  evidence.push(...gpsMatches)
  matchScore += gpsMatches.length * 0.3 // GPS matches are strong evidence

  // 2. Timestamp Matching
  const timestampMatches = await matchByTimestamp(sourceImages, listingImages, supabase)
  evidence.push(...timestampMatches)
  matchScore += timestampMatches.length * 0.2

  // 3. Visual Similarity (patina, damage)
  const visualMatches = await matchByVisualSimilarity(sourceImages, listingImages, supabase)
  evidence.push(...visualMatches)
  matchScore += visualMatches.length * 0.4 // Visual matches are strongest

  // Normalize score to 0-1
  const normalizedScore = Math.min(1.0, matchScore / 3.0)

  return {
    vehicleId: sourceVehicle.id,
    matchScore: normalizedScore,
    evidence,
    shouldMerge: normalizedScore >= 0.7 // 70% confidence threshold
  }
}

/**
 * Match images by GPS coordinates
 * Images taken at same location (within 50 meters) are strong evidence
 */
async function matchByGPS(
  sourceImages: any[],
  listingImages: string[],
  supabase: any
): Promise<ImageMatchEvidence[]> {
  const evidence: ImageMatchEvidence[] = []

  // Extract GPS from listing images (need to download and extract EXIF)
  for (const listingImgUrl of listingImages.slice(0, 10)) { // Limit to first 10
    try {
      // Download listing image and extract EXIF
      const listingExif = await extractExifFromUrl(listingImgUrl)
      
      if (!listingExif?.latitude || !listingExif?.longitude) {
        continue
      }

      // Compare with source images
      for (const sourceImg of sourceImages) {
        const sourceLat = sourceImg.exif_data?.location?.latitude || sourceImg.latitude
        const sourceLon = sourceImg.exif_data?.location?.longitude || sourceImg.longitude

        if (!sourceLat || !sourceLon) continue

        // Calculate distance (Haversine formula)
        const distance = calculateDistance(
          sourceLat,
          sourceLon,
          listingExif.latitude,
          listingExif.longitude
        )

        // Within 50 meters = same location
        if (distance < 0.05) { // 50 meters in kilometers
          evidence.push({
            imageUrl: listingImgUrl,
            matchType: 'gps',
            confidence: 0.95,
            details: `Same GPS location (${distance * 1000}m apart) - ${sourceLat.toFixed(5)}, ${sourceLon.toFixed(5)}`
          })
        }
      }
    } catch (error) {
      console.error(`Error processing listing image ${listingImgUrl}:`, error)
    }
  }

  return evidence
}

/**
 * Match images by timestamp proximity
 * Images taken within same time frame (same day/week) are evidence
 */
async function matchByTimestamp(
  sourceImages: any[],
  listingImages: string[],
  supabase: any
): Promise<ImageMatchEvidence[]> {
  const evidence: ImageMatchEvidence[] = []

  for (const listingImgUrl of listingImages.slice(0, 10)) {
    try {
      const listingExif = await extractExifFromUrl(listingImgUrl)
      const listingDate = listingExif?.DateTimeOriginal || listingExif?.DateTime

      if (!listingDate) continue

      const listingTimestamp = new Date(listingDate).getTime()

      for (const sourceImg of sourceImages) {
        const sourceDate = sourceImg.taken_at || sourceImg.exif_data?.DateTimeOriginal
        if (!sourceDate) continue

        const sourceTimestamp = new Date(sourceDate).getTime()
        const timeDiff = Math.abs(listingTimestamp - sourceTimestamp)
        const daysDiff = timeDiff / (1000 * 60 * 60 * 24)

        // Same day = strong evidence, same week = moderate
        if (daysDiff < 1) {
          evidence.push({
            imageUrl: listingImgUrl,
            matchType: 'timestamp',
            confidence: 0.9,
            details: `Same day (${daysDiff.toFixed(1)} days apart)`
          })
        } else if (daysDiff < 7) {
          evidence.push({
            imageUrl: listingImgUrl,
            matchType: 'timestamp',
            confidence: 0.7,
            details: `Same week (${daysDiff.toFixed(1)} days apart)`
          })
        }
      }
    } catch (error) {
      console.error(`Error processing timestamp for ${listingImgUrl}:`, error)
    }
  }

  return evidence
}

/**
 * Match images by visual similarity (patina, damage patterns)
 * Uses AI to compare visual characteristics
 */
async function matchByVisualSimilarity(
  sourceImages: any[],
  listingImages: string[],
  supabase: any
): Promise<ImageMatchEvidence[]> {
  const evidence: ImageMatchEvidence[] = []

  // Use AI to analyze visual characteristics
  for (const listingImgUrl of listingImages.slice(0, 5)) { // Limit to 5 for cost
    try {
      // Analyze listing image for patina/damage characteristics
      const listingAnalysis = await analyzeImageForPatina(listingImgUrl, supabase)

      // Compare with source images
      for (const sourceImg of sourceImages.slice(0, 5)) {
        const sourceAnalysis = await analyzeImageForPatina(sourceImg.image_url, supabase)

        // Compare characteristics
        const similarity = comparePatinaCharacteristics(listingAnalysis, sourceAnalysis)

        if (similarity > 0.8) {
          evidence.push({
            imageUrl: listingImgUrl,
            matchType: 'patina',
            confidence: similarity,
            details: `Matching patina/damage patterns (${(similarity * 100).toFixed(0)}% similar)`
          })
        }
      }
    } catch (error) {
      console.error(`Error analyzing visual similarity for ${listingImgUrl}:`, error)
    }
  }

  return evidence
}

/**
 * Extract EXIF data from image URL
 */
async function extractExifFromUrl(imageUrl: string): Promise<any> {
  try {
    const response = await fetch(imageUrl)
    const buffer = await response.arrayBuffer()
    
    // Use exifr library (would need to be imported)
    // For now, return null - would need to implement EXIF extraction
    return null
  } catch (error) {
    console.error('Error extracting EXIF:', error)
    return null
  }
}

/**
 * Analyze image for patina and damage characteristics
 */
async function analyzeImageForPatina(imageUrl: string, supabase: any): Promise<any> {
  // Use AI to analyze image
  const { data } = await supabase.functions.invoke('analyze-image-contextual', {
    body: {
      imageUrl,
      analysisType: 'patina_damage'
    }
  })

  return data?.characteristics || {}
}

/**
 * Compare patina characteristics between two images
 */
function comparePatinaCharacteristics(analysis1: any, analysis2: any): number {
  // Simple comparison - would be enhanced with actual AI analysis
  let matches = 0
  let total = 0

  const characteristics = ['patina', 'rust', 'damage', 'scratches', 'dents', 'paint_condition']
  
  for (const char of characteristics) {
    if (analysis1[char] && analysis2[char]) {
      total++
      if (analysis1[char] === analysis2[char]) {
        matches++
      }
    }
  }

  return total > 0 ? matches / total : 0
}

/**
 * Calculate distance between two GPS coordinates (Haversine formula)
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Merge vehicles - combine data from listing into source vehicle
 */
async function mergeVehicles(
  sourceVehicleId: string,
  listingData: any,
  listingUrl: string,
  userId: string,
  evidence: ImageMatchEvidence[],
  supabase: any
): Promise<any> {
  // Update source vehicle with any new data from listing
  const updates: any = {}

  if (listingData.vin && !listingData.vin.startsWith('VIVA-')) {
    updates.vin = listingData.vin
  }
  if (listingData.price) {
    updates.asking_price = listingData.price
  }
  if (listingData.mileage) {
    updates.mileage = listingData.mileage
  }

  if (Object.keys(updates).length > 0) {
    await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', sourceVehicleId)
  }

  // Download and add listing images to source vehicle
  for (const imgUrl of listingData.images?.slice(0, 20) || []) {
    try {
      await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: sourceVehicleId,
          image_url: imgUrl,
          uploaded_by: userId,
          source: 'listing_merge',
          metadata: {
            listing_url: listingUrl,
            merge_evidence: evidence
          }
        })
    } catch (error) {
      console.error(`Error adding image ${imgUrl}:`, error)
    }
  }

  // Create timeline event documenting the merge
  await supabase
    .from('timeline_events')
    .insert({
      vehicle_id: sourceVehicleId,
      user_id: userId,
      event_type: 'other',
      source: 'vehicle_merge',
      title: 'Vehicle profile merged with listing',
      description: `Merged with listing from ${listingUrl} based on image matching evidence`,
      event_date: new Date().toISOString().split('T')[0],
      metadata: {
        listing_url: listingUrl,
        merge_evidence: evidence,
        match_score: evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length
      }
    })

  return {
    vehicleId: sourceVehicleId,
    imagesAdded: listingData.images?.length || 0,
    updatesApplied: Object.keys(updates).length
  }
}

