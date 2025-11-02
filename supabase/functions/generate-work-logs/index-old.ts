/**
 * Generate Work Logs from Image Batches
 * Analyzes groups of images to create detailed work order descriptions
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface WorkLogRequest {
  vehicleId: string;
  organizationId: string;
  imageIds: string[];
  eventDate: string;
}

interface WorkLogResult {
  title: string;
  description: string;
  workPerformed: string[];
  partsIdentified: string[];
  estimatedLaborHours: number;
  conditionNotes: string;
  tags: string[];
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
      .select('business_name, business_type')
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

    // Call OpenAI Vision API with automotive shop expert prompt
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
          content: `You are an expert automotive shop foreman at ${org.business_name}.

Shop Details:
- Specialization: ${org.business_type || 'Automotive restoration and repair'}
- Standard labor rate: $${org.labor_rate || 125}/hr

Industry Standards:
- Mitchell Labor Guide (standard repair times)
- Chilton Repair Manual (procedures)
- ASE certification standards
- Factory service specifications

Task: Analyze photos from work session on a ${vehicleName}. Generate detailed professional work log.

Required Analysis:
1. Identify ALL work performed (step-by-step, specific)
2. List ALL parts/materials (brand, type, quantity if visible)
3. Estimate labor hours (use Mitchell guide, be conservative)
4. Assess workmanship quality (1-10 rating with justification)
5. Calculate value impact on vehicle
6. Note any concerns (safety, quality, incomplete work)

Return ONLY valid JSON:
{
  "title": "Professional summary (e.g. Interior Upholstery Replacement)",
  "description": "Detailed 2-3 sentence description of work completed",
  "workPerformed": ["Specific action 1", "Specific action 2", ...],
  "partsIdentified": ["Part 1 (brand/type)", "Part 2", ...],
  "estimatedLaborHours": 12.5,
  "qualityRating": 9,
  "qualityJustification": "Excellent fitment, precise stitching, professional installation",
  "valueImpact": 1800,
  "conditionNotes": "Overall condition and improvement assessment",
  "tags": ["upholstery", "interior", "restoration"],
  "confidence": 0.95,
  "concerns": []
}

RULES:
- Use Mitchell Labor Guide times (conservative estimates)
- Quality rating 1-10 must be justified with specifics
- Value impact = realistic market value added by this work
- Flag any shoddy work, safety issues, or incorrect procedures
- If uncertain about details, lower confidence score
- Use professional automotive terminology
- Multiple work types = list all
- No guessing - describe only what's visible`
        }, {
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: `Analyze these ${images.length} photos from work on a ${vehicleName} at ${org.business_name} (${org.business_type || 'automotive shop'}). Generate a detailed work log.`
            },
            ...images.slice(0, 15).map(img => ({
              type: 'image_url',
              image_url: { url: img.image_url, detail: 'low' }
            }))
          ]
        }],
        max_tokens: 1500,
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });

    // Fallback to gpt-4o if gpt-4o-mini returns 403
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
            content: `You are an expert automotive shop foreman at ${org.business_name}.

Shop Details:
- Specialization: ${org.business_type || 'Automotive restoration and repair'}
- Standard labor rate: $${org.labor_rate || 125}/hr

Industry Standards:
- Mitchell Labor Guide (standard repair times)
- Chilton Repair Manual (procedures)
- ASE certification standards
- Factory service specifications

Task: Analyze photos from work session on a ${vehicleName}. Generate detailed professional work log.

Required Analysis:
1. Identify ALL work performed (step-by-step, specific)
2. List ALL parts/materials (brand, type, quantity if visible)
3. Estimate labor hours (use Mitchell guide, be conservative)
4. Assess workmanship quality (1-10 rating with justification)
5. Calculate value impact on vehicle
6. Note any concerns (safety, quality, incomplete work)

Return ONLY valid JSON:
{
  "title": "Professional summary (e.g. Interior Upholstery Replacement)",
  "description": "Detailed 2-3 sentence description of work completed",
  "workPerformed": ["Specific action 1", "Specific action 2", ...],
  "partsIdentified": ["Part 1 (brand/type)", "Part 2", ...],
  "estimatedLaborHours": 12.5,
  "qualityRating": 9,
  "qualityJustification": "Excellent fitment, precise stitching, professional installation",
  "valueImpact": 1800,
  "conditionNotes": "Overall condition and improvement assessment",
  "tags": ["upholstery", "interior", "restoration"],
  "confidence": 0.95,
  "concerns": []
}

RULES:
- Use Mitchell Labor Guide times (conservative estimates)
- Quality rating 1-10 must be justified with specifics
- Value impact = realistic market value added by this work
- Flag any shoddy work, safety issues, or incorrect procedures
- If uncertain about details, lower confidence score
- Use professional automotive terminology
- Multiple work types = list all
- No guessing - describe only what's visible`
          }, {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: `Analyze these ${images.length} photos from work on a ${vehicleName} at ${org.business_name} (${org.business_type || 'automotive shop'}). Generate a detailed work log.`
              },
              ...images.slice(0, 15).map(img => ({
                type: 'image_url',
                image_url: { url: img.image_url, detail: 'low' }
              }))
            ]
          }],
          max_tokens: 1500,
          temperature: 0.3,
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

    const workLog: WorkLogResult = JSON.parse(content);
    
    console.log('Generated work log:', workLog.title);

    // Update or create timeline event with AI-generated work log
    const { data: existingEvent } = await supabase
      .from('timeline_events')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('event_date', eventDate)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (existingEvent) {
      // Update existing event
      await supabase
        .from('timeline_events')
        .update({
          title: workLog.title,
          description: workLog.description,
          labor_hours: workLog.estimatedLaborHours,
          cost_estimate: workLog.valueImpact || workLog.totalCost,
          event_type: 'work_completed',
          metadata: {
            work_performed: workLog.workPerformed,
            parts_identified: workLog.partsIdentified,
            condition_notes: workLog.conditionNotes,
            tags: workLog.tags,
            quality_rating: workLog.qualityRating,
            quality_justification: workLog.qualityJustification,
            value_impact: workLog.valueImpact,
            labor_cost: workLog.laborCost,
            parts_cost: workLog.partsCost,
            total_cost: workLog.totalCost,
            confidence: workLog.confidence,
            concerns: workLog.concerns || [],
            ai_generated: true,
            ai_analyzed_at: new Date().toISOString(),
            image_count: images.length
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', existingEvent.id);
      
      console.log('Updated existing event:', existingEvent.id);
    } else {
      // Create new timeline event
      const { error: insertError } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicleId,
          organization_id: organizationId,
          service_provider_name: org.business_name,
          event_type: 'work_completed',
          event_date: eventDate,
          title: workLog.title,
          description: workLog.description,
          labor_hours: workLog.estimatedLaborHours,
          cost_estimate: workLog.valueImpact || workLog.totalCost,
          source: 'AI-generated work log from shop images',
          source_type: 'service_record',
          parts_mentioned: workLog.partsIdentified,
          automated_tags: workLog.tags,
          metadata: {
            work_performed: workLog.workPerformed,
            parts_identified: workLog.partsIdentified,
            condition_notes: workLog.conditionNotes,
            tags: workLog.tags,
            quality_rating: workLog.qualityRating,
            quality_justification: workLog.qualityJustification,
            value_impact: workLog.valueImpact,
            labor_cost: workLog.laborCost,
            parts_cost: workLog.partsCost,
            total_cost: workLog.totalCost,
            confidence: workLog.confidence,
            concerns: workLog.concerns || [],
            ai_generated: true,
            ai_analyzed_at: new Date().toISOString(),
            image_count: images.length
          }
        });

      if (insertError) throw insertError;
      console.log('Created new timeline event');
    }

    return new Response(
      JSON.stringify({
        success: true,
        workLog
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

