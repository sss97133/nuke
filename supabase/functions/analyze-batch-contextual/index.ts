/**
 * CONTEXTUAL BATCH IMAGE ANALYZER
 * 
 * Analyzes image batches with full situational understanding:
 * 1. Loads complete vehicle context (specs, history, owner patterns)
 * 2. Analyzes temporal context (what happened before/after)
 * 3. Understands user association patterns
 * 4. Calculates commitment level based on time investment
 * 5. Develops user contribution score
 * 6. Records comprehensive analysis in database
 * 
 * Based on Claude system prompt best practices:
 * https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/system-prompts
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BatchContext {
  vehicle: {
    id: string
    year: number
    make: string
    model: string
    trim?: string
    vin?: string
    mileage?: number
  }
  user: {
    id: string
    username?: string
    full_name?: string
  }
  imageBatch: {
    image_ids: string[]
    image_urls: string[]
    taken_dates: string[]
    count: number
    time_span_hours: number
    date_range: { earliest: string; latest: string }
  }
  temporalContext: {
    previousBatches: Array<{
      date: string
      image_count: number
      work_type?: string
      time_investment_hours?: number
    }>
    subsequentBatches: Array<{
      date: string
      image_count: number
      work_type?: string
    }>
    timeSinceLastBatch: number // hours
    timeUntilNextBatch: number // hours
  }
  vehicleHistory: {
    total_timeline_events: number
    recent_work: Array<{
      date: string
      type: string
      description: string
    }>
    known_issues: string[]
    modifications: string[]
  }
  userPatterns: {
    total_contributions: number
    average_batch_size: number
    average_time_between_batches: number
    typical_work_types: string[]
    commitment_level: 'casual' | 'regular' | 'dedicated' | 'expert'
  }
}

interface SituationalAnalysis {
  // THE 5 W's - Journalistic structure
  who: {
    primary_actor: string // Who did the work
    skill_level: 'professional' | 'skilled_enthusiast' | 'diy_learner' | 'helper'
    involvement_type: 'hands_on_work' | 'supervision' | 'documentation' | 'assistance'
  }
  
  what: {
    work_performed: string // What was done (detailed)
    work_category: 'maintenance' | 'repair' | 'restoration' | 'modification' | 'inspection' | 'documentation'
    components_affected: string[]
    tools_equipment_used: string[]
    parts_materials: string[]
  }
  
  when: {
    session_date: string
    estimated_duration_hours: number
    time_of_day_indicator?: 'morning' | 'afternoon' | 'evening' | 'night' | 'unknown'
    is_continuation: boolean
    continuation_of?: string
    is_preparation: boolean
    preparation_for?: string
  }
  
  where: {
    work_location: 'professional_shop' | 'home_garage' | 'driveway' | 'mobile' | 'unknown'
    location_indicators: string[]
    environment_quality: 'professional' | 'well_equipped' | 'basic' | 'minimal'
  }
  
  why: {
    primary_motivation: string // Why this work was done
    problem_being_solved?: string
    goal_being_achieved?: string
    preventive_vs_reactive: 'preventive' | 'reactive' | 'improvement' | 'emergency'
    necessity_level: 'critical' | 'important' | 'beneficial' | 'optional'
  }
  
  // VALUE CALCULATION
  value_assessment: {
    labor_value: {
      estimated_hours: number
      skill_rate_per_hour: number // Market rate for this skill level
      total_labor_value: number
    }
    documentation_value: {
      photo_quality: 'excellent' | 'good' | 'adequate' | 'poor'
      documentation_completeness: number // 0-100
      estimated_value: number // What this documentation adds to vehicle value
    }
    vehicle_impact: {
      impact_type: 'increases_value' | 'maintains_value' | 'prevents_loss' | 'neutral'
      estimated_impact_amount: number // Dollar amount impact on vehicle value
      explanation: string
    }
    market_comparison: {
      shop_cost_equivalent: number // What this would cost at a shop
      savings_realized: number // If DIY, savings vs shop
      parts_cost_estimate?: number
    }
    total_event_value: number // Combined value of this work session
    value_confidence: number // 0-100 confidence in valuation
  }
  
  // Narrative
  narrative_summary: string // One paragraph story of what happened
  
  // Context
  relationship_to_vehicle_history: string
  patterns_detected: string[]

  // Follow-up questions for originator
  originator_questions?: string[]
  
  // Confidence
  confidence_score: number // 0-100
  reasoning: string
}

interface UserCommitmentScore {
  time_investment_score: number // Based on hours spent
  consistency_score: number // Based on regular contributions
  quality_score: number // Based on work quality indicators
  engagement_score: number // Based on batch frequency
  overall_commitment: number // 0-100
  level: 'casual' | 'regular' | 'dedicated' | 'expert'
  factors: string[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { event_id, vehicle_id, user_id, image_ids, originator_context, context_questions } = await req.json()
    
    if (!event_id || !vehicle_id || !user_id || !image_ids || image_ids.length === 0) {
      throw new Error('Missing required parameters: event_id, vehicle_id, user_id, image_ids')
    }

    const originatorContext = typeof originator_context === 'string' ? originator_context.trim() : ''
    const contextQuestions = Array.isArray(context_questions)
      ? context_questions.filter((q) => typeof q === 'string' && q.trim().length > 0).map((q) => q.trim())
      : []

    console.log(`[Contextual Batch Analyzer] Analyzing batch: ${image_ids.length} images for event ${event_id}`)

    // STEP 1: Load complete context
    const context = await loadCompleteContext(supabase, vehicle_id, user_id, image_ids)
    
    // STEP 2: Analyze images with Claude (using system prompt)
    const situationalAnalysis = await analyzeSituationalContext(context, {
      originatorContext,
      contextQuestions
    })
    
    // STEP 3: Calculate user commitment score
    const commitmentScore = calculateUserCommitmentScore(context, situationalAnalysis)
    
    // STEP 4: Save analysis to database
    await saveContextualAnalysis(
      supabase,
      event_id,
      context,
      situationalAnalysis,
      commitmentScore,
      originatorContext,
      contextQuestions
    )
    
    // STEP 5: Update timeline event with contextual information
    await updateTimelineEvent(supabase, event_id, situationalAnalysis, commitmentScore)

    return new Response(
      JSON.stringify({
        success: true,
        analysis: {
          situation: situationalAnalysis.situation_summary,
          work_type: situationalAnalysis.work_type,
          commitment_level: commitmentScore.overall_commitment,
          commitment_level_label: commitmentScore.level
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[Contextual Batch Analyzer] Error:', error)
    console.error('[Contextual Batch Analyzer] Stack:', error.stack)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        stack: error.stack
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function loadCompleteContext(
  supabase: any,
  vehicleId: string,
  userId: string,
  imageIds: string[]
): Promise<BatchContext> {
  // Load vehicle
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, year, make, model, trim, vin, mileage')
    .eq('id', vehicleId)
    .single()

  // Load user
  const { data: user } = await supabase
    .from('profiles')
    .select('id, username, full_name')
    .eq('id', userId)
    .single()

  // Load image batch details
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, taken_at')
    .in('id', imageIds)
    .order('taken_at', { ascending: true })

  if (!images || images.length === 0) {
    throw new Error('No images found for the provided image IDs')
  }

  const takenDates = images.map(img => img.taken_at).filter(Boolean)
  const earliest = takenDates[0] ? new Date(takenDates[0]) : new Date()
  const latest = takenDates[takenDates.length - 1] ? new Date(takenDates[takenDates.length - 1]) : new Date()
  const timeSpanHours = (latest.getTime() - earliest.getTime()) / (1000 * 60 * 60)

  // Load temporal context (previous and subsequent batches)
  const batchDate = earliest.toISOString().split('T')[0]
  
  // Previous batches (last 30 days)
  const { data: previousEvents } = await supabase
    .from('timeline_events')
    .select('id, event_date, title, description, metadata')
    .eq('vehicle_id', vehicleId)
    .eq('user_id', userId)
    .lt('event_date', batchDate)
    .gte('event_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('event_date', { ascending: false })
    .limit(10)

  // Subsequent batches (next 30 days)
  const { data: subsequentEvents } = await supabase
    .from('timeline_events')
    .select('id, event_date, title, description, metadata')
    .eq('vehicle_id', vehicleId)
    .eq('user_id', userId)
    .gt('event_date', batchDate)
    .lte('event_date', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('event_date', { ascending: true })
    .limit(10)

  const lastBatch = previousEvents?.[0]
  const nextBatch = subsequentEvents?.[0]
  const timeSinceLastBatch = lastBatch 
    ? (earliest.getTime() - new Date(lastBatch.event_date).getTime()) / (1000 * 60 * 60)
    : Infinity
  const timeUntilNextBatch = nextBatch
    ? (new Date(nextBatch.event_date).getTime() - latest.getTime()) / (1000 * 60 * 60)
    : Infinity

  // Load vehicle history
  const { data: timelineEvents } = await supabase
    .from('timeline_events')
    .select('event_date, event_type, title, description')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false })
    .limit(50)

  // Load user patterns
  const { data: userContributions } = await supabase
    .from('timeline_events')
    .select('event_date, title, description, metadata')
    .eq('vehicle_id', vehicleId)
    .eq('user_id', userId)
    .order('event_date', { ascending: false })
    .limit(100)

  const userBatchSizes = userContributions?.map(e => e.metadata?.image_count || 0) || []
  const averageBatchSize = userBatchSizes.length > 0
    ? userBatchSizes.reduce((a, b) => a + b, 0) / userBatchSizes.length
    : 0

  // Calculate average time between batches
  let totalTimeBetween = 0
  let batchCount = 0
  if (userContributions && userContributions.length > 1) {
    for (let i = 0; i < userContributions.length - 1; i++) {
      const current = new Date(userContributions[i].event_date)
      const previous = new Date(userContributions[i + 1].event_date)
      totalTimeBetween += (current.getTime() - previous.getTime()) / (1000 * 60 * 60)
      batchCount++
    }
  }
  const averageTimeBetween = batchCount > 0 ? totalTimeBetween / batchCount : Infinity

  // Determine commitment level
  let commitmentLevel: 'casual' | 'regular' | 'dedicated' | 'expert' = 'casual'
  if (userContributions && userContributions.length >= 20 && averageTimeBetween < 168) {
    commitmentLevel = 'expert'
  } else if (userContributions && userContributions.length >= 10 && averageTimeBetween < 336) {
    commitmentLevel = 'dedicated'
  } else if (userContributions && userContributions.length >= 5) {
    commitmentLevel = 'regular'
  }

  return {
    vehicle: {
      id: vehicle.id,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      vin: vehicle.vin,
      mileage: vehicle.mileage
    },
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name
    },
    imageBatch: {
      image_ids: imageIds,
      image_urls: images.map(img => img.image_url),
      taken_dates: takenDates,
      count: images.length,
      time_span_hours: timeSpanHours,
      date_range: {
        earliest: earliest.toISOString(),
        latest: latest.toISOString()
      }
    },
    temporalContext: {
      previousBatches: previousEvents?.map(e => ({
        date: e.event_date,
        image_count: e.metadata?.image_count || 0,
        work_type: e.title,
        time_investment_hours: e.metadata?.session_duration_hours || 0
      })) || [],
      subsequentBatches: subsequentEvents?.map(e => ({
        date: e.event_date,
        image_count: e.metadata?.image_count || 0,
        work_type: e.title
      })) || [],
      timeSinceLastBatch,
      timeUntilNextBatch
    },
    vehicleHistory: {
      total_timeline_events: timelineEvents?.length || 0,
      recent_work: timelineEvents?.slice(0, 10).map(e => ({
        date: e.event_date,
        type: e.event_type,
        description: e.description || e.title
      })) || [],
      known_issues: [],
      modifications: timelineEvents?.filter(e => e.event_type === 'modification').map(e => e.description || e.title) || []
    },
    userPatterns: {
      total_contributions: userContributions?.length || 0,
      average_batch_size: averageBatchSize,
      average_time_between_batches: averageTimeBetween,
      typical_work_types: [],
      commitment_level: commitmentLevel
    }
  }
}

async function analyzeSituationalContext(
  context: BatchContext,
  input?: { originatorContext?: string; contextQuestions?: string[] }
): Promise<SituationalAnalysis> {
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }
  const anthropicModel = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-3-5-haiku-20241022'
  const originatorContext = input?.originatorContext ? input.originatorContext.trim() : ''
  const promptQuestions = input?.contextQuestions || []

  // Build system prompt following Claude best practices
  const systemPrompt = `You are an expert automotive analyst and appraiser with deep understanding of vehicle restoration, maintenance, market values, and labor rates. Your role is to understand the COMPLETE SITUATION surrounding a batch of vehicle images and CALCULATE THE VALUE of the work performed.

CRITICAL ANALYSIS REQUIREMENTS:
1. THE 5 W's - Structure your analysis journalistically:
   - WHO: Who did the work? What skill level? What was their role?
   - WHAT: What work was performed? What components? What tools/parts?
   - WHEN: When did this happen? How long? Continuation or standalone?
   - WHERE: Where was work done? Shop quality? Environment indicators?
   - WHY: Why was this work done? Problem solving? Preventive? Goal?

2. GO BEYOND HARD FACTS:
   - If the images are a listing screenshot or discovery, identify platform cues, price, mileage, location, seller, and any notable claims.
   - Infer intent (discovery, verification, decision-making) and look for signals that matter to a buyer or historian.
   - Do not repeat obvious facts as questions.

3. ORIGINATOR FOLLOW-UPS:
   - Produce 3-6 open-ended questions that help the originator explain context, motivations, and decision points.
   - Avoid asking for facts already visible in the image or provided in originator notes.
   - Focus on unique insight (why it mattered, what changed, what was learned, what was decided next).

2. VALUE CALCULATION - Assign real dollar value to this event:
   - Labor Value: Hours × Market Rate for skill level shown
     * Professional shop: $100-150/hr
     * Skilled enthusiast: $50-75/hr  
     * DIY learner: $25-40/hr
   - Documentation Value: Quality photos add resale value
   - Vehicle Impact: Does this increase/maintain/prevent value loss?
   - Market Comparison: What would shop charge for this work?
   - Total Event Value: Real dollar worth of this session

3. Deep Knowledge Application:
   - Know typical labor times for specific jobs
   - Understand part costs and quality tiers
   - Recognize professional vs amateur workmanship
   - Assess impact on vehicle market value
   - Compare to industry-standard labor rates

VEHICLE CONTEXT:
- ${context.vehicle.year} ${context.vehicle.make} ${context.vehicle.model}${context.vehicle.trim ? ` ${context.vehicle.trim}` : ''}
- ${context.vehicleHistory.total_timeline_events} total timeline events
- Recent work: ${context.vehicleHistory.recent_work.slice(0, 3).map(w => `${w.type}: ${w.description}`).join('; ') || 'None'}

USER PATTERNS:
- ${context.userPatterns.total_contributions} total contributions
- Average batch size: ${context.userPatterns.average_batch_size.toFixed(1)} images
- Average time between batches: ${context.userPatterns.average_time_between_batches < 24 ? `${context.userPatterns.average_time_between_batches.toFixed(1)} hours` : `${(context.userPatterns.average_time_between_batches / 24).toFixed(1)} days`}
- Commitment level: ${context.userPatterns.commitment_level}

TEMPORAL CONTEXT:
- Time since last batch: ${context.temporalContext.timeSinceLastBatch < 24 ? `${context.temporalContext.timeSinceLastBatch.toFixed(1)} hours` : `${(context.temporalContext.timeSinceLastBatch / 24).toFixed(1)} days`}
- Previous batches: ${context.temporalContext.previousBatches.length}
- Subsequent batches: ${context.temporalContext.subsequentBatches.length}

CURRENT BATCH:
- ${context.imageBatch.count} images
- Time span: ${context.imageBatch.time_span_hours.toFixed(1)} hours
- Date range: ${new Date(context.imageBatch.date_range.earliest).toLocaleDateString()} to ${new Date(context.imageBatch.date_range.latest).toLocaleDateString()}

ORIGINATOR CONTEXT (use as authoritative if provided):
${originatorContext || 'None provided.'}
${promptQuestions.length > 0 ? `\nORIGINATOR PROMPT QUESTIONS (asked to the user):\n- ${promptQuestions.join('\n- ')}` : ''}

MARKET CONTEXT (for valuation):
- Professional shop labor typically: $100-150/hr
- Skilled DIY equivalent value: $50-75/hr
- Well-documented work adds 5-10% to resale value
- Preventive maintenance preserves value
- Quality restoration increases value

Analyze these images and provide:
1. Complete 5 W's breakdown
2. Detailed value calculation with real dollar amounts
3. Market-rate comparison
4. Impact on vehicle value`

  // Build user message with images
  const userMessage = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Analyze this batch of ${context.imageBatch.count} images using the 5 W's framework and calculate the VALUE:

THE 5 W's:
1. WHO: Who did this work? What skill level do they demonstrate? Are they the primary worker or documenting?
2. WHAT: What specific work was performed? What components? What tools/parts are visible?
3. WHEN: When did this happen? How long did it take? Does it continue previous work or prepare for future work?
4. WHERE: Where was this done? Professional shop? Home garage? What does environment tell us?
5. WHY: Why was this work necessary? Fixing a problem? Preventive? Improvement? How critical was it?

VALUE CALCULATION (use real dollar amounts):
- Labor Value: Estimate hours × appropriate market rate for skill level shown
- Documentation Value: How much does this photo documentation add to vehicle value?
- Vehicle Impact: Does this work increase value? Maintain it? Prevent loss? By how much?
- Market Comparison: What would a shop charge for this exact work?
- Total Event Value: What is this work session worth in real dollars?

ORIGINATOR NOTES:
${originatorContext || 'None provided.'}

FOLLOW-UP QUESTIONS:
- Provide 3-6 open-ended questions to ask the originator.
- Do NOT ask for facts already visible in the images or notes.

CRITICAL: You MUST respond with VALID JSON matching this EXACT structure:

{
  "who": {
    "primary_actor": "string",
    "skill_level": "professional" | "skilled_enthusiast" | "diy_learner" | "helper",
    "involvement_type": "hands_on_work" | "supervision" | "documentation" | "assistance"
  },
  "what": {
    "work_performed": "string - detailed description",
    "work_category": "maintenance" | "repair" | "restoration" | "modification" | "inspection" | "documentation",
    "components_affected": ["array", "of", "strings"],
    "tools_equipment_used": ["array"],
    "parts_materials": ["array"]
  },
  "when": {
    "session_date": "YYYY-MM-DD",
    "estimated_duration_hours": number,
    "time_of_day_indicator": "morning" | "afternoon" | "evening" | "night" | "unknown",
    "is_continuation": boolean,
    "continuation_of": "string or null",
    "is_preparation": boolean,
    "preparation_for": "string or null"
  },
  "where": {
    "work_location": "professional_shop" | "home_garage" | "driveway" | "mobile" | "unknown",
    "location_indicators": ["array"],
    "environment_quality": "professional" | "well_equipped" | "basic" | "minimal"
  },
  "why": {
    "primary_motivation": "string",
    "problem_being_solved": "string or null",
    "goal_being_achieved": "string",
    "preventive_vs_reactive": "preventive" | "reactive" | "improvement" | "emergency",
    "necessity_level": "critical" | "important" | "beneficial" | "optional"
  },
  "value_assessment": {
    "labor_value": {
      "estimated_hours": number,
      "skill_rate_per_hour": number,
      "total_labor_value": number
    },
    "documentation_value": {
      "photo_quality": "excellent" | "good" | "adequate" | "poor",
      "documentation_completeness": number,
      "estimated_value": number
    },
    "vehicle_impact": {
      "impact_type": "increases_value" | "maintains_value" | "prevents_loss" | "neutral",
      "estimated_impact_amount": number,
      "explanation": "string"
    },
    "market_comparison": {
      "shop_cost_equivalent": number,
      "savings_realized": number,
      "parts_cost_estimate": number
    },
    "total_event_value": number,
    "value_confidence": number
  },
  "narrative_summary": "One paragraph story",
  "relationship_to_vehicle_history": "string",
  "patterns_detected": ["array"],
  "originator_questions": ["array", "of", "strings"],
  "confidence_score": number (0-100),
  "reasoning": "string"
}

Return ONLY the JSON object. No markdown, no explanations, just pure JSON.`
      },
      ...context.imageBatch.image_urls.slice(0, 20).map(url => ({
        type: 'image' as const,
        source: {
          type: 'url' as const,
          url
        }
      }))
    ]
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [userMessage]
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  
  if (!data.content || data.content.length === 0) {
    throw new Error('No content in Claude response')
  }

  const content = data.content[0].text

  // Parse JSON from response (Claude may wrap in markdown code blocks)
  let jsonText = content
  const jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/) || content.match(/(\{[\s\S]*\})/)
  if (jsonMatch) {
    jsonText = jsonMatch[1] || jsonMatch[0]
  }

  try {
    return JSON.parse(jsonText) as SituationalAnalysis
  } catch (parseError) {
    console.error('Failed to parse JSON:', jsonText.substring(0, 500))
    throw new Error(`Failed to parse JSON from Claude response: ${parseError.message}`)
  }
}

function calculateUserCommitmentScore(
  context: BatchContext,
  analysis: SituationalAnalysis
): UserCommitmentScore {
  // Time investment score (0-30 points) - from the new 5 W's structure
  const estimatedHours = analysis.when?.estimated_duration_hours || analysis.value_assessment?.labor_value?.estimated_hours || 0
  const timeInvestmentScore = Math.min(30, estimatedHours * 2)

  // Consistency score (0-25 points)
  const consistencyScore = context.userPatterns.total_contributions >= 20 ? 25
    : context.userPatterns.total_contributions >= 10 ? 20
    : context.userPatterns.total_contributions >= 5 ? 15
    : context.userPatterns.total_contributions >= 2 ? 10
    : 5

  // Quality score (0-25 points) - based on skill level from WHO section
  const skillLevel = analysis.who?.skill_level || 'diy_learner'
  const qualityScore = skillLevel === 'professional' ? 25
    : skillLevel === 'skilled_enthusiast' ? 20
    : skillLevel === 'diy_learner' ? 10
    : 5

  // Engagement score (0-20 points) - based on batch frequency
  const engagementScore = context.userPatterns.average_time_between_batches < 24 ? 20
    : context.userPatterns.average_time_between_batches < 168 ? 15
    : context.userPatterns.average_time_between_batches < 720 ? 10
    : 5

  const overallCommitment = timeInvestmentScore + consistencyScore + qualityScore + engagementScore

  let level: 'casual' | 'regular' | 'dedicated' | 'expert' = 'casual'
  if (overallCommitment >= 75) level = 'expert'
  else if (overallCommitment >= 60) level = 'dedicated'
  else if (overallCommitment >= 40) level = 'regular'

  const factors: string[] = []
  if (timeInvestmentScore > 20) factors.push('High time investment')
  if (consistencyScore > 15) factors.push('Consistent contributions')
  if (qualityScore > 15) factors.push('Quality work indicators')
  if (engagementScore > 15) factors.push('Frequent engagement')

  return {
    time_investment_score: timeInvestmentScore,
    consistency_score: consistencyScore,
    quality_score: qualityScore,
    engagement_score: engagementScore,
    overall_commitment: overallCommitment,
    level,
    factors
  }
}

async function saveContextualAnalysis(
  supabase: any,
  eventId: string,
  context: BatchContext,
  analysis: SituationalAnalysis,
  commitmentScore: UserCommitmentScore,
  originatorContext?: string,
  contextQuestions: string[] = []
) {
  const originatorPayload = originatorContext
    ? {
        originator_context: originatorContext,
        originator_prompt_questions: contextQuestions,
        originator_context_added_at: new Date().toISOString()
      }
    : {}

  let existingMetadata: Record<string, any> = {}
  try {
    const { data: existingRow } = await supabase
      .from('timeline_events')
      .select('metadata')
      .eq('id', eventId)
      .maybeSingle()
    if (existingRow?.metadata && typeof existingRow.metadata === 'object') {
      existingMetadata = existingRow.metadata
    }
  } catch {
    // fallback to empty metadata
  }

  // Save the complete 5 W's analysis to timeline event metadata
  const { error } = await supabase
    .from('timeline_events')
    .update({
      metadata: {
        ...existingMetadata,
        contextual_analysis: {
          // The 5 W's
          who: analysis.who,
          what: analysis.what,
          when: analysis.when,
          where: analysis.where,
          why: analysis.why,
          // Value Assessment
          value_assessment: analysis.value_assessment,
          // Narrative and Context
          narrative_summary: analysis.narrative_summary,
          relationship_to_vehicle_history: analysis.relationship_to_vehicle_history,
          patterns_detected: analysis.patterns_detected,
          originator_questions: Array.isArray(analysis.originator_questions) ? analysis.originator_questions.slice(0, 6) : [],
          // Metadata
          confidence_score: analysis.confidence_score,
          reasoning: analysis.reasoning,
          ...originatorPayload,
          analyzed_at: new Date().toISOString()
        },
        user_commitment_score: {
          time_investment_score: commitmentScore.time_investment_score,
          consistency_score: commitmentScore.consistency_score,
          quality_score: commitmentScore.quality_score,
          engagement_score: commitmentScore.engagement_score,
          overall_commitment: commitmentScore.overall_commitment,
          level: commitmentScore.level,
          factors: commitmentScore.factors,
          calculated_at: new Date().toISOString()
        }
      },
      contextual_analysis_status: 'completed'
    })
    .eq('id', eventId)

  if (error) {
    console.error('Error saving contextual analysis:', error)
    throw error
  }
}

async function updateTimelineEvent(
  supabase: any,
  eventId: string,
  analysis: SituationalAnalysis,
  commitmentScore: UserCommitmentScore
) {
  // Update event title and description with contextual understanding from 5 W's
  const components = analysis.what?.components_affected?.join(', ') || 'Unknown components'
  const workPerformed = analysis.what?.work_performed || analysis.narrative_summary
  const estimatedHours = analysis.when?.estimated_duration_hours || analysis.value_assessment?.labor_value?.estimated_hours || 0
  
  const { error } = await supabase
    .from('timeline_events')
    .update({
      title: workPerformed?.substring(0, 100) || 'Work session',
      description: `${analysis.narrative_summary}\n\nWork category: ${analysis.what?.work_category}\nComponents: ${components}\nEstimated time: ${estimatedHours} hours\nTotal value: $${analysis.value_assessment?.total_event_value || 0}\nUser commitment level: ${commitmentScore.level} (${commitmentScore.overall_commitment}/100)`
    })
    .eq('id', eventId)

  if (error) {
    console.error('Error updating timeline event:', error)
  }
}

