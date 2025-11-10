import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * AI Restoration Cost Estimator
 * 
 * Analyzes vehicle images + data → Estimates restoration costs
 * Parts + Labor = Total Cost → Projected Value
 * 
 * Flow:
 * 1. Analyze images with OpenAI Vision (detect condition, damage)
 * 2. Calculate baseline costs by category (paint, interior, mechanical, etc.)
 * 3. Apply labor rates from organization
 * 4. Return detailed breakdown with confidence scores
 */

interface RestoreEstimateRequest {
  vehicleId: string;
  year: number;
  make: string;
  model: string;
  imageUrls: string[];
  currentCondition?: string;
  desiredCondition?: 'driver' | 'show' | 'concours';
  laborOrgId?: string; // If user has preferred shop
}

interface CostCategory {
  category: string;
  parts_low: number;
  parts_high: number;
  labor_hours_low: number;
  labor_hours_high: number;
  labor_rate: number;
  total_low: number;
  total_high: number;
  confidence: number;
  reasoning: string;
  ai_detected_issues?: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const requestData: RestoreEstimateRequest = await req.json();
    const { vehicleId, year, make, model, imageUrls, currentCondition, desiredCondition, laborOrgId } = requestData;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) throw new Error('OpenAI API key not configured');

    // 1. Analyze images with GPT-4 Vision
    console.log(`Analyzing ${imageUrls.length} images for condition assessment...`);
    
    const imageAnalyses = await Promise.all(
      imageUrls.slice(0, 10).map(async (imageUrl, idx) => {
        try {
          const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'system',
                  content: `You are an expert automotive appraiser. Analyze this vehicle image and identify ALL restoration needs. Focus on: paint condition, rust, dents, interior wear, mechanical issues visible, chrome condition, glass condition, trim condition. Return JSON.`
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `Analyze this ${year} ${make} ${model} image. Identify all visible issues that would need restoration work.`
                    },
                    {
                      type: 'image_url',
                      image_url: { url: imageUrl, detail: 'high' }
                    }
                  ]
                }
              ],
              response_format: { type: 'json_object' },
              max_tokens: 1000
            })
          });

          const visionData = await visionResponse.json();
          return JSON.parse(visionData.choices[0].message.content);
        } catch (error) {
          console.error(`Failed to analyze image ${idx}:`, error);
          return { issues: [] };
        }
      })
    );

    // 2. Aggregate all detected issues
    const allIssues = {
      paint: new Set<string>(),
      bodywork: new Set<string>(),
      interior: new Set<string>(),
      mechanical: new Set<string>(),
      chrome: new Set<string>(),
      glass: new Set<string>(),
      electrical: new Set<string>()
    };

    imageAnalyses.forEach(analysis => {
      if (analysis.paint_issues) analysis.paint_issues.forEach((i: string) => allIssues.paint.add(i));
      if (analysis.bodywork_issues) analysis.bodywork_issues.forEach((i: string) => allIssues.bodywork.add(i));
      if (analysis.interior_issues) analysis.interior_issues.forEach((i: string) => allIssues.interior.add(i));
      if (analysis.mechanical_issues) analysis.mechanical_issues.forEach((i: string) => allIssues.mechanical.add(i));
      if (analysis.chrome_issues) analysis.chrome_issues.forEach((i: string) => allIssues.chrome.add(i));
      if (analysis.glass_issues) analysis.glass_issues.forEach((i: string) => allIssues.glass.add(i));
      if (analysis.electrical_issues) analysis.electrical_issues.forEach((i: string) => allIssues.electrical.add(i));
    });

    // 3. Get labor rates (if shop specified, otherwise use market averages)
    let laborRate = 125; // Default: $125/hr market average
    
    if (laborOrgId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('labor_rate')
        .eq('id', laborOrgId)
        .single();
      
      if (org?.labor_rate) {
        laborRate = org.labor_rate;
      }
    }

    // 4. Calculate costs by category
    const categories: CostCategory[] = [];

    // PAINT & BODYWORK
    const paintIssues = Array.from(allIssues.paint);
    const bodyIssues = Array.from(allIssues.bodywork);
    
    if (paintIssues.length > 0 || bodyIssues.length > 0 || desiredCondition) {
      const paintQuality = desiredCondition === 'concours' ? 'show_quality' : desiredCondition === 'show' ? 'high_quality' : 'driver_quality';
      
      let partsLow = 0, partsHigh = 0, hoursLow = 0, hoursHigh = 0;
      
      if (paintQuality === 'show_quality') {
        partsLow = 3000; partsHigh = 8000;
        hoursLow = 80; hoursHigh = 150;
      } else if (paintQuality === 'high_quality') {
        partsLow = 1500; partsHigh = 4000;
        hoursLow = 40; hoursHigh = 80;
      } else {
        partsLow = 800; partsHigh = 2000;
        hoursLow = 20; hoursHigh = 40;
      }
      
      // Add bodywork costs if rust/dents detected
      if (bodyIssues.some(i => i.toLowerCase().includes('rust'))) {
        partsLow += 500; partsHigh += 2000;
        hoursLow += 15; hoursHigh += 40;
      }
      
      categories.push({
        category: 'Paint & Bodywork',
        parts_low: partsLow,
        parts_high: partsHigh,
        labor_hours_low: hoursLow,
        labor_hours_high: hoursHigh,
        labor_rate: laborRate,
        total_low: partsLow + (hoursLow * laborRate),
        total_high: partsHigh + (hoursHigh * laborRate),
        confidence: paintIssues.length > 0 ? 85 : 60,
        reasoning: `${paintIssues.length > 0 ? 'Detected issues: ' + paintIssues.join(', ') : 'Estimated based on typical restoration'}`,
        ai_detected_issues: paintIssues
      });
    }

    // INTERIOR
    const interiorIssues = Array.from(allIssues.interior);
    
    if (interiorIssues.length > 0 || desiredCondition) {
      let partsLow = 500, partsHigh = 3000, hoursLow = 10, hoursHigh = 30;
      
      if (interiorIssues.some(i => i.toLowerCase().includes('seat'))) {
        partsLow += 800; partsHigh += 2500;
        hoursLow += 8; hoursHigh += 20;
      }
      
      if (interiorIssues.some(i => i.toLowerCase().includes('carpet'))) {
        partsLow += 300; partsHigh += 800;
        hoursLow += 4; hoursHigh += 8;
      }
      
      categories.push({
        category: 'Interior Restoration',
        parts_low: partsLow,
        parts_high: partsHigh,
        labor_hours_low: hoursLow,
        labor_hours_high: hoursHigh,
        labor_rate: laborRate,
        total_low: partsLow + (hoursLow * laborRate),
        total_high: partsHigh + (hoursHigh * laborRate),
        confidence: interiorIssues.length > 0 ? 80 : 50,
        reasoning: interiorIssues.length > 0 ? `Detected: ${interiorIssues.join(', ')}` : 'Typical interior refresh',
        ai_detected_issues: interiorIssues
      });
    }

    // MECHANICAL (baseline for unknown condition)
    const mechanicalIssues = Array.from(allIssues.mechanical);
    
    if (mechanicalIssues.length > 0 || !currentCondition) {
      categories.push({
        category: 'Mechanical Refresh',
        parts_low: 1000,
        parts_high: 5000,
        labor_hours_low: 20,
        labor_hours_high: 60,
        labor_rate: laborRate,
        total_low: 1000 + (20 * laborRate),
        total_high: 5000 + (60 * laborRate),
        confidence: 40,
        reasoning: 'Conservative estimate for fluids, brakes, suspension refresh',
        ai_detected_issues: mechanicalIssues
      });
    }

    // CHROME & TRIM
    const chromeIssues = Array.from(allIssues.chrome);
    
    if (chromeIssues.length > 0) {
      categories.push({
        category: 'Chrome & Trim',
        parts_low: 500,
        parts_high: 2500,
        labor_hours_low: 5,
        labor_hours_high: 15,
        labor_rate: laborRate,
        total_low: 500 + (5 * laborRate),
        total_high: 2500 + (15 * laborRate),
        confidence: 70,
        reasoning: `Detected: ${chromeIssues.join(', ')}`,
        ai_detected_issues: chromeIssues
      });
    }

    // 5. Calculate totals
    const totalLow = categories.reduce((sum, cat) => sum + cat.total_low, 0);
    const totalHigh = categories.reduce((sum, cat) => sum + cat.total_high, 0);
    const totalPartsLow = categories.reduce((sum, cat) => sum + cat.parts_low, 0);
    const totalPartsHigh = categories.reduce((sum, cat) => sum + cat.parts_high, 0);
    const totalLaborHoursLow = categories.reduce((sum, cat) => sum + cat.labor_hours_low, 0);
    const totalLaborHoursHigh = categories.reduce((sum, cat) => sum + cat.labor_hours_high, 0);

    // 6. Calculate projected value after restoration
    // Use market data or baseline multipliers
    const baseValue = await estimateMarketValue(year, make, model, supabase);
    const restoredValueLow = baseValue * 1.3; // Conservative 30% increase
    const restoredValueHigh = baseValue * 2.0; // Optimistic 100% increase

    const profitLow = restoredValueLow - totalHigh; // Worst case
    const profitHigh = restoredValueHigh - totalLow; // Best case

    // 7. Return comprehensive estimate
    return new Response(
      JSON.stringify({
        success: true,
        vehicle: { year, make, model },
        labor_rate: laborRate,
        
        breakdown: categories,
        
        totals: {
          parts_low: totalPartsLow,
          parts_high: totalPartsHigh,
          labor_hours_low: totalLaborHoursLow,
          labor_hours_high: totalLaborHoursHigh,
          labor_cost_low: totalLaborHoursLow * laborRate,
          labor_cost_high: totalLaborHoursHigh * laborRate,
          total_low: totalLow,
          total_high: totalHigh,
          average: Math.round((totalLow + totalHigh) / 2)
        },
        
        value_projection: {
          current_value: baseValue,
          restored_value_low: restoredValueLow,
          restored_value_high: restoredValueHigh,
          profit_low: profitLow,
          profit_high: profitHigh,
          roi_low_percent: (profitLow / totalHigh) * 100,
          roi_high_percent: (profitHigh / totalLow) * 100
        },
        
        confidence_score: Math.round(
          categories.reduce((sum, cat) => sum + cat.confidence, 0) / categories.length
        ),
        
        images_analyzed: imageUrls.length,
        issues_detected: Object.values(allIssues).reduce((sum, set) => sum + set.size, 0)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Restoration estimate error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function estimateMarketValue(year: number, make: string, model: string, supabase: any): Promise<number> {
  // Try to get recent sales data for similar vehicles
  const { data: similarSales } = await supabase
    .from('vehicles')
    .select('sale_price, asking_price')
    .eq('year', year)
    .ilike('make', `%${make}%`)
    .ilike('model', `%${model}%`)
    .not('sale_price', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (similarSales && similarSales.length > 0) {
    const prices = similarSales.map(v => v.sale_price || v.asking_price).filter(Boolean);
    const average = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    return Math.round(average);
  }

  // Fallback: Use baseline values by era/type
  const age = new Date().getFullYear() - year;
  
  if (age > 40) {
    // Classic car (1960s-1980s)
    return 35000;
  } else if (age > 20) {
    // Modern classic (1990s-2000s)
    return 20000;
  } else {
    // Recent (2010s+)
    return 50000;
  }
}

