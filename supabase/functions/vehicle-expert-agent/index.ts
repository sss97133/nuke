/**
 * Vehicle Expert Agent - Comprehensive AI Valuation Pipeline
 * 
 * Follows the proper data pipeline:
 * 1. Research vehicle Y/M/M → Become instant expert
 * 2. Assemble literature (manuals, forums, market data)
 * 3. Assess images → Tally value
 * 4. Extract environmental data (5 W's)
 * 5. Generate comprehensive valuation with evidence
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getLLMConfig, callLLM, type LLMProvider, type AnalysisTier } from '../_shared/llmProvider.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

interface VehicleContext {
  year: number;
  make: string;
  model: string;
  vin?: string;
  
  // Literature assembled
  buildManual?: string;
  serviceManual?: string;
  forumKnowledge?: string[];
  commonIssues?: string[];
  
  // Market intelligence
  marketSales: Array<{
    price: number;
    condition: string;
    date: string;
    source: string;
  }>;
  marketAverage: number;
  marketRange: { low: number; high: number };
  
  // Current state
  totalImages: number;
  photoDateRange: { earliest: string; latest: string };
}

interface ValuedComponent {
  name: string;
  partNumber?: string;
  condition: string;        // "Excellent", "Good", "Fair", "Poor"
  conditionGrade: number;   // 1-10
  estimatedValue: number;
  newPrice?: number;
  evidence: {
    imageUrls: string[];
    photoCount: number;
    location: string;       // "Front driver side", "Engine bay"
    datePhotographed: string;
  };
  confidence: number;
  reasoning: string;        // WHY this value
}

interface EnvironmentalContext {
  // From EXIF
  gpsLocations: Array<{ lat: number; lng: number; address?: string; count: number }>;
  cameraEquipment: string[];
  photoTimeline: Array<{ date: string; photoCount: number; location?: string }>;
  
  // From visual analysis
  workEnvironment: 'professional_shop' | 'home_garage' | 'driveway' | 'field' | 'storage';
  weatherConditions: string[];  // Seen in photos
  toolsVisible: string[];       // Professional vs DIY
  
  // 5 W's derived
  who: string[];       // Who worked on it (from environment clues)
  what: string[];      // What work was performed
  when: string;        // Timeline of work
  where: string;       // Where work happened
  why: string;         // Why (restoration, repair, modification)
}

interface ExpertValuation {
  vehicleContext: VehicleContext;
  components: ValuedComponent[];
  environmental: EnvironmentalContext;
  
  // Final assessment
  purchasePrice: number;
  documentedValue: number;      // Sum of components found
  estimatedTotalValue: number;  // Purchase + documented
  confidence: number;
  
  // Narrative explanation
  summary: string;
  valueJustification: string;   // WHY this value (answers the question)
  recommendations: string[];
  warnings: string[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    });
  }
  
  try {
    const { 
      vehicleId, 
      queueId,
      llmProvider,      // Optional: 'openai' | 'anthropic' | 'google'
      llmModel,         // Optional: specific model name
      analysisTier,    // Optional: 'tier1' | 'tier2' | 'tier3' | 'expert'
      userId            // Optional: for user API keys
    } = await req.json();
    
    if (!vehicleId) {
      throw new Error('vehicleId is required');
    }
    
    console.log(`🤖 Vehicle Expert Agent starting analysis for: ${vehicleId}${queueId ? ` (queue: ${queueId})` : ''}`);
    console.log(`📊 Analysis config: tier=${analysisTier || 'expert'}, provider=${llmProvider || 'auto'}, model=${llmModel || 'auto'}`);
    
    // Get LLM configuration
    const llmConfig = await getLLMConfig(
      supabase,
      userId || null,
      llmProvider,
      llmModel,
      analysisTier || 'expert'
    );
    
    console.log(`✅ Using LLM: ${llmConfig.provider}/${llmConfig.model} (${llmConfig.source} key)`);
    
    // Health check: Verify vehicle exists
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .eq('id', vehicleId)
      .single();
    
    if (vehicleError || !vehicle) {
      throw new Error(`Vehicle not found: ${vehicleId}`);
    }
    
    console.log(`✅ Vehicle verified: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    
    // STEP 1: Research Vehicle & Become Expert
    console.log(`📚 STEP 1: Researching vehicle context...`);
    const vehicleContext = await researchVehicle(vehicleId, llmConfig);
    console.log(`✅ Research complete: ${vehicleContext.year} ${vehicleContext.make} ${vehicleContext.model}`);
    console.log(`   - Market data: ${vehicleContext.marketSales.length} sales found`);
    console.log(`   - Photo timeline: ${vehicleContext.totalImages} images`);
    
    // STEP 2: Assess Images & Tally Value
    console.log(`💰 STEP 2: Assessing images and tallying value...`);
    const components = await assessImagesAndTallyValue(vehicleId, vehicleContext, llmConfig);
    console.log(`✅ Value assessment complete: ${components.length} components identified`);
    
    // STEP 3: Extract Environmental Data (5 W's)
    console.log(`🌍 STEP 3: Extracting environmental context...`);
    const environmental = await extractEnvironmentalContext(vehicleId, llmConfig);
    console.log(`✅ Environmental analysis complete`);
    console.log(`   - Work environment: ${environmental.workEnvironment}`);
    console.log(`   - Locations: ${environmental.gpsLocations.length} unique places`);
    
    // STEP 4: Generate Expert Valuation
    console.log(`📊 STEP 4: Generating expert valuation...`);
    const valuation = await generateExpertValuation(
      vehicleId,
      vehicleContext,
      components,
      environmental,
      llmConfig
    );
    
    // STEP 5: Save to database
    await saveValuation(vehicleId, valuation);
    
    console.log(`✅ Analysis complete for ${vehicleId}: $${valuation.estimatedTotalValue} (confidence: ${valuation.confidence}%)`);
    
    return new Response(JSON.stringify(valuation), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error: any) {
    console.error('❌ Expert agent error:', error);
    console.error('Stack:', error.stack);
    
    // Enhanced error response with details for debugging
    return new Response(JSON.stringify({ 
      error: error.message,
      errorType: error.name,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
});

/**
 * STEP 1: Research Vehicle & Become Instant Expert
 */
async function researchVehicle(vehicleId: string, llmConfig: any): Promise<VehicleContext> {
  // Get basic vehicle data
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('year, make, model, vin, purchase_price, purchase_date')
    .eq('id', vehicleId)
    .single();
  
  if (!vehicle) throw new Error('Vehicle not found');
  
  // Get photo timeline
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('taken_at, latitude, longitude')
    .eq('vehicle_id', vehicleId)
    .order('taken_at', { ascending: true });
  
  const photoDateRange = {
    earliest: images?.[0]?.taken_at || 'Unknown',
    latest: images?.[images.length - 1]?.taken_at || 'Unknown'
  };
  
  // Research market sales for this Y/M/M
  const { data: marketSales } = await supabase
    .from('market_data')
    .select('price_value, condition, created_at, source')
    .eq('make', vehicle.make)
    .eq('year', vehicle.year)
    .limit(20);
  
  const sales = (marketSales || []).map(s => ({
    price: parseFloat(s.price_value) || 0,
    condition: s.condition || 'Unknown',
    date: s.created_at,
    source: s.source
  })).filter(s => s.price > 0);
  
  const marketAverage = sales.length > 0
    ? sales.reduce((sum, s) => sum + s.price, 0) / sales.length
    : 0;
  
  const marketRange = sales.length > 0
    ? {
        low: Math.min(...sales.map(s => s.price)),
        high: Math.max(...sales.map(s => s.price))
      }
    : { low: 0, high: 0 };
  
  // Assemble vehicle literature using AI
  const literaturePrompt = `You are a vehicle expert researching a ${vehicle.year} ${vehicle.make} ${vehicle.model}.

Research and provide:
1. Common issues for this year/make/model
2. Key specs (engine options, transmission, notable features)
3. What makes this vehicle valuable or problematic
4. Typical restoration/modification points
5. Forum knowledge (what enthusiasts care about)

Be specific to THIS exact year/make/model. Return as JSON:
{
  "commonIssues": ["issue1", "issue2"],
  "keySpecs": "...",
  "valueDrivers": ["driver1", "driver2"],
  "forumKnowledge": ["fact1", "fact2"]
}`;

  console.log(`  🔍 Researching vehicle literature using ${llmConfig.provider}/${llmConfig.model}...`);
  const litResponse = await callLLM(
    llmConfig,
    [{ role: 'user', content: literaturePrompt }],
    { temperature: 0.3 }
  );
  
  const literature = JSON.parse(
    litResponse.content?.match(/\{[\s\S]*\}/)?.[0] || '{}'
  );
  console.log(`  ✅ Literature research complete (${litResponse.duration_ms}ms)`);
  
  return {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    vin: vehicle.vin,
    commonIssues: literature.commonIssues || [],
    forumKnowledge: literature.forumKnowledge || [],
    marketSales: sales,
    marketAverage,
    marketRange,
    totalImages: images?.length || 0,
    photoDateRange
  };
}

/**
 * STEP 2: Assess Images & Tally Value
 */
async function assessImagesAndTallyValue(
  vehicleId: string,
  context: VehicleContext,
  llmConfig: any
): Promise<ValuedComponent[]> {
  // Get all images
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, variants, taken_at, category, latitude, longitude')
    .eq('vehicle_id', vehicleId)
    .order('taken_at', { ascending: true });
  
  if (!images || images.length === 0) return [];
  
  // Sample images for analysis (don't analyze all 160, too expensive)
  // Take every 5th image to get good coverage
  const sampledImages = images.filter((_, idx) => idx % 5 === 0).slice(0, 30);
  
  const components: ValuedComponent[] = [];
  
  // Batch analyze images using GPT-4 Vision
  const analysisPrompt = `You are an expert appraiser for a ${context.year} ${context.make} ${context.model}.

VEHICLE KNOWLEDGE:
- Common issues: ${context.commonIssues.join(', ')}
- Market average: $${context.marketAverage.toLocaleString()}
- Known for: ${context.forumKnowledge.join('; ')}

TASK: Analyze these photos and identify EVERY component/part visible that has VALUE.
For each component found, provide:
1. Specific name (e.g., "Front Dana 44 Axle", not just "Axle")
2. Condition grade (1-10) based on visual inspection
3. Estimated value in current condition
4. What photo evidence shows
5. WHY this value (explain reasoning)

Return JSON array:
[{
  "name": "Front Dana 44 Axle Assembly",
  "condition": "Very Good",
  "conditionGrade": 8,
  "estimatedValue": 450,
  "newPrice": 895,
  "location": "Front undercarriage",
  "evidence": "Visible in photos 3, 7, 12. Light surface rust but solid structure.",
  "reasoning": "Dana 44 front axle for 1974 Bronco runs $800-1000 new. This unit shows light surface rust but no structural damage, good gear oil, intact boots. Worth ~50% of new value."
}]

Focus on SUBSTANTIVE parts worth >$50. Ignore minor items.`;

  const imageContent = sampledImages.map(img => ({
    type: 'image_url' as const,
    image_url: {
      url: img.variants?.medium || img.image_url,
      detail: 'high' as const
    }
  }));
  
  console.log(`  🔍 Analyzing ${sampledImages.length} images using ${llmConfig.provider}/${llmConfig.model}...`);
  const response = await callLLM(
    llmConfig,
    [{
      role: 'user',
      content: [
        { type: 'text', text: analysisPrompt },
        ...imageContent
      ]
    }],
    { maxTokens: 4000, temperature: 0.3, vision: true }
  );
  
  console.log(`  ✅ Image analysis complete (${response.duration_ms}ms, ${response.usage?.total_tokens || 'unknown'} tokens)`);
  const content = response.content || '';
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  
  if (jsonMatch) {
    const parsedComponents = JSON.parse(jsonMatch[0]);
    
    for (const comp of parsedComponents) {
      // Find which specific images show this component
      const relatedImages = images.filter(img => 
        comp.evidence?.toLowerCase().includes(`photo ${images.indexOf(img) + 1}`) ||
        (img.category && comp.location?.toLowerCase().includes(img.category.toLowerCase()))
      ).slice(0, 5);
      
      components.push({
        name: comp.name,
        partNumber: comp.partNumber,
        condition: comp.condition,
        conditionGrade: comp.conditionGrade,
        estimatedValue: comp.estimatedValue || 0,
        newPrice: comp.newPrice,
        evidence: {
          imageUrls: relatedImages.map(i => i.variants?.thumbnail || i.image_url),
          photoCount: relatedImages.length,
          location: comp.location || 'Unknown',
          datePhotographed: relatedImages[0]?.taken_at || 'Unknown'
        },
        confidence: comp.conditionGrade >= 7 ? 90 : comp.conditionGrade >= 5 ? 75 : 60,
        reasoning: comp.reasoning || ''
      });
    }
  }
  
  return components;
}

/**
 * STEP 3: Extract Environmental Context (5 W's)
 */
async function extractEnvironmentalContext(vehicleId: string, llmConfig: any): Promise<EnvironmentalContext> {
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('taken_at, latitude, longitude, exif_data, image_url, variants')
    .eq('vehicle_id', vehicleId);
  
  if (!images || images.length === 0) {
    return {
      gpsLocations: [],
      cameraEquipment: [],
      photoTimeline: [],
      workEnvironment: 'home_garage',
      weatherConditions: [],
      toolsVisible: [],
      who: [],
      what: [],
      when: 'Unknown',
      where: 'Unknown',
      why: 'Unknown'
    };
  }
  
  // Extract GPS locations
  const gpsMap = new Map<string, number>();
  images.forEach(img => {
    if (img.latitude && img.longitude) {
      const key = `${img.latitude.toFixed(4)},${img.longitude.toFixed(4)}`;
      gpsMap.set(key, (gpsMap.get(key) || 0) + 1);
    }
  });
  
  const gpsLocations = Array.from(gpsMap.entries()).map(([coords, count]) => {
    const [lat, lng] = coords.split(',').map(Number);
    return { lat, lng, count };
  });
  
  // Extract camera equipment
  const cameras = new Set<string>();
  images.forEach(img => {
    const exif = img.exif_data;
    if (exif?.camera?.Make && exif?.camera?.Model) {
      cameras.add(`${exif.camera.Make} ${exif.camera.Model}`);
    }
  });
  
  // Build photo timeline
  const timelineMap = new Map<string, number>();
  images.forEach(img => {
    const date = img.taken_at?.split('T')[0] || 'Unknown';
    timelineMap.set(date, (timelineMap.get(date) || 0) + 1);
  });
  
  const photoTimeline = Array.from(timelineMap.entries())
    .map(([date, photoCount]) => ({ date, photoCount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  // Analyze work environment using AI on sample photos
  const sampleImages = images.filter((_, idx) => idx % 10 === 0).slice(0, 5);
  
  const envPrompt = `Analyze these photos to determine the work environment and context.

Identify:
1. Work environment type (professional shop, home garage, driveway, etc.)
2. Weather/lighting conditions visible
3. Tools visible (professional vs DIY)
4. WHO: Clues about who did the work (professional shop, owner, friend)
5. WHAT: Type of work being performed (restoration, repair, modification, inspection)
6. WHERE: Specific location characteristics
7. WHY: Purpose of the work (preserve, upgrade, fix issues, prepare for sale)

Return JSON:
{
  "workEnvironment": "home_garage|professional_shop|driveway|field|storage",
  "weatherConditions": ["sunny", "indoor"],
  "toolsVisible": ["floor jack", "impact wrench"],
  "who": ["Owner (DIY setup)", "Professional mechanic"],
  "what": ["Suspension replacement", "Rust repair"],
  "where": "Home garage with concrete floor, good lighting",
  "why": "Restoration - bringing vehicle to showroom condition"
}`;

  const envImages = sampleImages.map(img => ({
    type: 'image_url' as const,
    image_url: {
      url: img.variants?.medium || img.image_url,
      detail: 'low' as const
    }
  }));
  
  console.log(`  🔍 Extracting environmental context using ${llmConfig.provider}/${llmConfig.model}...`);
  const envResponse = await callLLM(
    llmConfig,
    [{
      role: 'user',
      content: [
        { type: 'text', text: envPrompt },
        ...envImages
      ]
    }],
    { maxTokens: 1000, temperature: 0.3, vision: true }
  );
  
  console.log(`  ✅ Environmental extraction complete (${envResponse.duration_ms}ms)`);
  const envData = JSON.parse(
    envResponse.content?.match(/\{[\s\S]*\}/)?.[0] || '{}'
  );
  
  return {
    gpsLocations,
    cameraEquipment: Array.from(cameras),
    photoTimeline,
    workEnvironment: envData.workEnvironment || 'home_garage',
    weatherConditions: envData.weatherConditions || [],
    toolsVisible: envData.toolsVisible || [],
    who: envData.who || [],
    what: envData.what || [],
    when: photoTimeline.length > 0 
      ? `${photoTimeline[0].date} to ${photoTimeline[photoTimeline.length - 1].date}`
      : 'Unknown',
    where: envData.where || (gpsLocations.length > 0 ? `${gpsLocations.length} locations` : 'Unknown'),
    why: envData.why || 'Unknown'
  };
}

/**
 * STEP 4: Generate Expert Valuation with WHY
 */
async function generateExpertValuation(
  vehicleId: string,
  context: VehicleContext,
  components: ValuedComponent[],
  environmental: EnvironmentalContext,
  llmConfig: any
): Promise<ExpertValuation> {
  // Get purchase price from database
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('purchase_price')
    .eq('id', vehicleId)
    .single();
  
  const purchasePrice = vehicle?.purchase_price || 0;
  const documentedValue = components.reduce((sum, c) => sum + c.estimatedValue, 0);
  const estimatedTotalValue = purchasePrice + documentedValue;
  
  // Generate narrative explanation
  const summary = `${context.year} ${context.make} ${context.model} analysis based on ${context.totalImages} photos taken between ${context.photoDateRange.earliest} and ${context.photoDateRange.latest}.`;
  
  const valueJustification = `
PURCHASE FLOOR: $${purchasePrice.toLocaleString()} establishes baseline value.

DOCUMENTED COMPONENTS (${components.length} identified):
${components.map(c => 
  `- ${c.name}: $${c.estimatedValue} (${c.condition} - ${c.conditionGrade}/10)
   Evidence: ${c.evidence.photoCount} photos showing ${c.evidence.location}
   ${c.reasoning}`
).join('\n\n')}

WORK CONTEXT:
- Environment: ${environmental.workEnvironment.replace(/_/g, ' ')}
- Who: ${environmental.who.join(', ')}
- What: ${environmental.what.join(', ')}
- When: ${environmental.when}
- Where: ${environmental.where}
- Why: ${environmental.why}

TOTAL VALUE: $${estimatedTotalValue.toLocaleString()} 
($${purchasePrice.toLocaleString()} purchase + $${documentedValue.toLocaleString()} documented components)

This valuation is based on visual evidence from photos. Components were identified and condition-assessed through detailed image analysis. Market reference: $${context.marketAverage.toLocaleString()} (${context.marketSales.length} comparable sales).
`.trim();
  
  const recommendations: string[] = [];
  const warnings: string[] = [];
  
  // Generate recommendations
  if (documentedValue < context.marketAverage * 0.2) {
    recommendations.push('Consider documenting additional work with receipts and photos');
  }
  
  if (components.filter(c => c.conditionGrade < 5).length > 0) {
    warnings.push('Some components in poor condition may affect value');
  }
  
  if (purchasePrice > context.marketAverage * 1.3) {
    warnings.push(`Purchase price was ${((purchasePrice / context.marketAverage - 1) * 100).toFixed(0)}% above market average`);
  }
  
  if (environmental.workEnvironment === 'field' || environmental.workEnvironment === 'storage') {
    warnings.push('Outdoor storage visible in photos may indicate exposure damage');
  }
  
  return {
    vehicleContext: context,
    components,
    environmental,
    purchasePrice,
    documentedValue,
    estimatedTotalValue,
    confidence: components.length > 5 ? 85 : components.length > 2 ? 70 : 60,
    summary,
    valueJustification,
    recommendations,
    warnings
  };
}

/**
 * Save valuation to database
 */
async function saveValuation(vehicleId: string, valuation: ExpertValuation): Promise<void> {
  // Update vehicle current_value
  await supabase
    .from('vehicles')
    .update({
      current_value: valuation.estimatedTotalValue
    })
    .eq('id', vehicleId);
  
  // Save detailed valuation for audit trail
  await supabase
    .from('vehicle_valuations')
    .insert({
      vehicle_id: vehicleId,
      estimated_value: valuation.estimatedTotalValue,
      documented_components: valuation.documentedValue,
      confidence_score: valuation.confidence,
      components: valuation.components,
      environmental_context: valuation.environmental,
      value_justification: valuation.valueJustification,
      methodology: 'expert_agent_v1'
    });
  
  // **CRITICAL**: Update vehicles.current_value to unify all pricing displays
  await supabase
    .from('vehicles')
    .update({ 
      current_value: valuation.estimatedTotalValue,
      updated_at: new Date().toISOString()
    })
    .eq('id', vehicleId);
  
  // Record price change in history (trigger will handle this automatically via vehicles update)
  // But also add expert agent metadata for audit trail
  await supabase
    .from('vehicle_price_history')
    .insert({
      vehicle_id: vehicleId,
      price_type: 'current',
      value: valuation.estimatedTotalValue,
      source: 'expert_agent',
      confidence: Math.round(valuation.confidence ?? 0),
      as_of: new Date().toISOString()
    });
  
  // Enrich existing tags with value data
  for (const component of valuation.components) {
    // Find matching tags
    const { data: matchingTags } = await supabase
      .from('image_tags')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .ilike('tag_name', `%${component.name.split(' ')[0]}%`)
      .limit(10);
    
    if (matchingTags && matchingTags.length > 0) {
      // Enrich with value data
      await supabase
        .from('image_tags')
        .update({
          metadata: {
            estimated_value_cents: Math.round(component.estimatedValue * 100),
            condition_grade: component.conditionGrade,
            condition_label: component.condition,
            part_number: component.partNumber,
            reasoning: component.reasoning,
            expert_assessed: true,
            assessed_at: new Date().toISOString()
          }
        })
        .in('id', matchingTags.map(t => t.id));
    }
  }
}

