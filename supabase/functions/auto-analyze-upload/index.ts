import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { RekognitionClient, DetectLabelsCommand } from "npm:@aws-sdk/client-rekognition"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface UploadAnalysisRequest {
  image_url: string;
  vehicle_id: string;
  timeline_event_id?: string;
  trigger_source: 'upload' | 'manual' | 'batch';
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

    const { image_url, vehicle_id, timeline_event_id, trigger_source }: UploadAnalysisRequest = await req.json()

    console.log(`🔍 Auto-analyzing image upload: ${image_url} for vehicle ${vehicle_id}`)

    // Check if already analyzed recently
    const { data: existingAnalysis } = await supabase
      .from('image_analysis_cache')
      .select('*')
      .eq('image_url', image_url)
      .single()

    let analysisResult: any;

    if (existingAnalysis &&
        new Date(existingAnalysis.last_analyzed) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
      console.log('📋 Using cached analysis (less than 7 days old)')
      analysisResult = existingAnalysis.rekognition_data
    } else {
      console.log('🤖 Running fresh AI analysis')
      analysisResult = await analyzeImageWithRekognition(image_url)

      // Cache the results
      await supabase
        .from('image_analysis_cache')
        .upsert({
          image_url: image_url,
          rekognition_data: analysisResult,
          last_analyzed: new Date().toISOString(),
          analysis_version: 1
        })
    }

    // Generate AI tags from analysis
    const aiTags = await generateAITags(analysisResult, image_url, vehicle_id, timeline_event_id)

    // Insert AI tags into database
    const insertedTags = await insertAITags(supabase, aiTags)

    console.log(`✅ Auto-analysis complete: ${insertedTags.length} AI tags created`)

    return new Response(
      JSON.stringify({
        success: true,
        source: existingAnalysis ? 'cache' : 'fresh_analysis',
        tags_created: insertedTags.length,
        tags: aiTags,
        trigger_source,
        analysis_timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Auto-analysis error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function analyzeImageWithRekognition(imageUrl: string) {
  const region = Deno.env.get('AWS_REGION') || 'us-east-1'
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY')

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured')
  }

  // Download image
  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image: ${imageResponse.status}`)
  }
  const imageBytes = new Uint8Array(await imageResponse.arrayBuffer())

  const client = new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey }
  })

  const command = new DetectLabelsCommand({
    Image: { Bytes: imageBytes },
    MaxLabels: 50,
    MinConfidence: 60
  })

  const result = await client.send(command)
  return result
}

async function generateAITags(rekognitionData: any, imageUrl: string, vehicleId: string, timelineEventId?: string) {
  if (!rekognitionData.Labels) return []

  const tags = []

  // Enhanced automotive mapping with confidence adjustments
  const automotiveMapping: { [key: string]: { type: string, mappedName: string, confidenceBoost: number } } = {
    // Vehicle parts - high priority
    'Car': { type: 'part', mappedName: 'Vehicle', confidenceBoost: 0.1 },
    'Automobile': { type: 'part', mappedName: 'Vehicle', confidenceBoost: 0.1 },
    'Truck': { type: 'part', mappedName: 'Truck', confidenceBoost: 0.15 },
    'Engine': { type: 'part', mappedName: 'Engine', confidenceBoost: 0.2 },
    'Wheel': { type: 'part', mappedName: 'Wheel', confidenceBoost: 0.15 },
    'Tire': { type: 'part', mappedName: 'Tire', confidenceBoost: 0.1 },
    'Bumper': { type: 'part', mappedName: 'Bumper', confidenceBoost: 0.1 },
    'Headlight': { type: 'part', mappedName: 'Headlight', confidenceBoost: 0.15 },
    'Taillight': { type: 'part', mappedName: 'Taillight', confidenceBoost: 0.15 },
    'Door': { type: 'part', mappedName: 'Door', confidenceBoost: 0.1 },
    'Hood': { type: 'part', mappedName: 'Hood', confidenceBoost: 0.1 },
    'Windshield': { type: 'part', mappedName: 'Windshield', confidenceBoost: 0.1 },
    'Grille': { type: 'part', mappedName: 'Grille', confidenceBoost: 0.1 },
    'Exhaust': { type: 'part', mappedName: 'Exhaust', confidenceBoost: 0.15 },
    'Brake': { type: 'part', mappedName: 'Brake', confidenceBoost: 0.2 },

    // Tools - medium priority
    'Wrench': { type: 'tool', mappedName: 'Wrench', confidenceBoost: 0.1 },
    'Screwdriver': { type: 'tool', mappedName: 'Screwdriver', confidenceBoost: 0.1 },
    'Hammer': { type: 'tool', mappedName: 'Hammer', confidenceBoost: 0.05 },
    'Drill': { type: 'tool', mappedName: 'Drill', confidenceBoost: 0.1 },
    'Jack': { type: 'tool', mappedName: 'Jack', confidenceBoost: 0.15 },
    'Tool': { type: 'tool', mappedName: 'Tool', confidenceBoost: 0.05 },

    // Issues - high priority for maintenance tracking
    'Rust': { type: 'issue', mappedName: 'Rust', confidenceBoost: 0.2 },
    'Damage': { type: 'issue', mappedName: 'Damage', confidenceBoost: 0.15 },
    'Crack': { type: 'issue', mappedName: 'Crack', confidenceBoost: 0.2 },
    'Dent': { type: 'issue', mappedName: 'Dent', confidenceBoost: 0.15 },
    'Scratch': { type: 'issue', mappedName: 'Scratch', confidenceBoost: 0.1 },

    // Processes
    'Repair': { type: 'process', mappedName: 'Repair', confidenceBoost: 0.1 },
    'Welding': { type: 'process', mappedName: 'Welding', confidenceBoost: 0.15 },
    'Painting': { type: 'process', mappedName: 'Painting', confidenceBoost: 0.1 }
  }

  rekognitionData.Labels.forEach((label: any) => {
    const mapping = automotiveMapping[label.Name]

    if (mapping) {
      // Adjust confidence with automotive context boost
      const adjustedConfidence = Math.min(label.Confidence + (mapping.confidenceBoost * 100), 100)

      if (adjustedConfidence >= 65) {
        if (label.Instances && label.Instances.length > 0) {
          // Create tags for each detected instance with bounding boxes
          label.Instances.forEach((instance: any, index: number) => {
            if (instance.Confidence >= 60) {
              tags.push({
                image_url: imageUrl,
                vehicle_id: vehicleId,
                timeline_event_id: timelineEventId,
                tag_name: mapping.mappedName,
                tag_type: mapping.type,
                source_type: 'ai',
                confidence: Math.round(adjustedConfidence),
                automated_confidence: Math.round(instance.Confidence),
                // Store as integers (percent) so dedupe/unique keys are stable.
                x_position: Math.round(instance.BoundingBox.Left * 100),
                y_position: Math.round(instance.BoundingBox.Top * 100),
                width: Math.round(instance.BoundingBox.Width * 100),
                height: Math.round(instance.BoundingBox.Height * 100),
                verified: false,
                validation_status: 'pending',
                ai_detection_data: {
                  rekognition_label: label.Name,
                  rekognition_confidence: label.Confidence,
                  adjusted_confidence: adjustedConfidence,
                  instance_index: index,
                  categories: label.Categories || [],
                  detection_timestamp: new Date().toISOString(),
                  model_version: 'rekognition-v3.0'
                }
              })
            }
          })
        } else {
          // Create a general tag without specific location
          tags.push({
            image_url: imageUrl,
            vehicle_id: vehicleId,
            timeline_event_id: timelineEventId,
            tag_name: mapping.mappedName,
            tag_type: mapping.type,
            source_type: 'ai',
            confidence: Math.round(adjustedConfidence),
            automated_confidence: Math.round(label.Confidence),
            x_position: 50, // Center of image
            y_position: 50,
            width: 20,
            height: 20,
            verified: false,
            validation_status: 'pending',
            ai_detection_data: {
              rekognition_label: label.Name,
              rekognition_confidence: label.Confidence,
              adjusted_confidence: adjustedConfidence,
              categories: label.Categories || [],
              detection_timestamp: new Date().toISOString(),
              model_version: 'rekognition-v3.0'
            }
          })
        }
      }
    }
  })

  return tags
}

async function insertAITags(supabase: any, tags: any[]) {
  if (tags.length === 0) return []

  // Insert tags with upsert to handle duplicates
  const { data, error } = await supabase
    .from('image_tags')
    .upsert(tags, {
      onConflict: 'image_url,tag_name,x_position,y_position',
      ignoreDuplicates: false
    })
    .select()

  if (error) {
    console.error('Error inserting AI tags:', error)
    throw error
  }

  return data || []
}