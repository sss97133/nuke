import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TagWebRequest {
  vehicle_id: string;
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

    const { vehicle_id }: TagWebRequest = await req.json()

    console.log(`🕸️ Building tag web analysis for vehicle: ${vehicle_id}`);

    // Get all image tags for this vehicle with AI detection data
    const { data: imageTags, error: tagsError } = await supabase
      .from('image_tags')
      .select(`
        *,
        vehicle_images!inner(image_url, vehicle_id)
      `)
      .eq('vehicle_images.vehicle_id', vehicle_id)
      .not('ai_detection_data', 'is', null)

    if (tagsError) {
      throw new Error(`Failed to load image tags: ${tagsError.message}`)
    }

    if (!imageTags || imageTags.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No AI tags found for analysis",
          web_data: {
            label_counts: {},
            confidence_scores: {},
            relationships: {},
            categories: {},
            total_detections: 0,
            images_analyzed: 0
          },
          tag_strength: {},
          recommendations: [
            "Upload more images to build tag web",
            "Enable AI analysis on image upload",
            "Add manual tags to complement AI detection"
          ]
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build comprehensive tag web
    const webData = buildTagWeb(imageTags)
    const tagStrength = calculateTagStrength(webData)
    const insights = generateInsights(webData, tagStrength)

    return new Response(
      JSON.stringify({
        success: true,
        web_data: webData,
        tag_strength: tagStrength,
        insights: insights,
        analyzed_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Tag web analysis error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function buildTagWeb(imageTags: any[]) {
  const labelCounts: Record<string, number> = {}
  const confidenceScores: Record<string, number[]> = {}
  const relationships: Record<string, string[]> = {}
  const categories: Record<string, string[]> = {}
  const bboxData: Record<string, any[]> = {}

  const uniqueImages = new Set()

  imageTags.forEach(tag => {
    const tagName = tag.tag_name
    const confidence = tag.automated_confidence || tag.confidence || 0
    const aiData = tag.ai_detection_data || {}
    const imageUrl = tag.vehicle_images?.image_url

    if (imageUrl) uniqueImages.add(imageUrl)

    // Count occurrences
    labelCounts[tagName] = (labelCounts[tagName] || 0) + 1

    // Track confidence scores
    if (!confidenceScores[tagName]) {
      confidenceScores[tagName] = []
    }
    confidenceScores[tagName].push(confidence)

    // Extract parent relationships from Rekognition data
    if (aiData.rekognition_parents) {
      aiData.rekognition_parents.forEach((parent: any) => {
        if (!relationships[parent.Name]) {
          relationships[parent.Name] = []
        }
        if (!relationships[parent.Name].includes(tagName)) {
          relationships[parent.Name].push(tagName)
        }
      })
    }

    // Extract categories from Rekognition data
    if (aiData.rekognition_categories) {
      aiData.rekognition_categories.forEach((category: any) => {
        if (!categories[category.Name]) {
          categories[category.Name] = []
        }
        if (!categories[category.Name].includes(tagName)) {
          categories[category.Name].push(tagName)
        }
      })
    }

    // Store bounding box data
    if (tag.x_position !== null && tag.y_position !== null) {
      if (!bboxData[tagName]) {
        bboxData[tagName] = []
      }
      bboxData[tagName].push({
        bbox: {
          x: tag.x_position,
          y: tag.y_position,
          width: tag.width || 0,
          height: tag.height || 0
        },
        confidence: confidence,
        image_url: imageUrl
      })
    }
  })

  return {
    label_counts: labelCounts,
    confidence_scores: confidenceScores,
    relationships: relationships,
    categories: categories,
    bounding_boxes: bboxData,
    total_detections: imageTags.length,
    images_analyzed: uniqueImages.size
  }
}

function calculateTagStrength(webData: any) {
  const tagStrength: Record<string, any> = {}

  Object.entries(webData.label_counts).forEach(([label, count]: [string, any]) => {
    const confidences = webData.confidence_scores[label] || []
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length
      : 0

    const frequency = Math.min(count / webData.images_analyzed, 1.0)
    const strengthScore = (frequency * 0.6) + (avgConfidence / 100 * 0.4)

    tagStrength[label] = {
      count: count,
      frequency: frequency,
      avg_confidence: avgConfidence,
      strength_score: strengthScore
    }
  })

  return tagStrength
}

function generateInsights(webData: any, tagStrength: any) {
  const insights = {
    total_tags: Object.keys(webData.label_counts).length,
    strongest_tags: Object.entries(tagStrength)
      .sort(([,a]: [any,any], [,b]: [any,any]) => b.strength_score - a.strength_score)
      .slice(0, 5)
      .map(([label, metrics]: [any,any]) => ({ label, strength: metrics.strength_score * 100 })),

    category_distribution: Object.entries(webData.categories)
      .map(([category, labels]: [any,any]) => ({
        category,
        count: labels.length,
        total_detections: labels.reduce((sum: number, label: string) =>
          sum + (webData.label_counts[label] || 0), 0)
      }))
      .sort((a, b) => b.total_detections - a.total_detections),

    weak_tags: Object.entries(tagStrength)
      .filter(([, metrics]: [any,any]) => metrics.count === 1 && metrics.avg_confidence < 80)
      .length,

    automotive_tags: Object.keys(tagStrength)
      .filter(label => {
        const auto_terms = ['car', 'truck', 'wheel', 'tire', 'engine', 'brake', 'axle', 'transmission', 'differential']
        return auto_terms.some(term => label.toLowerCase().includes(term))
      })
      .length,

    recommendations: []
  }

  // Generate recommendations
  if (insights.weak_tags > 20) {
    insights.recommendations.push(`${insights.weak_tags} weak tags detected - consider manual validation`)
  }

  if (webData.images_analyzed < 10) {
    insights.recommendations.push("Upload more images to improve tag web analysis")
  }

  if (insights.automotive_tags < 5) {
    insights.recommendations.push("Add more automotive-specific images (engine bay, wheels, interior)")
  }

  const highConfidenceTags = Object.values(tagStrength)
    .filter((metrics: any) => metrics.avg_confidence > 90).length

  if (highConfidenceTags > 10) {
    insights.recommendations.push("Excellent AI detection quality - ready for advanced analysis")
  }

  return insights
}