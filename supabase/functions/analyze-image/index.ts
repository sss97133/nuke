import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { RekognitionClient, DetectLabelsCommand } from "npm:@aws-sdk/client-rekognition"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ... (Interfaces remain same)

serve(async (req) => {
  // ... (CORS and Setup remain same)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { image_url, timeline_event_id, vehicle_id } = await req.json()
    if (!image_url) throw new Error('Missing image_url')

    // 1. Run Rekognition (Label Detection)
    const rekognitionData = await analyzeImageWithRekognition(image_url)

    // 2. Determine "Appraiser Context" from labels
    const context = determineAppraiserContext(rekognitionData)
    
    // 3. Run OpenAI Vision "Appraiser Brain" if context is found
    let appraiserResult = null
    if (context) {
      appraiserResult = await runAppraiserBrain(image_url, context)
    }

    // 3.5. Check for SPID sheet and extract data if found
    let spidData = null
    let spidResponse = null
    try {
      spidResponse = await detectSPIDSheet(image_url, vehicle_id)
      if (spidResponse?.is_spid_sheet && spidResponse.confidence > 70) {
        spidData = spidResponse.extracted_data
        console.log('SPID sheet detected:', spidData)
      }
    } catch (err) {
      console.warn('SPID detection failed:', err)
      // Don't fail the whole analysis if SPID detection fails
    }

    // 4. Generate Tags
    const automatedTags = generateAutomatedTags(rekognitionData)

    // 5. Save Everything
    // Update image metadata with appraiser result and SPID data
    const metadataUpdate: any = {
      rekognition: rekognitionData,
      scanned_at: new Date().toISOString()
    }
    if (appraiserResult) {
      metadataUpdate.appraiser = appraiserResult
    }
    if (spidData) {
      metadataUpdate.spid = spidData
    }
    
    // Update image record
    const { data: imageRecord } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('image_url', image_url)
      .maybeSingle()
    
    if (imageRecord) {
      await supabase
        .from('vehicle_images')
        .update({ ai_scan_metadata: metadataUpdate })
        .eq('id', imageRecord.id)
      
      // If SPID data was extracted, also save to dedicated table
      if (spidData && spidResponse && vehicle_id) {
        if (spidResponse.is_spid_sheet && spidResponse.confidence > 70) {
          const extracted = spidResponse.extracted_data
          
          // Upsert SPID data to dedicated table
          await supabase
            .from('vehicle_spid_data')
            .upsert({
              vehicle_id: vehicle_id,
              image_id: imageRecord.id,
              vin: extracted.vin || null,
              build_date: extracted.build_date || null,
              paint_code_exterior: extracted.paint_code_exterior || null,
              paint_code_interior: extracted.paint_code_interior || null,
              engine_code: extracted.engine_code || null,
              transmission_code: extracted.transmission_code || null,
              axle_ratio: extracted.axle_ratio || null,
              rpo_codes: extracted.rpo_codes || [],
              extraction_confidence: spidResponse.confidence,
              raw_extracted_text: spidResponse.raw_text || null,
              extraction_method: 'ai_vision',
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'vehicle_id',
              ignoreDuplicates: false
            })
          
          // If VIN was extracted and vehicle doesn't have one, update vehicle record
          if (extracted.vin) {
            const { data: vehicle } = await supabase
              .from('vehicles')
              .select('vin')
              .eq('id', vehicle_id)
              .maybeSingle()
            
            if (vehicle && !vehicle.vin) {
              await supabase
                .from('vehicles')
                .update({ vin: extracted.vin })
                .eq('id', vehicle_id)
            }
          }
        }
      }
    }

    // Insert automated tags
    await insertAutomatedTags(supabase, automatedTags, image_url, timeline_event_id, vehicle_id)

    return new Response(
      JSON.stringify({
        success: true,
        tags: automatedTags,
        appraisal: appraiserResult
      }),
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

// ... (Helper functions for Rekognition and Tags remain, I will add the new Appraiser logic below)

function determineAppraiserContext(rekognitionData: any): string | null {
  const labels = rekognitionData.Labels?.map((l: any) => l.Name.toLowerCase()) || []
  
  if (labels.includes('engine') || labels.includes('engine control unit')) return 'engine'
  if (labels.includes('interior') || labels.includes('seat') || labels.includes('dashboard')) return 'interior'
  if (labels.includes('undercarriage') || labels.includes('suspension') || labels.includes('chassis')) return 'undercarriage'
  if (labels.includes('vehicle') || labels.includes('car') || labels.includes('truck')) return 'exterior'
  
  return null
}

async function detectSPIDSheet(imageUrl: string, vehicleId?: string) {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiKey) return null

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a GM SPID (Service Parts Identification) sheet expert. Analyze images to detect and extract data from SPID sheets.

SPID sheets are labels found on GM vehicles (usually on the glove box or center console) that contain:
- VIN (17-character alphanumeric)
- Build date and sequence number
- Paint codes (exterior and interior trim codes)
- RPO codes (3-character option codes like G80, KC4, etc.)
- Engine code (e.g., L31, LT1, LS1)
- Transmission code (e.g., 4L60E, TH400)
- Rear axle ratio (e.g., 3.73, 4.10)

Return a JSON object with:
{
  "is_spid_sheet": boolean,
  "confidence": number (0-100),
  "extracted_data": {
    "vin": string | null,
    "build_date": string | null,
    "paint_code_exterior": string | null,
    "paint_code_interior": string | null,
    "rpo_codes": string[],
    "engine_code": string | null,
    "transmission_code": string | null,
    "axle_ratio": string | null
  },
  "raw_text": string
}`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this image. Is it a GM SPID sheet? If yes, extract all visible data.'
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    })
  })

  if (!response.ok) return null

  const data = await response.json()
  if (data.error) return null

  try {
    return JSON.parse(data.choices[0].message.content)
  } catch {
    return null
  }
}

async function runAppraiserBrain(imageUrl: string, context: string) {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiKey) return null

  const questionnaires = {
    engine: `
      Answer these Yes/No questions about the engine bay:
      1. is_stock: Does it appear completely stock?
      2. is_clean: Is the engine bay detailed/clean?
      3. has_visible_leaks: Are there wet spots or oil residue?
      4. wiring_quality: Is wiring tidy and professional? (Yes/No)
      5. rust_presence: Is there visible corrosion on shock towers or firewall?
    `,
    interior: `
      Answer these Yes/No questions about the interior:
      1. seats_good_condition: Are seats free of rips/tears?
      2. dash_cracks: Are there cracks in the dashboard?
      3. stock_radio: Is the radio stock/original?
      4. manual_transmission: Is it a manual stick shift?
      5. carpets_clean: Are carpets clean and unstained?
    `,
    undercarriage: `
      Answer these Yes/No questions about the undercarriage:
      1. heavy_rust: Is there structural rust or heavy scaling?
      2. recent_work: Are there shiny/new suspension parts?
      3. leaks_detected: Are there drips or wet areas?
      4. exhaust_condition: Does the exhaust look intact/rust-free?
    `,
    exterior: `
      Answer these Yes/No questions about the exterior:
      1. body_straight: Are panels straight with even gaps?
      2. paint_glossy: Is the paint finish glossy/consistent?
      3. visible_damage: Are there dents, scratches, or rust spots?
      4. modifications: Are there aftermarket wheels, lift, or body kits?
    `
  }

  const prompt = questionnaires[context as keyof typeof questionnaires] || questionnaires.exterior

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini", // Vision model
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Act as a professional vehicle appraiser. ${prompt}. Return ONLY a JSON object with boolean values for these keys.` },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 300
    })
  })

  if (!response.ok) return null

  const data = await response.json()
  const content = data.choices[0].message?.content
  
  try {
    // extract JSON from markdown block if present
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    return JSON.parse(jsonMatch ? jsonMatch[0] : content)
  } catch {
    return { raw_analysis: content }
  }
}


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