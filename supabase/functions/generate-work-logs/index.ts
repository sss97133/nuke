/**
 * Generate Work Logs from Image Batches - V2 with Structured Parts Extraction
 * Analyzes groups of images to create detailed work orders with shopping-ready parts data
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface WorkLogRequest {
  vehicleId: string;
  organizationId: string;
  imageIds: string[];
  eventDate: string;
}

interface PartExtracted {
  name: string;
  brand?: string;
  partNumber?: string;
  category: 'material' | 'fastener' | 'consumable' | 'component' | 'tool';
  quantity: number;
  unit?: string;
  estimatedPrice: number;
  supplier?: string;
  notes?: string;
}

interface LaborTask {
  task: string;
  category: 'removal' | 'fabrication' | 'installation' | 'finishing' | 'diagnosis';
  hours: number;
  difficulty: number; // 1-10
}

interface WorkLogResult {
  title: string;
  description: string;
  workPerformed: string[];
  partsExtracted: PartExtracted[];
  laborBreakdown: LaborTask[];
  estimatedLaborHours: number;
  qualityRating: number;
  qualityJustification: string;
  valueImpact: number;
  conditionNotes: string;
  tags: string[];
  confidence: number;
  concerns: string[];
}

const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { vehicleId, organizationId, imageIds, eventDate }: WorkLogRequest = await req.json();
    
    if (!vehicleId || !organizationId || !imageIds || imageIds.length === 0) {
      throw new Error('Missing required fields');
    }

    // Get vehicle info
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model')
      .eq('id', vehicleId)
      .single();

    const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

    // Get organization info
    const { data: org } = await supabase
      .from('businesses')
      .select('business_name, business_type, labor_rate')
      .eq('id', organizationId)
      .single();

    // Get image URLs
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('image_url, taken_at')
      .in('id', imageIds)
      .order('taken_at', { ascending: true });

    if (!images || images.length === 0) {
      throw new Error('No images found');
    }

    console.log(`Analyzing ${images.length} images for ${vehicleName} at ${org.business_name}`);

    const systemPrompt = `You are an expert automotive shop foreman and parts specialist at ${org.business_name}.

Shop Details:
- Specialization: ${org.business_type || 'Automotive restoration and repair'}
- Standard labor rate: $${org.labor_rate || 125}/hr
- Mitchell Labor Guide certified
- ASE Master Technician level expertise

Task: Analyze photos from work session on a ${vehicleName}. Generate detailed professional work log with STRUCTURED parts data for customer shopping.

Required Analysis:
1. Identify ALL work performed (step-by-step, specific tasks)
2. Extract STRUCTURED parts data:
   - Look for brand names, logos, packaging, labels in photos
   - Extract part numbers if visible on boxes/labels/parts
   - Estimate retail price based on typical market rates
   - Identify likely supplier (Summit Racing, RockAuto, Amazon, AutoZone, etc.)
   - Be specific: "Brown leather" → "Brown diamond-stitch marine-grade automotive leather"
3. Break down labor by task:
   - Category: removal, fabrication, installation, finishing, diagnosis
   - Realistic hours using Mitchell Labor Guide
   - Difficulty rating 1-10
4. Assess workmanship quality (1-10 with detailed justification)
5. Calculate realistic value added to vehicle
6. Flag any concerns (safety, quality, incomplete work)

Return ONLY valid JSON with this EXACT schema:
{
  "title": "Professional 1-line summary (e.g. 'Interior Upholstery Replacement and Door Panel Fabrication')",
  "description": "Detailed 2-3 sentence description of work scope and results",
  "workPerformed": [
    "Removed original seat covers and door panels",
    "Fabricated custom diamond-stitch pattern templates",
    "Installed new marine-grade leather upholstery"
  ],
  "partsExtracted": [
    {
      "name": "Brown Diamond Stitch Marine Leather",
      "brand": "Auto Custom Carpets",
      "partNumber": "ACC-BRONCO-LEATHER-BRN",
      "category": "material",
      "quantity": 12,
      "unit": "sq yards",
      "estimatedPrice": 1200,
      "supplier": "Summit Racing",
      "notes": "UV-resistant marine grade"
    },
    {
      "name": "High-Density Foam Padding 3-inch",
      "brand": "TMI Products",
      "partNumber": "TMI-FOAM-3IN",
      "category": "material",
      "quantity": 2,
      "unit": "sheets",
      "estimatedPrice": 340,
      "supplier": "Summit Racing"
    }
  ],
  "laborBreakdown": [
    {
      "task": "Remove old upholstery and padding",
      "category": "removal",
      "hours": 4.0,
      "difficulty": 3
    },
    {
      "task": "Pattern fabrication and cutting",
      "category": "fabrication",
      "hours": 6.0,
      "difficulty": 7
    },
    {
      "task": "Sewing and assembly",
      "category": "fabrication",
      "hours": 12.0,
      "difficulty": 8
    },
    {
      "task": "Installation and fitting",
      "category": "installation",
      "hours": 10.0,
      "difficulty": 6
    }
  ],
  "estimatedLaborHours": 38.5,
  "qualityRating": 9,
  "qualityJustification": "Excellent craftsmanship evident in precise stitch alignment, professional seam work, perfect panel fitment, and expert material handling. Minor gap in passenger door panel seam.",
  "valueImpact": 3800,
  "conditionNotes": "Significant improvement to interior condition. Factory-quality installation with modern materials maintaining vintage aesthetic.",
  "tags": ["upholstery", "interior", "restoration", "custom-fabrication"],
  "confidence": 0.92,
  "concerns": ["Small gap visible in passenger door panel seam - recommend inspection"]
}

PARTS EXTRACTION RULES:
- Look carefully for ANY visible brands, logos, packaging, part boxes
- If you see a part number on a label/box/part, extract it exactly
- Estimate retail price conservatively (what customer would pay)
- Category MUST be one of: material, fastener, consumable, component, tool
- Supplier MUST be real: Summit Racing, RockAuto, Amazon, AutoZone, eBay, O'Reilly, NAPA
- Be SPECIFIC in part names (include color, material type, dimensions)
- If multiple similar parts, combine quantity
- Add notes for important details (marine grade, UV resistant, OEM vs aftermarket)

LABOR BREAKDOWN RULES:
- Category MUST be: removal, fabrication, installation, finishing, diagnosis
- Use Mitchell Labor Guide times (or estimate conservatively)
- Difficulty 1-10: 1=basic oil change, 5=brake job, 10=engine rebuild
- Sum of task hours MUST equal estimatedLaborHours
- Be realistic - don't pad hours

QUALITY RATING RULES:
- 1-3: Poor/shoddy work, safety concerns
- 4-6: Acceptable but has issues
- 7-8: Good professional work
- 9-10: Excellent/exceptional craftsmanship
- Justification MUST cite specific evidence from photos

VALUE IMPACT RULES:
- Calculate realistic market value added by this work
- Consider: labor cost + parts cost + skill premium + market demand
- Be conservative - not what shop charged, but value added to vehicle
- Example: $2000 upholstery job might add $3500 to resale value

CONCERNS:
- Flag ANY safety issues, incomplete work, quality problems
- Be specific: "Gap in door panel seam" not "quality issues"
- Empty array if no concerns

If you cannot see enough detail in photos to be confident, reduce confidence score and note in concerns.`;

    // Call OpenAI Vision API
    let model = 'gpt-4o-mini';
    let response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'system',
          content: systemPrompt
        }, {
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: `Analyze these ${images.length} photos from work on a ${vehicleName} at ${org.business_name}. Extract detailed parts data with brands, part numbers, and prices for customer shopping. Break down labor by task. Generate professional work log.`
            },
            ...images.slice(0, 15).map(img => ({
              type: 'image_url',
              image_url: { url: img.image_url, detail: 'high' }
            }))
          ]
        }],
        max_tokens: 2500,
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });

    // Fallback to gpt-4o if needed
    if (!response.ok && response.status === 403 && model === 'gpt-4o-mini') {
      console.log('gpt-4o-mini access denied, falling back to gpt-4o...');
      model = 'gpt-4o';
      
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'system',
            content: systemPrompt
          }, {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: `Analyze these ${images.length} photos from work on a ${vehicleName} at ${org.business_name}. Extract detailed parts data with brands, part numbers, and prices for customer shopping. Break down labor by task. Generate professional work log.`
              },
              ...images.slice(0, 15).map(img => ({
                type: 'image_url',
                image_url: { url: img.image_url, detail: 'high' }
              }))
            ]
          }],
          max_tokens: 2500,
          temperature: 0.2,
          response_format: { type: 'json_object' }
        })
      });
    }

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content from AI');
    }

    let workLog: WorkLogResult;
    try {
      workLog = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse AI response:', content);
      throw new Error('Invalid AI response format');
    }

    console.log('Work log generated:', workLog.title);

    // Insert/update timeline event
    const { data: existingEvent } = await supabase
      .from('business_timeline_events')
      .select('id')
      .eq('business_id', organizationId)
      .eq('event_date', eventDate)
      .contains('metadata', { vehicle_id: vehicleId })
      .single();

    const eventData = {
      business_id: organizationId,
      event_type: 'other',
      event_category: 'service',
      event_date: eventDate,
      title: workLog.title,
      description: workLog.description,
      labor_hours: workLog.estimatedLaborHours,
      cost_amount: workLog.valueImpact,
      image_urls: images.map(img => img.image_url),
      source: 'AI-generated work log from shop images',
      source_type: 'service_record',
      metadata: {
        vehicle_id: vehicleId,
        vehicle_name: vehicleName,
        work_performed: JSON.stringify(workLog.workPerformed),
        parts_identified: JSON.stringify(workLog.partsExtracted.map(p => p.name)),
        qualityRating: workLog.qualityRating,
        qualityJustification: workLog.qualityJustification,
        valueImpact: workLog.valueImpact,
        conditionNotes: workLog.conditionNotes,
        tags: workLog.tags,
        confidence: workLog.confidence,
        concerns: workLog.concerns.length > 0 ? workLog.concerns.join('; ') : null
      },
      created_by: null
    };

    let timelineEventId: string;

    if (existingEvent) {
      await supabase
        .from('business_timeline_events')
        .update(eventData)
        .eq('id', existingEvent.id);
      
      timelineEventId = existingEvent.id;
    } else {
      const { data: newEvent } = await supabase
        .from('business_timeline_events')
        .insert(eventData)
        .select('id')
        .single();
      
      timelineEventId = newEvent.id;
    }

    // Insert structured parts data into work_order_parts
    // Separate materials (consumables) from parts (components)
    if (workLog.partsExtracted && workLog.partsExtracted.length > 0) {
      const parts = workLog.partsExtracted.filter(p => 
        p.category !== 'consumable' && p.category !== 'material'
      );
      const materials = workLog.partsExtracted.filter(p => 
        p.category === 'consumable' || p.category === 'material'
      );
      
      // Insert parts
      if (parts.length > 0) {
        const partsToInsert = parts.map(part => ({
          timeline_event_id: timelineEventId,
          part_name: part.name,
          part_number: part.partNumber || null,
          brand: part.brand || null,
          category: part.category,
          quantity: part.quantity,
          unit_price: part.quantity > 0 ? part.estimatedPrice / part.quantity : part.estimatedPrice,
          total_price: part.estimatedPrice,
          supplier: part.supplier || null,
          buy_url: null, // Will be populated by shopping service later
          notes: part.notes || (part.unit ? `${part.quantity} ${part.unit}` : null),
          ai_extracted: true,
          user_verified: false,
          added_by: null
        }));

        await supabase
          .from('work_order_parts')
          .upsert(partsToInsert, { 
            onConflict: 'timeline_event_id,part_name',
            ignoreDuplicates: false 
          });
      }
      
      // Insert materials (consumables) into work_order_materials
      if (materials.length > 0) {
        const materialsToInsert = materials.map(mat => ({
          timeline_event_id: timelineEventId,
          material_name: mat.name,
          material_category: 'other' as const, // Default, AI can improve categorization
          quantity: mat.quantity,
          unit: mat.unit || null,
          unit_cost: mat.quantity > 0 ? mat.estimatedPrice / mat.quantity : mat.estimatedPrice,
          total_cost: mat.estimatedPrice,
          supplier: mat.supplier || null,
          ai_extracted: true,
          added_by: null,
          notes: mat.notes || null
        }));

        await supabase
          .from('work_order_materials')
          .upsert(materialsToInsert, {
            onConflict: 'timeline_event_id,material_name',
            ignoreDuplicates: false
          });
      }
    }

    // Insert labor breakdown into work_order_labor
    if (workLog.laborBreakdown && workLog.laborBreakdown.length > 0) {
      const laborToInsert = workLog.laborBreakdown.map(task => ({
        timeline_event_id: timelineEventId,
        task_name: task.task,
        task_category: task.category,
        hours: task.hours,
        hourly_rate: org.labor_rate || 125,
        total_cost: task.hours * (org.labor_rate || 125),
        difficulty_rating: task.difficulty,
        ai_estimated: true,
        added_by: null
      }));

      await supabase
        .from('work_order_labor')
        .upsert(laborToInsert, { 
          onConflict: 'timeline_event_id,task_name',
          ignoreDuplicates: false 
        });
    }

    // Calculate totals for financial record
    const partsTotal = workLog.partsExtracted
      ?.filter(p => p.category !== 'consumable' && p.category !== 'material')
      .reduce((sum, p) => sum + p.estimatedPrice, 0) || 0;
    
    const materialsTotal = workLog.partsExtracted
      ?.filter(p => p.category === 'consumable' || p.category === 'material')
      .reduce((sum, p) => sum + p.estimatedPrice, 0) || 0;
    
    const laborTotal = workLog.laborBreakdown
      ?.reduce((sum, task) => sum + (task.hours * (org.labor_rate || 125)), 0) || 0;

    // Insert/update comprehensive financial record
    await supabase
      .from('event_financial_records')
      .upsert({
        event_id: timelineEventId,
        labor_cost: laborTotal,
        labor_hours: workLog.estimatedLaborHours,
        labor_rate: org.labor_rate || 125,
        parts_cost: partsTotal,
        supplies_cost: materialsTotal,
        overhead_cost: 0, // TODO: Calculate overhead based on labor hours
        tool_depreciation_cost: 0, // TODO: Track tools used
        customer_price: workLog.valueImpact || null,
        profit_margin_percent: null
      }, {
        onConflict: 'event_id',
        ignoreDuplicates: false
      });

    // Update timeline event with quality metrics
    await supabase
      .from('timeline_events')
      .update({
        quality_rating: workLog.qualityRating,
        quality_justification: workLog.qualityJustification,
        value_impact: workLog.valueImpact,
        ai_confidence_score: workLog.confidence,
        concerns: workLog.concerns && workLog.concerns.length > 0 ? workLog.concerns : null
      })
      .eq('id', timelineEventId);

    return new Response(
      JSON.stringify({
        success: true,
        eventId: timelineEventId,
        workLog,
        partsCount: workLog.partsExtracted?.length || 0,
        laborTasksCount: workLog.laborBreakdown?.length || 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Work log generation error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

