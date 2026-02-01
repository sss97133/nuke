/**
 * AI WORK ORDER BUNDLE ANALYZER
 * 
 * Uses computer vision to intelligently analyze work order image bundles:
 * 1. Group images by work session (date/location/context)
 * 2. Identify products, tools, parts in images
 * 3. Estimate labor hours based on work complexity
 * 4. Calculate value with cross-checks against Mitchell/Chilton standards
 * 5. Flag uncertain estimates for human review
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const openaiKey = Deno.env.get('OPENAI_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface WorkOrderAnalysis {
  bundle_id: string;
  work_category: string; // 'fabrication', 'paint', 'mechanical', etc.
  complexity_level: 'simple' | 'moderate' | 'complex' | 'expert';
  
  // Products/Tools identified
  products_identified: Array<{
    name: string;
    category: string; // 'welding_wire', 'paint', 'brake_pads', etc.
    confidence: number; // 0-100
    estimated_cost: number | null;
    source_image_id: string;
  }>;
  
  // Labor estimation
  estimated_labor_hours: {
    minimum: number;
    expected: number;
    maximum: number;
    confidence: number; // 0-100
    reasoning: string;
  };
  
  // Value calculation
  total_value: {
    parts_cost: number;
    labor_cost: number; // Based on org labor rate
    total: number;
    confidence: number;
  };
  
  // Cross-checks
  industry_standards: {
    mitchell_estimate?: number;
    chilton_estimate?: number;
    variance_explanation: string;
  };
  
  // Flags for human review
  requires_human_review: boolean;
  review_reasons: string[];
  ai_uncertainty_notes: string;
}

serve(async (req) => {
  try {
    const { image_bundle_ids, organization_id } = await req.json();
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // 1. Get the images
    const { data: images } = await supabase
      .from('organization_images')
      .select('*')
      .in('id', image_bundle_ids);
    
    if (!images || images.length === 0) {
      throw new Error('No images found');
    }
    
    // 2. Get organization labor rate
    const { data: org } = await supabase
      .from('businesses')
      .select('labor_rate')
      .eq('id', organization_id)
      .single();
    
    const laborRate = org?.labor_rate || 100; // Default $100/hr
    
    // 3. Analyze each image with GPT-4 Vision
    const imageAnalyses = [];
    
    for (const img of images) {
      const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are an expert automotive technician and estimator. Analyze work order images to identify:
1. Products used (specific brands, part numbers if visible)
2. Tools visible
3. Type of work being performed
4. Complexity level (simple, moderate, complex, expert)
5. Estimated labor time based on visible work
6. Any safety concerns or quality issues

Be specific and cite what you see in the image. If uncertain, say so.`
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Analyze this work order image. What products, tools, and work do you see? Estimate labor time.'
                },
                {
                  type: 'image_url',
                  image_url: { url: img.image_url }
                }
              ]
            }
          ],
          max_tokens: 1000
        })
      });
      
      const visionResult = await visionResponse.json();
      const analysis = visionResult.choices[0].message.content;
      
      imageAnalyses.push({
        image_id: img.id,
        analysis,
        taken_at: img.taken_at
      });
    }
    
    // 4. Aggregate analyses into work order bundle
    const aggregateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an automotive work order estimator. Given multiple image analyses from a work session, create a comprehensive work order estimate.

CRITICAL INSTRUCTIONS:
1. If you CANNOT determine labor hours with confidence, set confidence LOW and flag for review
2. Cross-check your estimates against typical Mitchell/Chilton times for similar work
3. If variance > 30% from standards, explain why (custom work, damage extent, etc.)
4. Flag ANY uncertainty - better to ask humans than guess wrong
5. Group products by category (consumables, parts, tools)
6. Estimate costs conservatively (better to underestimate than over)

Labor rate for this shop: $${laborRate}/hr

Return JSON:
{
  "work_category": "fabrication" | "paint" | "mechanical" | etc,
  "complexity_level": "simple" | "moderate" | "complex" | "expert",
  "products_identified": [
    {"name": "string", "category": "string", "confidence": 0-100, "estimated_cost": number, "source_image_id": "uuid"}
  ],
  "estimated_labor_hours": {
    "minimum": number,
    "expected": number,
    "maximum": number,
    "confidence": 0-100,
    "reasoning": "string"
  },
  "total_value": {
    "parts_cost": number,
    "labor_cost": number,
    "total": number,
    "confidence": 0-100
  },
  "industry_standards": {
    "mitchell_estimate": number | null,
    "chilton_estimate": number | null,
    "variance_explanation": "string"
  },
  "requires_human_review": boolean,
  "review_reasons": ["string"],
  "ai_uncertainty_notes": "string"
}`
          },
          {
            role: 'user',
            content: `Analyze these ${imageAnalyses.length} images from a work session and create a comprehensive estimate:\n\n${JSON.stringify(imageAnalyses, null, 2)}`
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000
      })
    });
    
    const aggregateResult = await aggregateResponse.json();
    const workOrderAnalysis: WorkOrderAnalysis = JSON.parse(aggregateResult.choices[0].message.content);
    
    // 5. Save to database
    const { data: savedAnalysis, error } = await supabase
      .from('work_order_ai_analyses')
      .insert({
        organization_id,
        image_bundle_ids,
        work_category: workOrderAnalysis.work_category,
        complexity_level: workOrderAnalysis.complexity_level,
        products_identified: workOrderAnalysis.products_identified,
        estimated_labor_hours: workOrderAnalysis.estimated_labor_hours,
        total_value_estimate: workOrderAnalysis.total_value,
        industry_standards_check: workOrderAnalysis.industry_standards,
        requires_human_review: workOrderAnalysis.requires_human_review,
        review_reasons: workOrderAnalysis.review_reasons,
        ai_confidence_score: workOrderAnalysis.total_value.confidence,
        ai_notes: workOrderAnalysis.ai_uncertainty_notes,
        analyzed_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) throw error;
    
    return new Response(JSON.stringify({
      success: true,
      analysis: savedAnalysis
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

