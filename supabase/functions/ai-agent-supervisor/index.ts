import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface SupervisorRequest {
  vehicle_id: string;
  image_url: string;
  rekognition_tags: any[];
  user_id: string;
  timeline_event_id?: string;
  work_session_context?: string;
}

interface VehicleContext {
  year: number;
  make: string;
  model: string;
  vin: string;
  user_location: string;
  receipts: any[];
  previous_work: any[];
  session_images: any[];
  user_tools: any[];
}

interface SupervisorResponse {
  specific_parts: Array<{
    part_name: string;
    part_number?: string;
    brand?: string;
    category: string;
    confidence: number;
    estimated_cost?: number;
    vendor_links?: Array<{vendor: string; url: string; price?: number}>;
  }>;
  supplies_and_tools: Array<{
    item_name: string;
    brand?: string;
    size_spec?: string;
    category: 'tool' | 'supply' | 'consumable';
    estimated_cost?: number;
    vendor_links?: Array<{vendor: string; url: string}>;
    usage_context?: string;
  }>;
  work_type: string;
  labor_hours_estimate: number;
  shop_context: string;
  confidence_score: number;
  work_session: string;
  user_notes?: string;
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

    const request: SupervisorRequest = await req.json()
    const { vehicle_id, image_url, rekognition_tags, user_id, timeline_event_id, work_session_context } = request

    console.log(`🤖 AI Agent Supervisor analyzing: ${image_url}`)

    // Gather comprehensive vehicle context
    const context = await gatherVehicleContext(supabase, vehicle_id, user_id, image_url)
    
    // Build enhanced prompt with context
    const prompt = buildEnhancedAgentPrompt(context, rekognition_tags, work_session_context)
    
    // Call Claude with enhanced context
    const claudeResponse = await callClaudeAPI(prompt, image_url)
    
    if (!claudeResponse.success) {
      throw new Error(`Claude API error: ${claudeResponse.error}`)
    }

    const supervisedResult: SupervisorResponse = claudeResponse.data

    // Save enhanced tags with context
    await saveEnhancedTags(supabase, supervisedResult, vehicle_id, image_url, timeline_event_id, user_id)

    // Create timeline event if significant work detected
    await createTimelineEventIfNeeded(supabase, supervisedResult, vehicle_id, image_url, timeline_event_id)

    // Track tool usage
    await trackToolUsage(supabase, supervisedResult.supplies_and_tools, user_id, vehicle_id)

    console.log(`✅ AI Agent Supervisor complete: ${supervisedResult.specific_parts.length} parts, ${supervisedResult.supplies_and_tools.length} tools/supplies`)

    return new Response(
      JSON.stringify({
        success: true,
        supervised_result: supervisedResult,
        context_used: {
          receipts_count: context.receipts.length,
          previous_work_count: context.previous_work.length,
          session_images_count: context.session_images.length,
          user_tools_count: context.user_tools.length
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ AI Agent Supervisor error:', error)
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

async function gatherVehicleContext(supabase: any, vehicle_id: string, user_id: string, image_url: string): Promise<VehicleContext> {
  console.log(`📊 Gathering context for vehicle ${vehicle_id}`)

  // Get vehicle basics
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('year, make, model, vin')
    .eq('id', vehicle_id)
    .single()

  // Get user location
  const { data: user } = await supabase
    .from('user_metadata')
    .select('location')
    .eq('user_id', user_id)
    .single()

  // Get receipts for cost validation
  const { data: receipts } = await supabase
    .from('receipts')
    .select('vendor_name, total_amount, raw_extraction')
    .eq('scope_type', 'vehicle')
    .eq('scope_id', vehicle_id)
    .eq('is_active', true)

  // Get previous work for pattern recognition
  const { data: previous_work } = await supabase
    .from('image_tags')
    .select('tag_name, metadata')
    .eq('vehicle_id', vehicle_id)
    .eq('source_type', 'ai')
    .not('metadata->ai_supervised', 'is', null)
    .limit(20)

  // Get session images (within 2 hours of this image)
  const imageTimestamp = extractTimestampFromUrl(image_url)
  const sessionStart = new Date(imageTimestamp - 2 * 60 * 60 * 1000) // 2 hours before
  const sessionEnd = new Date(imageTimestamp + 2 * 60 * 60 * 1000)   // 2 hours after

  const { data: session_images } = await supabase
    .from('vehicle_images')
    .select('image_url, taken_at')
    .eq('vehicle_id', vehicle_id)
    .gte('taken_at', sessionStart.toISOString())
    .lte('taken_at', sessionEnd.toISOString())
    .order('taken_at', { ascending: true })

  // Get user's tool inventory for tracking
  const { data: user_tools } = await supabase
    .from('user_tools')
    .select('description, brand, category, first_purchase_date, total_spent')
    .eq('user_id', user_id)
    .not('condition', 'is', null)

  return {
    year: vehicle?.year || 0,
    make: vehicle?.make || '',
    model: vehicle?.model || '',
    vin: vehicle?.vin || '',
    user_location: user?.location || 'Unknown',
    receipts: receipts || [],
    previous_work: previous_work || [],
    session_images: session_images || [],
    user_tools: user_tools || []
  }
}

function buildEnhancedAgentPrompt(context: VehicleContext, rekognition_tags: any[], work_session_context?: string): string {
  const prompt = `You are an expert automotive shop manager analyzing work documentation. 

VEHICLE CONTEXT:
- ${context.year} ${context.make} ${context.model} (VIN: ${context.vin})
- User Location: ${context.user_location}
- Previous Work Detected: ${context.previous_work.length} items
- Work Session: ${context.session_images.length} images in this session
- User Tools Available: ${context.user_tools.length} tools in inventory
- Receipts Available: ${context.receipts.length} receipts for cost validation

REKOGNITION TAGS DETECTED:
${rekognition_tags.map(tag => `- ${tag.Name} (${Math.round(tag.Confidence * 100)}%)`).join('\n')}

${work_session_context ? `WORK SESSION CONTEXT:\n${work_session_context}\n` : ''}

CRITICAL RULES:
1. ONLY use REAL part numbers from actual vendor catalogs
2. Return confidence < 30 if exact part number is unknown
3. Part numbers MUST match ${context.year} ${context.make} ${context.model} fitment
4. READ ANY VISIBLE TEXT/LABELS FIRST for part numbers, manufacturer stamps
5. Tools should be linked to user's inventory when possible
6. Connect detected parts to receipts when vendor/amount matches

ENHANCED TOOL RECOGNITION:
Detect these specific tool categories with high accuracy:
- Hand Tools: wrenches, sockets, ratchets, pliers, screwdrivers
- Power Tools: drills, impacts, grinders, sanders, saws
- Specialty Tools: torque wrenches, pullers, presses, meters
- Lifting Equipment: jacks, stands, hoists, cranes
- Safety Equipment: glasses, gloves, respirators, harnesses

USER TOOL INVENTORY:
${context.user_tools.map(tool => `- ${tool.description} (${tool.brand}) - $${tool.total_spent}`).join('\n')}

AVAILABLE RECEIPTS FOR COST VALIDATION:
${context.receipts.map(r => `- ${r.vendor_name}: $${r.total_amount}`).join('\n')}

ANALYSIS METHOD (Decision Tree):
1. Identify Subject (part, tool, supply, damage, process)
2. Match to Factory Specs for ${context.year} ${context.make} ${context.model}
3. Read Text/Labels for exact part numbers
4. Cross-reference with user receipts and tools
5. Determine specific identification with confidence

VENDOR PRIORITY (${context.user_location}):
${context.user_location.toLowerCase().includes('vegas') ? 
  'LOCAL: CJ Pony Parts (FREE PICKUP), LMC Truck, Summit Racing' :
  'Online: RockAuto, Amazon, eBay Motors, Summit Racing'}

Return JSON with:
{
  "specific_parts": [{"part_name": "...", "part_number": "...", "brand": "...", "category": "...", "confidence": 0.95, "estimated_cost": 150, "vendor_links": [...]}],
  "supplies_and_tools": [{"item_name": "...", "brand": "...", "size_spec": "...", "category": "tool", "estimated_cost": 45, "vendor_links": [...], "usage_context": "..."}],
  "work_type": "Engine rebuild and drivetrain service",
  "labor_hours_estimate": 8.5,
  "shop_context": "Complete engine tear-down with transfer case rebuild...",
  "confidence_score": 85,
  "work_session": "Engine rebuild session - Day 3",
  "user_notes": "NP205 transfer case shows signs of wear on input shaft"
}`

  return prompt
}

async function callClaudeAPI(prompt: string, image_url: string): Promise<{success: boolean; data?: SupervisorResponse; error?: string}> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('ANTHROPIC_API_KEY')}`,
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') || ''
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image',
                source: {
                  type: 'url',
                  url: image_url
                }
              }
            ]
          }
        ]
      })
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error: `Claude API error: ${response.status} - ${error}` }
    }

    const data = await response.json()
    const content = data.content[0].text

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: 'No JSON found in Claude response' }
    }

    const supervisedResult = JSON.parse(jsonMatch[0])
    return { success: true, data: supervisedResult }

  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function saveEnhancedTags(supabase: any, result: SupervisorResponse, vehicle_id: string, image_url: string, timeline_event_id: string | undefined, user_id: string) {
  // Get image_id from image_url
  const { data: imageRecord } = await supabase
    .from('vehicle_images')
    .select('id')
    .eq('image_url', image_url)
    .single()

  if (!imageRecord) {
    console.error('Image not found for URL:', image_url)
    return
  }

  const tagsToInsert = []

  // Process specific parts
  for (const part of result.specific_parts) {
    tagsToInsert.push({
      vehicle_id,
      image_id: imageRecord.id,
      timeline_event_id,
      tag_name: part.part_name,
      text: part.part_name,
      tag_type: 'part',
      confidence: part.confidence,
      created_by: user_id,
      verified: false,
      source_type: 'ai',
      metadata: {
        ai_supervised: true,
        part_number: part.part_number,
        brand: part.brand,
        category: part.category,
        estimated_cost: part.estimated_cost,
        vendor_links: part.vendor_links,
        work_session: result.work_session,
        user_notes: result.user_notes,
        confidence_score: result.confidence_score
      },
      sellable: part.category !== 'consumable'
    })
  }

  // Process supplies and tools
  for (const item of result.supplies_and_tools) {
    tagsToInsert.push({
      vehicle_id,
      image_id: imageRecord.id,
      timeline_event_id,
      tag_name: item.item_name,
      text: item.item_name,
      tag_type: item.category === 'tool' ? 'tool' : 'supply',
      confidence: 0.9, // High confidence for supervised detection
      created_by: user_id,
      verified: false,
      source_type: 'ai',
      metadata: {
        ai_supervised: true,
        brand: item.brand,
        size_spec: item.size_spec,
        category: item.category,
        estimated_cost: item.estimated_cost,
        vendor_links: item.vendor_links,
        usage_context: item.usage_context,
        work_session: result.work_session,
        user_notes: result.user_notes,
        confidence_score: result.confidence_score
      },
      sellable: item.category === 'tool'
    })
  }

  // Insert all tags
  if (tagsToInsert.length > 0) {
    const { error } = await supabase
      .from('image_tags')
      .insert(tagsToInsert)

    if (error) {
      console.error('Error inserting enhanced tags:', error)
    } else {
      console.log(`✅ Inserted ${tagsToInsert.length} enhanced tags`)
    }
  }
}

async function createTimelineEventIfNeeded(supabase: any, result: SupervisorResponse, vehicle_id: string, image_url: string, timeline_event_id: string | undefined) {
  // Only create timeline event if we have significant work detected
  if (result.labor_hours_estimate > 0 && result.specific_parts.length > 0) {
    // Get image taken_at date
    const { data: imageRecord } = await supabase
      .from('vehicle_images')
      .select('taken_at')
      .eq('image_url', image_url)
      .single()

    if (imageRecord?.taken_at) {
      const eventDate = new Date(imageRecord.taken_at)
      
      // Only create if date is valid (in the past, after 1970)
      if (eventDate.getTime() > 0 && eventDate < new Date()) {
        // Idempotency: this function can be retried; avoid creating duplicate events for the same image.
        const { data: existing } = await supabase
          .from('timeline_events')
          .select('id')
          .eq('vehicle_id', vehicle_id)
          .eq('source', 'ai_agent_detected')
          .eq('event_type', 'maintenance')
          .eq('metadata->>image_url', image_url)
          .limit(1)
          .maybeSingle()

        const { error } = existing?.id
          ? { error: null }
          : await supabase
              .from('timeline_events')
              .insert({
                vehicle_id,
                event_date: eventDate.toISOString().split('T')[0], // Date only
                title: result.work_type,
                event_type: 'maintenance',
                source: 'ai_agent_detected',
                description: result.shop_context,
                labor_hours: result.labor_hours_estimate,
                metadata: {
                  image_url,
                  ai_detected_parts: result.specific_parts.length,
                  supplies_used: result.supplies_and_tools.length,
                  confidence: result.confidence_score,
                  work_session: result.work_session,
                  user_notes: result.user_notes,
                  exif_verified: true
                }
              })

        if (error) {
          console.error('Error creating timeline event:', error)
        } else {
          console.log('✅ Created timeline event:', result.work_type)
        }
      }
    }
  }
}

async function trackToolUsage(supabase: any, tools_and_supplies: any[], user_id: string, vehicle_id: string) {
  for (const item of tools_and_supplies) {
    if (item.category === 'tool') {
      // Track tool usage
      const { error } = await supabase
        .from('tool_usage_log')
        .insert({
          user_id,
          vehicle_id,
          tool_name: item.item_name,
          brand: item.brand,
          usage_date: new Date().toISOString(),
          usage_context: item.usage_context,
          estimated_duration_hours: 1, // Default assumption
          source: 'ai_detected'
        })

      if (error) {
        console.error('Error tracking tool usage:', error)
      }
    }
  }
}

function extractTimestampFromUrl(url: string): number {
  // Extract timestamp from URL like: .../1758472168539_njfrm5.jpeg
  const match = url.match(/(\d{13})_/)
  return match ? parseInt(match[1]) : Date.now()
}
