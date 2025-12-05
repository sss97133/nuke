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

interface ParticipantSuggestion {
  name: string;
  role: 'mechanic' | 'assistant' | 'supervisor' | 'owner' | 'witness' | 'other';
  evidence: string;
  confidence: number;
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
  participantSuggestions?: ParticipantSuggestion[];
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
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('year, make, model')
      .eq('id', vehicleId)
      .single();

    if (vehicleError || !vehicle) {
      throw new Error(`Vehicle not found: ${vehicleId}`);
    }

    const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

    // Get organization info (optional - can work without org)
    const { data: org } = await supabase
      .from('businesses')
      .select('business_name, business_type, labor_rate')
      .eq('id', organizationId)
      .single();

    const orgName = org?.business_name || 'Unknown Shop';
    const laborRate = org?.labor_rate || 125;

    // Get image URLs and metadata
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url, taken_at, category, exif_data, user_id')
      .in('id', imageIds)
      .order('taken_at', { ascending: true });

    if (!images || images.length === 0) {
      throw new Error('No images found');
    }

    // ============================================
    // PARTICIPANT ATTRIBUTION: Image Maker (Participant #1)
    // ============================================
    const { data: deviceAttributions } = await supabase
      .from('device_attributions')
      .select(`
        device_fingerprint,
        ghost_user_id,
        actual_contributor_id,
        uploaded_by_user_id,
        attribution_source,
        confidence_score,
        ghost_users (
          camera_make,
          camera_model,
          lens_model,
          software_version,
          display_name,
          claimed_by_user_id
        )
      `)
      .in('image_id', imageIds)
      .limit(1)
      .single();

    const imageMaker = {
      user_id: deviceAttributions?.actual_contributor_id || images[0]?.user_id || null,
      ghost_user_id: deviceAttributions?.ghost_user_id || null,
      device_fingerprint: deviceAttributions?.device_fingerprint || 'Unknown-Unknown-Unknown-Unknown',
      camera_make: deviceAttributions?.ghost_users?.camera_make || null,
      camera_model: deviceAttributions?.ghost_users?.camera_model || null,
      lens_model: deviceAttributions?.ghost_users?.lens_model || null,
      software_version: deviceAttributions?.ghost_users?.software_version || null,
      display_name: deviceAttributions?.ghost_users?.display_name || 'Unknown Photographer',
      is_claimed: deviceAttributions?.ghost_users?.claimed_by_user_id ? true : false,
      attribution_source: deviceAttributions?.attribution_source || 'unknown',
      confidence_score: deviceAttributions?.confidence_score || 50
    };

    // Get uploaded_by user info
    const uploadedByUserId = deviceAttributions?.uploaded_by_user_id || images[0]?.user_id;
    let uploadedBy = { user_id: uploadedByUserId, username: null };
    if (uploadedByUserId) {
      const { data: uploaderProfile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', uploadedByUserId)
        .single();
      uploadedBy.username = uploaderProfile?.username || null;
    }

    // ============================================
    // IMAGE SESSION METADATA
    // ============================================
    const sessionStart = images[0]?.taken_at;
    const sessionEnd = images[images.length - 1]?.taken_at;
    const sessionDate = eventDate;
    
    // Calculate time span
    let timeSpan = null;
    if (sessionStart && sessionEnd) {
      const start = new Date(sessionStart);
      const end = new Date(sessionEnd);
      const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
      timeSpan = {
        start: start.toISOString(),
        end: end.toISOString(),
        duration_minutes: durationMinutes
      };
    }

    // Aggregate EXIF data
    const exifData = images
      .filter(img => img.exif_data)
      .map(img => img.exif_data)
      .reduce((acc, exif) => {
        if (exif?.Make && !acc.camera_make) acc.camera_make = exif.Make;
        if (exif?.Model && !acc.camera_model) acc.camera_model = exif.Model;
        if (exif?.LensModel && !acc.lens_model) acc.lens_model = exif.LensModel;
        if (exif?.Software && !acc.software_version) acc.software_version = exif.Software;
        if (exif?.GPS?.latitude && exif?.GPS?.longitude) {
          acc.gps_coordinates = acc.gps_coordinates || [];
          acc.gps_coordinates.push({
            lat: exif.GPS.latitude,
            lon: exif.GPS.longitude
          });
        }
        return acc;
      }, {} as any);

    // ============================================
    // VEHICLE HISTORY (Recent work)
    // ============================================
    const { data: recentEvents } = await supabase
      .from('timeline_events')
      .select('event_date, title, description, quality_rating, metadata')
      .eq('vehicle_id', vehicleId)
      .lt('event_date', eventDate)
      .order('event_date', { ascending: false })
      .limit(10);

    const vehicleHistory = (recentEvents || []).map(ev => ({
      date: ev.event_date,
      title: ev.title,
      description: ev.description,
      work_category: ev.metadata?.work_category || null,
      quality_rating: ev.quality_rating || null
    }));

    // ============================================
    // ASSIGNED PARTICIPANTS (if event already exists)
    // ============================================
    const { data: existingEvent } = await supabase
      .from('timeline_events')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('event_date', eventDate)
      .maybeSingle();

    let assignedParticipants: any[] = [];
    if (existingEvent?.id) {
      const { data: participants } = await supabase
        .from('event_participants')
        .select(`
          user_id,
          role,
          name,
          company,
          ghost_users!event_participants_ghost_user_id_fkey (
            id,
            display_name,
            claimed_by_user_id
          )
        `)
        .eq('event_id', existingEvent.id);
      
      assignedParticipants = (participants || []).map(p => ({
        user_id: p.user_id,
        ghost_user_id: p.ghost_users?.id || null,
        name: p.name || p.ghost_users?.display_name || 'Unknown',
        role: p.role,
        company: p.company || null,
        is_ghost: p.ghost_users?.id ? true : false
      }));
    }

    console.log(`Analyzing ${images.length} images for ${vehicleName} at ${orgName}`);
    console.log(`Image Maker: ${imageMaker.display_name} (${imageMaker.device_fingerprint})`);
    console.log(`Uploaded by: ${uploadedBy.username || uploadedBy.user_id || 'Unknown'}`);
    console.log(`Session: ${sessionDate} (${timeSpan?.duration_minutes || 'unknown'} minutes)`);

    // Build participant context string
    const participantContext = `
PARTICIPANT ATTRIBUTION:
- Primary Documenter (Image Maker): ${imageMaker.display_name}
  Device: ${imageMaker.device_fingerprint}
  ${imageMaker.is_claimed ? '(Device claimed by real user)' : '(Unclaimed device - ghost user)'}
  Attribution Confidence: ${imageMaker.confidence_score}%
  
- Uploaded By: ${uploadedBy.username || uploadedBy.user_id || 'Unknown'}
  ${uploadedBy.user_id !== imageMaker.user_id ? '(Different from image maker)' : '(Same as image maker)'}

${assignedParticipants.length > 0 ? `
- Assigned Participants:
${assignedParticipants.map(p => `  - ${p.name} (${p.role})${p.company ? ` - ${p.company}` : ''}`).join('\n')}
` : ''}
`;

    // Build vehicle history context
    const historyContext = vehicleHistory.length > 0 ? `
RECENT WORK HISTORY:
${vehicleHistory.slice(0, 5).map(h => `- ${h.date}: ${h.title}${h.quality_rating ? ` (Quality: ${h.quality_rating}/10)` : ''}`).join('\n')}
` : '';

    // Build session context
    const sessionContext = `
IMAGE SESSION:
- Date: ${sessionDate}
- Photo Count: ${images.length}
${timeSpan ? `- Time Span: ${new Date(timeSpan.start).toLocaleTimeString()} - ${new Date(timeSpan.end).toLocaleTimeString()} (${timeSpan.duration_minutes} minutes)` : ''}
${exifData.gps_coordinates && exifData.gps_coordinates.length > 0 ? `- Location: GPS coordinates available (${exifData.gps_coordinates.length} images with location data)` : ''}
`;

    const systemPrompt = `You are an expert automotive shop foreman and parts specialist at ${orgName}.

SHOP DETAILS:
- Specialization: ${org?.business_type || 'Automotive restoration and repair'}
- Standard labor rate: $${laborRate}/hr
- Mitchell Labor Guide certified
- ASE Master Technician level expertise

VEHICLE:
- ${vehicleName}
${vehicleHistory.length > 0 ? historyContext : ''}

${participantContext}

${sessionContext}

TASK: Analyze these photos from a work session. The images were documented by ${imageMaker.display_name}${imageMaker.is_claimed ? ' (verified photographer)' : ' (unclaimed device - photographer unknown)'}. Generate detailed professional work log with STRUCTURED parts data for customer shopping.

CRITICAL CONTEXT:
- Consider who documented vs who performed the work (may be different)
- If you see multiple people in photos, note them as potential participants
- Cross-reference with recent work history to understand build progression
- Factor in organization specialization when estimating labor
- Account for session duration when estimating work scope

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
  "concerns": ["Small gap visible in passenger door panel seam - recommend inspection"],
  "participantSuggestions": [
    {
      "name": "Mike Johnson",
      "role": "mechanic",
      "evidence": "Visible in photos performing upholstery work",
      "confidence": 0.85
    }
  ]
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
              text: `Analyze these ${images.length} photos from work on a ${vehicleName} at ${orgName}.

${participantContext}

${sessionContext}

${vehicleHistory.length > 0 ? historyContext : ''}

Extract detailed parts data with brands, part numbers, and prices for customer shopping. Break down labor by task. Generate professional work log.

IMPORTANT: If you see people in the photos, suggest them as participants in participantSuggestions array.`
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
                text: `Analyze these ${images.length} photos from work on a ${vehicleName} at ${orgName}. Extract detailed parts data with brands, part numbers, and prices for customer shopping. Break down labor by task. Generate professional work log.`
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
    console.log('Image Maker:', imageMaker.display_name, `(${imageMaker.is_claimed ? 'claimed' : 'ghost'})`);
    console.log('Uploaded by:', uploadedBy.username || uploadedBy.user_id);

    // Insert/update timeline event in VEHICLE timeline (timeline_events table)
    // This is what the receipt component queries
    const { data: existingEvent } = await supabase
      .from('timeline_events')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('event_date', eventDate)
      .maybeSingle();

    const eventData = {
      vehicle_id: vehicleId,
      user_id: null, // Will be null for AI-generated
      event_type: 'maintenance' as const,
      event_category: 'maintenance' as const,
      event_date: eventDate,
      title: workLog.title,
      description: workLog.description,
      duration_hours: workLog.estimatedLaborHours,
      cost_amount: workLog.valueImpact,
      service_provider_name: orgName,
      source_type: 'service_record' as const,
      confidence_score: Math.round((workLog.confidence || 0.85) * 100),
      // New comprehensive fields
      quality_rating: workLog.qualityRating,
      quality_justification: workLog.qualityJustification,
      value_impact: workLog.valueImpact,
      ai_confidence_score: workLog.confidence,
      concerns: workLog.concerns && workLog.concerns.length > 0 ? workLog.concerns : null,
      // Participant attribution
      documented_by: imageMaker.user_id || null, // Real user if device claimed
      metadata: {
        vehicle_name: vehicleName,
        organization_id: organizationId,
        work_performed: workLog.workPerformed,
        parts_identified: workLog.partsExtracted?.map(p => p.name) || [],
        condition_notes: workLog.conditionNotes,
        tags: workLog.tags,
        ai_generated: true,
        // Participant attribution metadata
        image_maker: {
          user_id: imageMaker.user_id,
          ghost_user_id: imageMaker.ghost_user_id,
          device_fingerprint: imageMaker.device_fingerprint,
          display_name: imageMaker.display_name,
          is_claimed: imageMaker.is_claimed
        },
        uploaded_by: {
          user_id: uploadedBy.user_id,
          username: uploadedBy.username
        }
      }
    };

    let timelineEventId: string;

    if (existingEvent) {
      const { error: updateError } = await supabase
        .from('timeline_events')
        .update(eventData)
        .eq('id', existingEvent.id);
      
      if (updateError) {
        console.error('Failed to update timeline event:', updateError);
        throw new Error(`Failed to update timeline event: ${updateError.message}`);
      }
      
      timelineEventId = existingEvent.id;
      console.log('Updated existing timeline event:', timelineEventId);
    } else {
      const { data: newEvent, error: insertError } = await supabase
        .from('timeline_events')
        .insert(eventData)
        .select('id')
        .single();
      
      if (insertError || !newEvent) {
        console.error('Failed to create timeline event:', insertError);
        throw new Error(`Failed to create timeline event: ${insertError?.message || 'Unknown error'}`);
      }
      
      timelineEventId = newEvent.id;
      console.log('Created new timeline event:', timelineEventId);
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
        hourly_rate: laborRate,
        total_cost: task.hours * (laborRate),
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
      ?.reduce((sum, task) => sum + (task.hours * (laborRate)), 0) || 0;

    // Insert/update comprehensive financial record
    await supabase
      .from('event_financial_records')
      .upsert({
        event_id: timelineEventId,
        labor_cost: laborTotal,
        labor_hours: workLog.estimatedLaborHours,
        labor_rate: laborRate,
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

    // ============================================
    // SAVE PARTICIPANTS
    // ============================================
    
    // Participant #1: Image Maker (Primary Documenter)
    // Check if already exists (by user_id if claimed, or by name if ghost)
    if (imageMaker.user_id || imageMaker.ghost_user_id) {
      // Check if image maker already exists
      let existingImageMaker = null;
      if (imageMaker.user_id) {
        const { data } = await supabase
          .from('event_participants')
          .select('id')
          .eq('event_id', timelineEventId)
          .eq('user_id', imageMaker.user_id)
          .maybeSingle();
        existingImageMaker = data;
      } else {
        // For ghost users, check by name
        const { data } = await supabase
          .from('event_participants')
          .select('id')
          .eq('event_id', timelineEventId)
          .eq('name', imageMaker.display_name)
          .is('user_id', null)
          .maybeSingle();
        existingImageMaker = data;
      }

      if (!existingImageMaker) {
        // Insert image maker as participant #1
        const { error: participantError } = await supabase
          .from('event_participants')
          .insert({
            event_id: timelineEventId,
            user_id: imageMaker.user_id || null,
            role: 'other', // Image maker/documenter role
            name: imageMaker.display_name,
            notes: `Primary documenter (Participant #1). Device: ${imageMaker.device_fingerprint}. ${imageMaker.is_claimed ? 'Device claimed by real user' : 'Ghost user (unclaimed device)'}. Attribution confidence: ${imageMaker.confidence_score}%`
          });
        
        if (participantError) {
          console.error('Failed to save image maker as participant:', participantError);
        } else {
          console.log('Saved image maker as participant:', imageMaker.display_name);
        }
      }
    }

    // AI-Suggested Participants (if any)
    if (workLog.participantSuggestions && workLog.participantSuggestions.length > 0) {
      const suggestedParticipants = workLog.participantSuggestions
        .filter(s => s.confidence >= 0.7) // Only high-confidence suggestions
        .map(suggestion => ({
          event_id: timelineEventId,
          user_id: null, // Will need to be matched/assigned manually
          role: suggestion.role,
          name: suggestion.name,
          notes: `AI-suggested. Evidence: ${suggestion.evidence}. Confidence: ${(suggestion.confidence * 100).toFixed(0)}%`
        }));

      if (suggestedParticipants.length > 0) {
        // Insert with conflict handling (don't duplicate)
        for (const participant of suggestedParticipants) {
          const { data: existing } = await supabase
            .from('event_participants')
            .select('id')
            .eq('event_id', timelineEventId)
            .eq('name', participant.name)
            .eq('role', participant.role)
            .maybeSingle();

          if (!existing) {
            await supabase
              .from('event_participants')
              .insert(participant);
          }
        }
        
        console.log(`Saved ${suggestedParticipants.length} AI-suggested participants`);
      }
    }

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

