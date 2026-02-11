/**
 * DEPRECATED: analyze-image-contextual
 * 
 * This function is DEPRECATED. Use `analyze-image` instead.
 * 
 * Context awareness is now built into the main analyze-image function.
 * It automatically loads vehicle context when vehicle_id is provided.
 * 
 * Migration: Replace calls to this function with:
 *   supabase.functions.invoke('analyze-image', {
 *     body: { image_url, vehicle_id, image_id }
 *   })
 * 
 * ORIGINAL PURPOSE (now in analyze-image):
 * 1. Loads vehicle context (year/make/model, specs)
 * 2. Loads existing documentation (receipts, manuals, work history)  
 * 3. Creates context-aware analysis
 * 4. Avoids wasting tokens on vague questions
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { RekognitionClient, DetectLabelsCommand } from "npm:@aws-sdk/client-rekognition"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface VehicleContext {
  vehicle: {
    id: string
    year: number
    make: string
    model: string
    trim?: string
    engine?: string
    transmission?: string
    mileage?: number
    color?: string
    vin?: string
    owner_id?: string
  }
  owner?: {
    name: string
    location?: string
  }
  specs?: {
    engine_type?: string
    displacement?: string
    horsepower?: number
    transmission_type?: string
    drivetrain?: string
    factory_options?: string[]
  }
  workHistory: Array<{
    date: string
    description: string
    category: string
    parts_used?: string[]
    labor_hours?: number
    cost?: number
  }>
  receipts: Array<{
    date: string
    vendor: string
    items: string[]
    total: number
  }>
  knownModifications: string[]
  knownIssues: string[]
  recentWork: string[]
}

interface AnalysisContext {
  vehicleContext: VehicleContext
  imageCategory: string
  imageAngle?: string
  previousAnalysis?: any
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const paused = (() => {
      const v = String(Deno.env.get('NUKE_ANALYSIS_PAUSED') || '').trim().toLowerCase()
      return v === '1' || v === 'true' || v === 'yes' || v === 'on'
    })()
    if (paused) {
      return new Response(JSON.stringify({
        success: false,
        paused: true,
        message: 'Contextual analysis paused (NUKE_ANALYSIS_PAUSED)'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { image_url, vehicle_id, image_id, reprocess } = await req.json()
    if (!image_url || !vehicle_id) throw new Error('Missing required parameters')

    console.log(`Analyzing image ${image_id} for vehicle ${vehicle_id} (reprocess: ${reprocess})`)

    // STEP 1: Load full vehicle context
    const context = await loadVehicleContext(supabase, vehicle_id)
    
    // STEP 2: Determine image type/angle
    const rekognitionData = await analyzeImageWithRekognition(image_url)
    const imageType = determineImageType(rekognitionData)
    
    // STEP 3: Create context-aware questionnaire
    const questionnaire = createContextualQuestionnaire(context, imageType, rekognitionData)
    
    // STEP 4: Run targeted OpenAI analysis
    const analysis = await runContextualAnalysis(image_url, questionnaire, context)
    
    // STEP 5: Extract actionable insights
    const insights = extractInsights(analysis, context, rekognitionData)
    
    // STEP 6: Generate tags
    const tags = generateContextualTags(rekognitionData, analysis, context)
    
    // STEP 7: Save everything
    const metadata = {
      rekognition: rekognitionData,
      contextual_analysis: analysis,
      insights: insights,
      context_used: {
        year: context.vehicle.year,
        make: context.vehicle.make,
        model: context.vehicle.model,
        work_history_count: context.workHistory.length,
        receipts_count: context.receipts.length,
        known_mods_count: context.knownModifications.length
      },
      questionnaire_type: imageType,
      scanned_at: new Date().toISOString(),
      reprocessed: reprocess || false
    }

    if (image_id) {
      await supabase
        .from('vehicle_images')
        .update({ 
          ai_scan_metadata: metadata,
          category: imageType 
        })
        .eq('id', image_id)
    }

    // Insert tags
    await insertContextualTags(supabase, tags, image_url, vehicle_id)

    return new Response(
      JSON.stringify({
        success: true,
        analysis,
        insights,
        tags: tags.length,
        context_summary: {
          vehicle: `${context.vehicle.year} ${context.vehicle.make} ${context.vehicle.model}`,
          work_history_items: context.workHistory.length,
          receipts: context.receipts.length,
          modifications: context.knownModifications.length
        }
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

async function loadVehicleContext(supabase: any, vehicleId: string): Promise<VehicleContext> {
  // Load vehicle basic info
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single()

  // Load owner info
  const { data: owner } = await supabase
    .from('profiles')
    .select('display_name, location')
    .eq('id', vehicle.owner_id)
    .single()

  // Load work history from timeline
  const { data: timeline } = await supabase
    .from('timeline_events')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .in('event_type', ['maintenance', 'repair', 'modification', 'upgrade'])
    .order('event_date', { ascending: false })
    .limit(50)

  // Load receipts
  const { data: receipts } = await supabase
    .from('receipts')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('purchase_date', { ascending: false })
    .limit(50)

  // Load SPID data if available
  const { data: spidData } = await supabase
    .from('vehicle_spid_data')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .maybeSingle()

  // Extract known modifications from timeline
  const knownModifications = timeline
    ?.filter((e: any) => e.event_type === 'modification' || e.event_type === 'upgrade')
    .map((e: any) => e.description) || []

  // Extract recent work (last 6 months)
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const recentWork = timeline
    ?.filter((e: any) => new Date(e.event_date) > sixMonthsAgo)
    .map((e: any) => e.description) || []

  return {
    vehicle: {
      id: vehicle.id,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      engine: vehicle.engine,
      transmission: vehicle.transmission,
      mileage: vehicle.mileage,
      color: vehicle.color,
      vin: vehicle.vin,
      owner_id: vehicle.owner_id
    },
    owner: owner ? {
      name: owner.display_name,
      location: owner.location
    } : undefined,
    specs: spidData ? {
      engine_type: spidData.engine_code,
      transmission_type: spidData.transmission_code,
      factory_options: spidData.rpo_codes
    } : {},
    workHistory: timeline?.map((t: any) => ({
      date: t.event_date,
      description: t.description,
      category: t.event_type,
      parts_used: t.parts_involved,
      labor_hours: t.labor_hours,
      cost: t.cost
    })) || [],
    receipts: receipts?.map((r: any) => ({
      date: r.purchase_date,
      vendor: r.vendor_name,
      items: r.items?.map((i: any) => i.description) || [],
      total: r.total_amount
    })) || [],
    knownModifications,
    knownIssues: vehicle.known_issues || [],
    recentWork
  }
}

function determineImageType(rekognitionData: any): string {
  const labels = rekognitionData.Labels?.map((l: any) => l.Name.toLowerCase()) || []
  
  if (labels.some(l => ['engine', 'motor', 'radiator', 'battery'].includes(l))) return 'engine_bay'
  if (labels.some(l => ['seat', 'dashboard', 'steering wheel', 'console'].includes(l))) return 'interior'
  if (labels.some(l => ['undercarriage', 'suspension', 'exhaust', 'frame'].includes(l))) return 'undercarriage'
  if (labels.some(l => ['wheel', 'tire', 'brake'].includes(l))) return 'wheel_tire'
  if (labels.some(l => ['tool', 'wrench', 'equipment'].includes(l))) return 'work_in_progress'
  if (labels.some(l => ['document', 'paper', 'text'].includes(l))) return 'documentation'
  
  return 'exterior'
}

function createContextualQuestionnaire(
  context: VehicleContext,
  imageType: string,
  rekognitionData: any
): string {
  const { vehicle, workHistory, knownModifications, recentWork } = context
  
  // Build context preamble
  let preamble = `You are analyzing a ${vehicle.year} ${vehicle.make} ${vehicle.model}`
  if (vehicle.trim) preamble += ` ${vehicle.trim}`
  if (vehicle.engine) preamble += ` with ${vehicle.engine} engine`
  if (vehicle.transmission) preamble += ` and ${vehicle.transmission} transmission`
  preamble += `.`
  
  // Add known context
  if (knownModifications.length > 0) {
    preamble += `\n\nKnown modifications: ${knownModifications.slice(0, 5).join(', ')}`
  }
  
  if (recentWork.length > 0) {
    preamble += `\n\nRecent work completed: ${recentWork.slice(0, 3).join('; ')}`
  }

  // Create type-specific questionnaire
  let questionnaire = preamble + '\n\n'

  switch (imageType) {
    case 'engine_bay':
      questionnaire += createEngineBayQuestionnaire(context)
      break
    case 'interior':
      questionnaire += createInteriorQuestionnaire(context)
      break
    case 'undercarriage':
      questionnaire += createUndercarriageQuestionnaire(context)
      break
    case 'wheel_tire':
      questionnaire += createWheelTireQuestionnaire(context)
      break
    case 'work_in_progress':
      questionnaire += createWorkInProgressQuestionnaire(context)
      break
    case 'documentation':
      questionnaire += createDocumentationQuestionnaire(context)
      break
    default:
      questionnaire += createExteriorQuestionnaire(context)
  }

  return questionnaire
}

function createEngineBayQuestionnaire(context: VehicleContext): string {
  const { vehicle, knownModifications } = context
  
  let q = `Analyze this engine bay photo and answer these specific questions:\n\n`
  
  // Stock vs modified
  if (knownModifications.some(m => m.toLowerCase().includes('engine'))) {
    q += `1. visible_modifications: List any engine modifications you can see (we know this engine has been modified)\n`
  } else {
    q += `1. appears_stock: Does the engine appear completely stock for a ${vehicle.year} ${vehicle.make} ${vehicle.model}?\n`
  }
  
  q += `2. cleanliness: Rate engine bay cleanliness (pristine/clean/average/dirty/neglected)\n`
  q += `3. visible_leaks: Are there any wet spots, oil residue, or fluid leaks visible?\n`
  q += `4. wiring_condition: Describe wiring condition (factory/professional/amateur/messy/damaged)\n`
  q += `5. corrosion: Any rust or corrosion on shock towers, firewall, or components?\n`
  q += `6. missing_components: Any obviously missing parts or covers?\n`
  q += `7. aftermarket_parts: List any visible aftermarket parts (intake, headers, etc.)\n`
  q += `8. maintenance_indicators: Signs of recent maintenance? (new hoses, fresh paint, clean surfaces)\n`
  
  return q + `\nReturn as structured JSON.`
}

function createInteriorQuestionnaire(context: VehicleContext): string {
  const { vehicle, knownModifications } = context
  
  let q = `Analyze this interior photo for a ${vehicle.year} ${vehicle.make} ${vehicle.model}:\n\n`
  
  q += `1. seat_condition: Describe seat condition (tears, wear, stains, modifications)\n`
  q += `2. dashboard_condition: Any cracks, warping, or damage to dashboard?\n`
  q += `3. is_stock: Does interior appear stock or modified?\n`
  q += `4. aftermarket_items: List any aftermarket components (stereo, gauges, shifter, etc.)\n`
  q += `5. wear_level: Overall wear level for ${2025 - vehicle.year} year old vehicle (excellent/good/average/poor)\n`
  q += `6. cleanliness: Current cleanliness (immaculate/clean/average/dirty)\n`
  q += `7. missing_items: Any missing trim pieces, buttons, or components?\n`
  q += `8. signs_of_use: What does interior tell us about how vehicle is used? (daily driver/weekend car/project/show car)\n`
  
  return q + `\nReturn as structured JSON.`
}

function createUndercarriageQuestionnaire(context: VehicleContext): string {
  const { vehicle, recentWork } = context
  
  let q = `Analyze this undercarriage photo:\n\n`
  
  q += `1. rust_level: Overall rust condition (none/surface/moderate/severe/structural)\n`
  q += `2. recent_work_visible: Any signs of recent work? (new parts, fresh welds, clean surfaces)\n`
  
  if (recentWork.some(w => w.toLowerCase().includes('suspension'))) {
    q += `3. suspension_components: Condition of suspension parts (we know suspension work was recently done)\n`
  } else {
    q += `3. suspension_condition: Condition of suspension components (new/good/worn/damaged)\n`
  }
  
  q += `4. leaks: Any fluid leaks or wet spots?\n`
  q += `5. exhaust_condition: Exhaust system condition (rust, holes, aftermarket?)\n`
  q += `6. frame_condition: Frame or unibody condition (rust, damage, repairs?)\n`
  q += `7. aftermarket_parts: Any visible aftermarket or upgraded parts?\n`
  q += `8. geographic_indicators: Does rust level suggest location? (salt belt/dry climate/coastal)\n`
  
  return q + `\nReturn as structured JSON.`
}

function createWheelTireQuestionnaire(context: VehicleContext): string {
  const { vehicle } = context
  
  let q = `Analyze these wheels/tires:\n\n`
  
  q += `1. wheel_type: Factory/OEM/aftermarket?\n`
  q += `2. wheel_condition: Condition (mint/good/scratched/curb rash/damaged)\n`
  q += `3. tire_brand_size: Tire brand and size if visible\n`
  q += `4. tread_condition: Tread depth estimation (new/good/worn/bald)\n`
  q += `5. brake_condition: Visible brake components condition\n`
  q += `6. modifications: Any brake or wheel modifications?\n`
  q += `7. maintenance_needed: Any immediate issues? (worn tires, damaged wheels, brake wear)\n`
  
  return q + `\nReturn as structured JSON.`
}

function createWorkInProgressQuestionnaire(context: VehicleContext): string {
  const { vehicle, recentWork } = context
  
  let q = `Analyze this work-in-progress photo:\n\n`
  
  q += `1. work_type: What type of work is being performed?\n`
  q += `2. parts_visible: List all parts and tools visible in image\n`
  q += `3. work_quality: Professional/DIY/amateur based on setup and tools?\n`
  q += `4. complexity: Simple/moderate/complex/expert level work?\n`
  q += `5. safety_concerns: Any safety issues visible?\n`
  
  if (recentWork.length > 0) {
    q += `6. matches_recent_work: Does this relate to recent documented work: ${recentWork[0]}?\n`
  }
  
  q += `7. estimated_time: Estimated labor time for visible work\n`
  q += `8. next_steps: What are likely next steps in this work?\n`
  
  return q + `\nReturn as structured JSON.`
}

function createDocumentationQuestionnaire(context: VehicleContext): string {
  return `Extract all visible information from this document:\n\n` +
    `1. document_type: Type of document (receipt, manual, title, registration, etc.)\n` +
    `2. date: Any dates visible\n` +
    `3. vendor_source: Vendor, dealer, or source name\n` +
    `4. parts_services: List all parts or services mentioned\n` +
    `5. amounts: Any prices or totals\n` +
    `6. vin_plate_info: Any VIN, serial numbers, or identification\n` +
    `7. relevant_details: Any other relevant information\n\n` +
    `Return as structured JSON with high accuracy.`
}

function createExteriorQuestionnaire(context: VehicleContext): string {
  const { vehicle } = context
  
  let q = `Analyze this exterior photo of ${vehicle.year} ${vehicle.make} ${vehicle.model}:\n\n`
  
  q += `1. body_condition: Panel straightness and gaps (excellent/good/fair/poor)\n`
  q += `2. paint_condition: Paint quality (factory/quality repaint/poor repaint/faded/damaged)\n`
  q += `3. visible_damage: Any dents, scratches, rust, or damage?\n`
  q += `4. modifications: Any exterior modifications? (body kit, spoiler, lift, etc.)\n`
  q += `5. stance: Stock ride height or modified?\n`
  q += `6. overall_presentation: How does vehicle present? (show car/clean daily/work truck/project)\n`
  q += `7. aging_indicators: Age-appropriate wear or better/worse than expected?\n`
  
  return q + `\nReturn as structured JSON.`
}

async function runContextualAnalysis(
  imageUrl: string,
  questionnaire: string,
  context: VehicleContext
): Promise<any> {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiKey) throw new Error('OpenAI API key not configured')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",  // Use full model for context-aware analysis
      messages: [
        {
          role: "system",
          content: `You are an expert automotive appraiser with deep knowledge of ${context.vehicle.year} ${context.vehicle.make} ${context.vehicle.model} vehicles. Provide precise, factual assessments based on what you see.`
        },
        {
          role: "user",
          content: [
            { type: "text", text: questionnaire },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
          ]
        }
      ],
      max_tokens: 1500,
      response_format: { type: "json_object" }
    })
  })

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`)

  const data = await response.json()
  return JSON.parse(data.choices[0].message.content)
}

function extractInsights(analysis: any, context: VehicleContext, rekognitionData: any): any {
  // Extract actionable insights from analysis
  const insights = {
    maintenance_needed: [],
    modifications_detected: [],
    condition_concerns: [],
    positive_indicators: [],
    value_impacting_items: []
  }

  // Analyze based on vehicle age
  const vehicleAge = 2025 - context.vehicle.year

  // Check for maintenance indicators
  if (analysis.visible_leaks) {
    insights.maintenance_needed.push('Fluid leaks detected - requires diagnosis')
  }
  if (analysis.tread_condition === 'worn' || analysis.tread_condition === 'bald') {
    insights.maintenance_needed.push('Tires need replacement')
  }
  if (analysis.rust_level && ['moderate', 'severe', 'structural'].includes(analysis.rust_level)) {
    insights.condition_concerns.push(`${analysis.rust_level} rust present`)
  }

  // Detect modifications
  if (analysis.aftermarket_parts) {
    insights.modifications_detected = Array.isArray(analysis.aftermarket_parts) 
      ? analysis.aftermarket_parts 
      : [analysis.aftermarket_parts]
  }

  // Positive indicators
  if (analysis.cleanliness === 'pristine' || analysis.cleanliness === 'clean') {
    insights.positive_indicators.push('Well-maintained appearance')
  }
  if (analysis.maintenance_indicators) {
    insights.positive_indicators.push('Recent maintenance evident')
  }

  return insights
}

function generateContextualTags(rekognitionData: any, analysis: any, context: VehicleContext): any[] {
  const tags = []

  // Add Rekognition tags
  rekognitionData.Labels?.forEach((label: any) => {
    if (label.Confidence > 70) {
      tags.push({
        source: 'rekognition',
        name: label.Name,
        confidence: label.Confidence,
        category: 'detection'
      })
    }
  })

  // Add analysis-based tags
  if (analysis.aftermarket_parts) {
    const parts = Array.isArray(analysis.aftermarket_parts) ? analysis.aftermarket_parts : [analysis.aftermarket_parts]
    parts.forEach(part => {
      tags.push({
        source: 'contextual_analysis',
        name: part,
        confidence: 90,
        category: 'modification'
      })
    })
  }

  // Add condition tags
  if (analysis.condition || analysis.overall_condition) {
    tags.push({
      source: 'contextual_analysis',
      name: analysis.condition || analysis.overall_condition,
      confidence: 85,
      category: 'condition'
    })
  }

  return tags
}

async function analyzeImageWithRekognition(imageUrl: string) {
  const region = Deno.env.get('AWS_REGION') || 'us-east-1'
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY')

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured')
  }

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

  return await client.send(command)
}

async function insertContextualTags(supabase: any, tags: any[], imageUrl: string, vehicleId: string) {
  if (tags.length === 0) return

  const tagData = tags.map(tag => ({
    image_url: imageUrl,
    vehicle_id: vehicleId,
    tag_name: tag.name,
    tag_type: tag.category,
    confidence: tag.confidence,
    // Normalize to same shape as other taggers so we can use a single unique key.
    x_position: 50,
    y_position: 50,
    width: 20,
    height: 20,
    verified: false,
    ai_detection_data: { source: tag.source },
    created_by: '00000000-0000-0000-0000-000000000000'
  }))

  await supabase
    .from('image_tags')
    .upsert(tagData, {
      onConflict: 'image_url,tag_name,x_position,y_position',
      ignoreDuplicates: true
    })
}

