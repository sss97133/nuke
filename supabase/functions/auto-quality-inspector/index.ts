/**
 * Automatic Quality Inspector
 * 
 * Like code review, but for vehicle restorations.
 * Assesses build quality, documentation thoroughness, builder credibility.
 * Generates investment confidence score automatically.
 * 
 * Runs whenever:
 * - Images uploaded
 * - Tags verified
 * - Timeline updated
 * - Receipts added
 * 
 * User provides: Documentation (images, receipts, timeline, ownership)
 * System provides: Quality grade + investment confidence
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

interface QualityReport {
  overall_grade: number;  // 1-10
  investment_grade: string;  // A+, A, B+, B, C+, C, D, F
  confidence_percentage: number;  // 0-100
  
  scores: {
    parts_quality: number;
    documentation_thoroughness: number;
    builder_credibility: number;
    timeline_realism: number;
    owner_credibility: number;
  };
  
  flags: {
    type: 'positive' | 'warning' | 'critical';
    message: string;
  }[];
  
  investment_recommendation: 'strong_buy' | 'buy' | 'hold' | 'caution' | 'avoid';
}

serve(async (req) => {
  try {
    const { vehicleId } = await req.json();

    // STEP 1: ASSESS PARTS QUALITY
    const partsScore = await assessPartsQuality(vehicleId);
    
    // STEP 2: ASSESS DOCUMENTATION
    const docsScore = await assessDocumentation(vehicleId);
    
    // STEP 3: ASSESS BUILDER CREDIBILITY
    const builderScore = await assessBuilder(vehicleId);
    
    // STEP 4: ASSESS TIMELINE REALISM
    const timelineScore = await assessTimeline(vehicleId);
    
    // STEP 5: ASSESS OWNER CREDIBILITY
    const ownerScore = await assessOwner(vehicleId);
    
    // STEP 6: CALCULATE OVERALL GRADE
    const overallGrade = (
      partsScore * 0.30 +        // Parts quality is 30% of grade
      docsScore * 0.25 +          // Documentation is 25%
      builderScore * 0.20 +       // Builder is 20%
      timelineScore * 0.15 +      // Timeline is 15%
      ownerScore * 0.10           // Owner is 10%
    );
    
    // STEP 7: GENERATE FLAGS
    const flags = generateFlags({
      partsScore,
      docsScore,
      builderScore,
      timelineScore,
      ownerScore
    });
    
    // STEP 8: DETERMINE INVESTMENT GRADE
    const investmentGrade = calculateInvestmentGrade(overallGrade);
    const confidence = calculateConfidence(docsScore, builderScore, ownerScore);
    const recommendation = getRecommendation(overallGrade, confidence);

    // STEP 9: UPDATE VEHICLE RECORD (AUTOMATIC - NO USER ACTION)
    await supabase
      .from('vehicles')
      .update({
        quality_grade: Math.round(overallGrade * 10) / 10,
        investment_grade: investmentGrade,
        investment_confidence: confidence,
        quality_last_assessed: new Date().toISOString()
      })
      .eq('id', vehicleId);

    const report: QualityReport = {
      overall_grade: overallGrade,
      investment_grade: investmentGrade,
      confidence_percentage: confidence,
      scores: {
        parts_quality: partsScore,
        documentation_thoroughness: docsScore,
        builder_credibility: builderScore,
        timeline_realism: timelineScore,
        owner_credibility: ownerScore
      },
      flags,
      investment_recommendation: recommendation
    };

    return new Response(JSON.stringify(report), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Quality inspection error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// ============================================================================
// QUALITY ASSESSMENT FUNCTIONS
// ============================================================================

async function assessPartsQuality(vehicleId: string): Promise<number> {
  const { data: tags } = await supabase
    .from('image_tags')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .eq('tag_type', 'part');

  if (!tags || tags.length === 0) return 5.0;  // Neutral if no data

  let totalScore = 0;
  let partCount = 0;

  for (const tag of tags) {
    partCount++;
    
    // Check if OEM (from part number format or supplier)
    const isOEM = tag.oem_part_number?.match(/^(GM|GMC|FORD|DODGE|MOPAR)-/);
    const isNameBrand = tag.suppliers?.some((s: any) => 
      ['BFGoodrich', 'Edelbrock', 'Holley', 'Bilstein'].includes(s.brand)
    );
    
    // Check condition from AI assessment
    const condition = tag.condition || 'unknown';
    const verified = tag.verified;
    
    let partScore = 5.0;  // Start neutral
    
    if (isOEM) partScore += 3.0;
    else if (isNameBrand) partScore += 2.0;
    else partScore += 1.0;  // Generic aftermarket
    
    if (condition === 'new' || condition === 'excellent') partScore += 2.0;
    else if (condition === 'good') partScore += 1.0;
    else if (condition === 'fair') partScore += 0;
    else if (condition === 'poor') partScore -= 2.0;
    
    if (verified) partScore += 0.5;  // Verified tags are more trustworthy
    
    totalScore += Math.max(1, Math.min(10, partScore));
  }

  return partCount > 0 ? totalScore / partCount : 5.0;
}

async function assessDocumentation(vehicleId: string): Promise<number> {
  // Get all documentation metrics
  const [images, receipts, events, tags] = await Promise.all([
    supabase.from('vehicle_images').select('id').eq('vehicle_id', vehicleId),
    supabase.from('vehicle_receipts').select('id').eq('vehicle_id', vehicleId),
    supabase.from('vehicle_timeline_events').select('id').eq('vehicle_id', vehicleId),
    supabase.from('image_tags').select('id').eq('vehicle_id', vehicleId).not('x_position', 'is', null)
  ]);

  const imageCount = images.data?.length || 0;
  const receiptCount = receipts.data?.length || 0;
  const eventCount = events.data?.length || 0;
  const tagCount = tags.data?.length || 0;

  let score = 0;

  // Image coverage (every angle, step documented)
  if (imageCount >= 200) score += 3.0;  // Exceptional
  else if (imageCount >= 100) score += 2.5;  // Excellent
  else if (imageCount >= 50) score += 2.0;  // Good
  else if (imageCount >= 20) score += 1.0;  // Adequate
  else score += 0.5;  // Sparse

  // Receipt documentation (every purchase tracked)
  if (receiptCount >= 30) score += 2.5;  // Every part documented
  else if (receiptCount >= 15) score += 2.0;  // Most parts documented
  else if (receiptCount >= 5) score += 1.0;  // Some documentation
  else score += 0.5;  // Minimal

  // Timeline completeness (work progression documented)
  if (eventCount >= 100) score += 2.0;  // Detailed timeline
  else if (eventCount >= 50) score += 1.5;  // Good timeline
  else if (eventCount >= 20) score += 1.0;  // Basic timeline
  else score += 0.5;  // Sparse

  // Parts tagging (parts identified and cataloged)
  if (tagCount >= 50) score += 2.0;  // Comprehensive
  else if (tagCount >= 25) score += 1.5;  // Good coverage
  else if (tagCount >= 10) score += 1.0;  // Basic
  else score += 0.5;  // Minimal

  // Bonus: Documentation density (images per event)
  const density = eventCount > 0 ? imageCount / eventCount : 0;
  if (density >= 3) score += 0.5;  // 3+ images per work session = thorough

  return Math.min(10, score);
}

async function assessBuilder(vehicleId: string): Promise<number> {
  // Get builder/uploader info
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('uploaded_by')
    .eq('id', vehicleId)
    .single();

  if (!vehicle) return 5.0;

  // Get builder profile and history
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', vehicle.uploaded_by)
    .single();

  // Get builder's other vehicles
  const { data: builderVehicles } = await supabase
    .from('vehicles')
    .select('id, quality_grade')
    .eq('uploaded_by', vehicle.uploaded_by);

  let score = 5.0;  // Start neutral

  if (profile) {
    // Professional shop/builder
    if (profile.role === 'shop' || profile.role === 'professional_builder') {
      score += 3.0;
    }
    
    // Verified account
    if (profile.email_verified) {
      score += 1.0;
    }
  }

  // Track record (other builds)
  const buildCount = builderVehicles?.length || 0;
  if (buildCount >= 10) score += 2.0;  // Experienced builder
  else if (buildCount >= 5) score += 1.5;
  else if (buildCount >= 2) score += 1.0;
  
  // Quality of past work
  const avgPastQuality = builderVehicles && buildCount > 1
    ? builderVehicles.filter(v => v.id !== vehicleId && v.quality_grade).reduce((sum, v) => sum + (v.quality_grade || 0), 0) / (buildCount - 1)
    : 0;
  
  if (avgPastQuality >= 8) score += 1.0;  // Consistently high quality
  else if (avgPastQuality >= 6) score += 0.5;

  return Math.min(10, score);
}

async function assessTimeline(vehicleId: string): Promise<number> {
  const { data: events } = await supabase
    .from('vehicle_timeline_events')
    .select('event_date, event_type')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: true });

  if (!events || events.length < 5) return 5.0;  // Not enough data

  let score = 5.0;

  // Calculate timeline span
  const firstDate = new Date(events[0].event_date);
  const lastDate = new Date(events[events.length - 1].event_date);
  const durationMonths = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 30);

  // Realistic restoration timeline (6-12 months ideal)
  if (durationMonths >= 6 && durationMonths <= 12) score += 3.0;  // Perfect pace
  else if (durationMonths >= 3 && durationMonths <= 18) score += 2.0;  // Good pace
  else if (durationMonths >= 1 && durationMonths <= 24) score += 1.0;  // Acceptable
  else if (durationMonths < 1) score -= 2.0;  // RED FLAG: Too fast
  else score += 0.5;  // Very slow but thorough

  // Work consistency (events spread evenly vs bursts)
  const eventsPerMonth = events.length / Math.max(1, durationMonths);
  if (eventsPerMonth >= 5 && eventsPerMonth <= 20) score += 2.0;  // Consistent work
  else if (eventsPerMonth >= 2) score += 1.0;  // Moderate consistency

  return Math.min(10, score);
}

async function assessOwner(vehicleId: string): Promise<number> {
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('uploaded_by')
    .eq('id', vehicleId)
    .single();

  if (!vehicle) return 5.0;

  // Check for title verification
  const { data: verifications } = await supabase
    .from('ownership_verifications')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .eq('status', 'verified');

  let score = 5.0;

  // Title verified = highest trust
  if (verifications && verifications.length > 0) {
    score += 5.0;  // Proven owner
  }

  // Check owner's other vehicles
  const { data: ownerVehicles } = await supabase
    .from('vehicles')
    .select('id')
    .eq('uploaded_by', vehicle.uploaded_by);

  const vehicleCount = ownerVehicles?.length || 0;
  if (vehicleCount >= 5) score += 1.0;  // Serious collector
  else if (vehicleCount >= 2) score += 0.5;

  return Math.min(10, score);
}

function generateFlags(scores: any): any[] {
  const flags = [];

  // Positive flags
  if (scores.partsScore >= 8.5) {
    flags.push({
      type: 'positive',
      message: 'High-quality OEM/name brand parts identified'
    });
  }
  
  if (scores.docsScore >= 8.5) {
    flags.push({
      type: 'positive',
      message: 'Exceptionally thorough documentation (investor confidence high)'
    });
  }

  if (scores.builderScore >= 8.0) {
    flags.push({
      type: 'positive',
      message: 'Professional builder with proven track record'
    });
  }

  // Warning flags
  if (scores.timelineScore < 5) {
    flags.push({
      type: 'warning',
      message: 'Timeline suspiciously short - verify claims'
    });
  }

  if (scores.docsScore < 4) {
    flags.push({
      type: 'warning',
      message: 'Limited documentation - difficult to verify quality'
    });
  }

  // Critical flags
  if (scores.ownerScore < 3) {
    flags.push({
      type: 'critical',
      message: 'No title verification - ownership not proven'
    });
  }

  if (scores.partsScore < 4) {
    flags.push({
      type: 'critical',
      message: 'Low-quality parts detected - poor investment'
    });
  }

  return flags;
}

function calculateInvestmentGrade(overallGrade: number): string {
  if (overallGrade >= 9.5) return 'A+';
  if (overallGrade >= 9.0) return 'A';
  if (overallGrade >= 8.5) return 'A-';
  if (overallGrade >= 8.0) return 'B+';
  if (overallGrade >= 7.0) return 'B';
  if (overallGrade >= 6.0) return 'B-';
  if (overallGrade >= 5.0) return 'C+';
  if (overallGrade >= 4.0) return 'C';
  if (overallGrade >= 3.0) return 'C-';
  if (overallGrade >= 2.0) return 'D';
  return 'F';
}

function calculateConfidence(docsScore: number, builderScore: number, ownerScore: number): number {
  // Confidence based on verifiability
  const confidence = (
    docsScore * 0.5 +      // Documentation is 50% of confidence
    ownerScore * 0.3 +     // Owner verification is 30%
    builderScore * 0.2     // Builder reputation is 20%
  ) * 10;  // Convert to percentage
  
  return Math.round(Math.min(100, confidence));
}

function getRecommendation(grade: number, confidence: number): string {
  if (grade >= 8.5 && confidence >= 80) return 'strong_buy';
  if (grade >= 7.0 && confidence >= 70) return 'buy';
  if (grade >= 5.5 && confidence >= 60) return 'hold';
  if (grade >= 4.0 || confidence >= 50) return 'caution';
  return 'avoid';
}

