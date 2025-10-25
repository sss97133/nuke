/**
 * Automatic Restoration Estimator
 * 
 * Runs in background when images are uploaded/analyzed.
 * Updates vehicle profile with restoration facts automatically.
 * No user interaction required - like compilation.
 * 
 * User provides: Images (code) + Ownership (API keys)
 * System provides: Facts (compiled output)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req) => {
  try {
    const { vehicleId } = await req.json();

    // Step 1: Get all parts identified from images
    const { data: parts } = await supabase
      .from('image_tags')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .not('x_position', 'is', null);  // Only spatial tags (actual parts)

    if (!parts || parts.length === 0) {
      // No analysis needed yet
      return new Response(JSON.stringify({
        status: 'pending',
        message: 'No parts identified yet'
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Step 2: Calculate costs for each part
    const assessments = parts.map(part => {
      const condition = part.confidence || 100;  // 0-100
      const gradeOutOf10 = condition / 10;  // Convert to 1-10 scale
      
      // Get pricing from tag (already populated by parts marketplace)
      const lowestPrice = part.lowest_price_cents || 0;
      const highestPrice = part.highest_price_cents || 0;
      const avgPrice = (lowestPrice + highestPrice) / 2;
      
      // Current value = condition % of new price
      const currentValue = lowestPrice * (condition / 100);
      
      // Determine recommendation
      const repairEstimate = currentValue * 0.2;  // Assume repair is 20% of current value
      const shouldRepair = repairEstimate < avgPrice * 0.5 && gradeOutOf10 >= 5;
      
      return {
        part_name: part.tag_name,
        category: categorizeByTagType(part.tag_type),
        condition_grade: gradeOutOf10,
        current_value_cents: Math.round(currentValue),
        recommended_action: shouldRepair ? 'repair' : 'replace',
        cost_cents: shouldRepair ? Math.round(repairEstimate) : lowestPrice,
        is_critical: gradeOutOf10 < 4,
        supplier: part.suppliers?.[0]?.supplier_name || 'Unknown'
      };
    });

    // Step 3: Aggregate by category
    const byCategory = {
      body: assessments.filter(a => ['body', 'exterior'].includes(a.category)),
      paint: assessments.filter(a => a.category === 'paint'),
      mechanical: assessments.filter(a => ['engine', 'drivetrain', 'suspension'].includes(a.category)),
      interior: assessments.filter(a => a.category === 'interior'),
      electrical: assessments.filter(a => a.category === 'electrical')
    };

    // Step 4: Calculate totals
    const totalPartsCost = assessments.reduce((sum, a) => sum + a.cost_cents, 0);
    const avgCondition = assessments.reduce((sum, a) => sum + a.condition_grade, 0) / assessments.length;
    const criticalIssues = assessments.filter(a => a.is_critical).length;
    
    // DIY: Parts + materials (10% of parts) + no labor
    const diyTotal = totalPartsCost + (totalPartsCost * 0.1);
    
    // Shop: Parts + materials + labor (assume 1hr per part @ $75/hr)
    const laborHours = assessments.length;
    const shopLabor = laborHours * 7500;  // $75/hr in cents
    const shopTotal = totalPartsCost + (totalPartsCost * 0.1) + shopLabor;
    
    // Dealer: Parts markup 1.5x + labor @ $150/hr
    const dealerTotal = (totalPartsCost * 1.5) + (laborHours * 15000);

    // Step 5: Generate funding recommendation
    const fundingNeeded = Math.round(shopTotal * 0.7);  // 70% of shop cost
    const estimatedValue = await estimateCompletedValue(vehicleId, avgCondition);
    const potentialReturns = estimatedValue - shopTotal;
    const roiPercentage = (potentialReturns / fundingNeeded) * 100;

    // Step 6: Update vehicle record with facts
    await supabase
      .from('vehicles')
      .update({
        condition_rating: Math.round(avgCondition * 10) / 10,  // Round to 1 decimal
        restoration_estimate_cents: Math.round(shopTotal),  // Use shop estimate as baseline
        parts_tracked: assessments.length,
        critical_issues_count: criticalIssues,
        restoration_last_calculated: new Date().toISOString()
      })
      .eq('id', vehicleId);

    // Step 7: Create offering template (if owner wants to open to market)
    const offeringTemplate = {
      vehicle_id: vehicleId,
      funding_target_cents: fundingNeeded,
      use_of_funds: assessments,  // Detailed breakdown
      estimated_roi_percentage: Math.round(roiPercentage),
      completion_timeline_weeks: Math.ceil(laborHours / 40),  // Assume 40hr/week
      status: 'template'  // Not active until owner approves
    };

    return new Response(JSON.stringify({
      status: 'complete',
      facts: {
        overall_condition: avgCondition,
        parts_tracked: assessments.length,
        critical_issues: criticalIssues,
        diy_total_cents: Math.round(diyTotal),
        shop_total_cents: Math.round(shopTotal),
        dealer_total_cents: Math.round(dealerTotal)
      },
      offering_template: offeringTemplate,
      updated_at: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Auto-resto error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Helper functions
function categorizeByTagType(tagType: string): string {
  const mapping: Record<string, string> = {
    'part': 'mechanical',
    'body': 'body',
    'paint': 'paint',
    'interior': 'interior',
    'electrical': 'electrical',
    'engine': 'mechanical',
    'suspension': 'mechanical'
  };
  return mapping[tagType] || 'body';
}

async function estimateCompletedValue(vehicleId: string, currentGrade: number): Promise<number> {
  // Get current value
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('current_value')
    .eq('id', vehicleId)
    .single();
  
  if (!vehicle) return 0;
  
  // Estimate value if restored to 9/10 condition
  const currentValue = vehicle.current_value || 0;
  const valueMultiplier = 9 / currentGrade;  // How much value increases
  
  return Math.round(currentValue * valueMultiplier);
}

