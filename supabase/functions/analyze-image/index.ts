import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { RekognitionClient, DetectLabelsCommand } from "npm:@aws-sdk/client-rekognition"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RekognitionLabel {
  Name: string;
  Confidence: number;
  Instances?: Array<{
    BoundingBox: {
      Width: number;
      Height: number;
      Left: number;
      Top: number;
    };
    Confidence: number;
  }>;
  Categories?: Array<{
    Name: string;
  }>;
}

interface AutomatedTag {
  tag_name: string;
  tag_type: 'part' | 'tool' | 'brand' | 'process' | 'issue' | 'custom';
  confidence: number;
  x_position: number;
  y_position: number;
  width: number;
  height: number;
  ai_detection_data: any;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      // Use service role for server-side writes that must bypass RLS
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    )

    const { image_url, timeline_event_id, vehicle_id } = await req.json()

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: 'Missing image_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if we've already analyzed this image
    const { data: existingAnalysis } = await supabase
      .from('image_analysis_cache')
      .select('*')
      .eq('image_url', image_url)
      .single()

    if (existingAnalysis &&
        existingAnalysis.last_analyzed &&
        new Date(existingAnalysis.last_analyzed) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {

      // Use cached analysis if less than 7 days old
      console.log('Using cached analysis for:', image_url)

      const automatedTags = generateAutomatedTags(existingAnalysis.rekognition_data)
      await insertAutomatedTags(supabase, automatedTags, image_url, timeline_event_id, vehicle_id)

      return new Response(
        JSON.stringify({
          success: true,
          tags: automatedTags,
          source: 'cache'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Call AWS Rekognition
    const rekognitionData = await analyzeImageWithRekognition(image_url)

    // Store analysis in cache
    await supabase
      .from('image_analysis_cache')
      .upsert({
        image_url: image_url,
        rekognition_data: rekognitionData,
        last_analyzed: new Date().toISOString(),
        analysis_version: 1
      })

    // Generate automated tags from Rekognition results
    const automatedTags = generateAutomatedTags(rekognitionData)

    // Insert automated tags into database
    await insertAutomatedTags(supabase, automatedTags, image_url, timeline_event_id, vehicle_id)

    return new Response(
      JSON.stringify({
        success: true,
        tags: automatedTags,
        source: 'rekognition'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error analyzing image:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function analyzeImageWithRekognition(imageUrl: string) {
  const region = Deno.env.get('AWS_REGION') || 'us-east-1'
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY')
  const sessionToken = Deno.env.get('AWS_SESSION_TOKEN') || undefined

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured')
  }

  // Download image to analyze
  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image: ${imageResponse.status} ${imageResponse.statusText}`)
  }
  const imageBytes = new Uint8Array(await imageResponse.arrayBuffer())

  // Use AWS SDK v3 for proper SigV4 handling
  const client = new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey, sessionToken }
  })

  const command = new DetectLabelsCommand({
    Image: { Bytes: imageBytes },
    MaxLabels: 50,
    MinConfidence: 60
  })

  const result = await client.send(command)
  return result
}

function generateAutomatedTags(rekognitionData: any): AutomatedTag[] {
  const tags: AutomatedTag[] = []

  if (!rekognitionData.Labels) return tags

  // Automotive-specific label mapping
  const automotiveMapping: { [key: string]: { type: string, mappedName: string } } = {
    // Vehicle parts
    'Car': { type: 'part', mappedName: 'Vehicle' },
    'Automobile': { type: 'part', mappedName: 'Vehicle' },
    'Truck': { type: 'part', mappedName: 'Truck' },
    'Engine': { type: 'part', mappedName: 'Engine' },
    'Wheel': { type: 'part', mappedName: 'Wheel' },
    'Tire': { type: 'part', mappedName: 'Tire' },
    'Bumper': { type: 'part', mappedName: 'Bumper' },
    'Headlight': { type: 'part', mappedName: 'Headlight' },
    'Taillight': { type: 'part', mappedName: 'Taillight' },
    'Door': { type: 'part', mappedName: 'Door' },
    'Hood': { type: 'part', mappedName: 'Hood' },
    'Windshield': { type: 'part', mappedName: 'Windshield' },
    'Mirror': { type: 'part', mappedName: 'Mirror' },
    'Grille': { type: 'part', mappedName: 'Grille' },
    'Exhaust': { type: 'part', mappedName: 'Exhaust' },
    'Brake': { type: 'part', mappedName: 'Brake' },
    'Suspension': { type: 'part', mappedName: 'Suspension' },
    'Transmission': { type: 'part', mappedName: 'Transmission' },
    'Radiator': { type: 'part', mappedName: 'Radiator' },
    'Battery': { type: 'part', mappedName: 'Battery' },

    // Tools
    'Wrench': { type: 'tool', mappedName: 'Wrench' },
    'Screwdriver': { type: 'tool', mappedName: 'Screwdriver' },
    'Hammer': { type: 'tool', mappedName: 'Hammer' },
    'Drill': { type: 'tool', mappedName: 'Drill' },
    'Jack': { type: 'tool', mappedName: 'Jack' },
    'Tool': { type: 'tool', mappedName: 'Tool' },
    'Equipment': { type: 'tool', mappedName: 'Equipment' },
    'Machine': { type: 'tool', mappedName: 'Machine' },

    // Processes/Activities
    'Repair': { type: 'process', mappedName: 'Repair' },
    'Maintenance': { type: 'process', mappedName: 'Maintenance' },
    'Installation': { type: 'process', mappedName: 'Installation' },
    'Welding': { type: 'process', mappedName: 'Welding' },
    'Painting': { type: 'process', mappedName: 'Painting' },
    'Assembly': { type: 'process', mappedName: 'Assembly' },

    // Issues/Damage
    'Rust': { type: 'issue', mappedName: 'Rust' },
    'Damage': { type: 'issue', mappedName: 'Damage' },
    'Crack': { type: 'issue', mappedName: 'Crack' },
    'Dent': { type: 'issue', mappedName: 'Dent' },
    'Scratch': { type: 'issue', mappedName: 'Scratch' },
    'Wear': { type: 'issue', mappedName: 'Wear' }
  }

  rekognitionData.Labels.forEach((label: RekognitionLabel) => {
    const mapping = automotiveMapping[label.Name]

    if (mapping && label.Confidence >= 70) {
      if (label.Instances && label.Instances.length > 0) {
        // Create tags for each detected instance with bounding boxes
        label.Instances.forEach((instance, index) => {
          if (instance.Confidence >= 60) {
            tags.push({
              tag_name: mapping.mappedName,
              tag_type: mapping.type as any,
              confidence: Math.round(instance.Confidence),
              x_position: instance.BoundingBox.Left * 100,
              y_position: instance.BoundingBox.Top * 100,
              width: instance.BoundingBox.Width * 100,
              height: instance.BoundingBox.Height * 100,
              ai_detection_data: {
                rekognition_label: label.Name,
                rekognition_confidence: label.Confidence,
                instance_index: index,
                categories: label.Categories || []
              }
            })
          }
        })
      } else {
        // Create a general tag without specific location
        tags.push({
          tag_name: mapping.mappedName,
          tag_type: mapping.type as any,
          confidence: Math.round(label.Confidence),
          x_position: 50, // Center of image
          y_position: 50,
          width: 20,
          height: 20,
          ai_detection_data: {
            rekognition_label: label.Name,
            rekognition_confidence: label.Confidence,
            categories: label.Categories || []
          }
        })
      }
    }
  })

  return tags
}

async function insertAutomatedTags(
  supabase: any,
  tags: AutomatedTag[],
  imageUrl: string,
  timelineEventId?: string,
  vehicleId?: string
) {
  if (tags.length === 0) return

  const tagData = tags.map(tag => ({
    image_url: imageUrl,
    timeline_event_id: timelineEventId,
    vehicle_id: vehicleId,
    tag_name: tag.tag_name,
    tag_type: tag.tag_type,
    x_position: tag.x_position,
    y_position: tag.y_position,
    width: tag.width,
    height: tag.height,
    confidence: tag.confidence,
    created_by: '00000000-0000-0000-0000-000000000000', // System user
    verified: false, // AI tags need verification
    ai_detection_data: tag.ai_detection_data,
    manual_override: false
  }))

  // Insert tags, ignore conflicts (don't overwrite existing manual tags)
  const { error } = await supabase
    .from('image_tags')
    .upsert(tagData, {
      onConflict: 'image_url,tag_name,x_position,y_position',
      ignoreDuplicates: true
    })

  if (error) {
    console.error('Error inserting automated tags:', error)
    throw error
  }
}