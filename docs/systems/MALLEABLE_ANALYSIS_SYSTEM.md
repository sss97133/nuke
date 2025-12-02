# Malleable Analysis System - User Control & Transparency

## Overview

The analysis system is now **fully malleable** - users can select:
- **LLM Provider**: OpenAI, Anthropic, or Google Gemini
- **Model**: Specific model within each provider
- **Analysis Tier**: tier1 (fast/free) → tier2 → tier3 → expert (comprehensive)

Plus **full transparency** - every step is logged with timing and token usage.

## Features

### 1. **Unified LLM Provider System** (`_shared/llmProvider.ts`)
- Supports OpenAI, Anthropic, and Google Gemini
- Automatic fallback (free → paid)
- User API key support
- Model selection with cost/speed/quality info

### 2. **Analysis Tiers**
- **tier1**: Google Gemini Flash (FREE, fast, basic)
- **tier2**: OpenAI GPT-4o-mini (low cost, good quality)
- **tier3**: OpenAI GPT-4o (balanced cost/quality)
- **expert**: Anthropic Claude Sonnet (highest quality, comprehensive)

### 3. **Transparency Logging**
Every analysis step logs:
- Which LLM provider/model is used
- Duration in milliseconds
- Token usage
- Step-by-step progress

Example logs:
```
🤖 Vehicle Expert Agent starting analysis for: vehicle-id
📊 Analysis config: tier=expert, provider=anthropic, model=claude-3-5-sonnet-20241022
✅ Using LLM: anthropic/claude-3-5-sonnet-20241022 (user key)
📚 STEP 1: Researching vehicle context...
  🔍 Researching vehicle literature using anthropic/claude-3-5-sonnet-20241022...
  ✅ Literature research complete (1234ms)
✅ Research complete: 1974 Ford Bronco
💰 STEP 2: Assessing images and tallying value...
  🔍 Analyzing 30 images using anthropic/claude-3-5-sonnet-20241022...
  ✅ Image analysis complete (5678ms, 4500 tokens)
✅ Value assessment complete: 12 components identified
🌍 STEP 3: Extracting environmental context...
  🔍 Extracting environmental context using anthropic/claude-3-5-sonnet-20241022...
  ✅ Environmental extraction complete (2345ms)
📊 STEP 4: Generating expert valuation...
✅ Analysis complete: $45,000 (confidence: 85%)
```

### 4. **User Configuration UI**
- **AnalysisConfigSelector** component
- Tier selection buttons
- Advanced options (provider/model selection)
- Real-time config preview

### 5. **Queue System Integration**
- Config stored in `analysis_queue` table
- Passed to edge functions
- Preserved through retries
- Visible in queue status

## Usage

### Frontend (User)
1. Click "Configure Analysis" button
2. Select tier (or advanced options)
3. Click "Queue Analysis"
4. Watch logs in console for transparency

### Backend (Queue)
```typescript
// Queue with user preferences
await supabase.rpc('queue_analysis', {
  p_vehicle_id: vehicleId,
  p_analysis_type: 'expert_valuation',
  p_priority: 2,
  p_triggered_by: 'user',
  p_llm_provider: 'anthropic',
  p_llm_model: 'claude-3-5-sonnet-20241022',
  p_analysis_tier: 'expert',
  p_analysis_config: { /* full config */ }
});
```

### Edge Function
```typescript
// Receives config and uses it
const { vehicleId, llmProvider, llmModel, analysisTier } = await req.json();
const llmConfig = await getLLMConfig(supabase, userId, llmProvider, llmModel, analysisTier);
// Uses llmConfig throughout analysis
```

## Benefits

1. **User Control**: Choose speed vs quality vs cost
2. **Transparency**: See exactly what's happening
3. **Flexibility**: Use your own API keys
4. **Cost Management**: Free tier available (Google Gemini)
5. **Quality Options**: From basic to expert-level analysis

## Next Steps

1. ✅ Unified LLM provider system
2. ✅ Tier selection
3. ✅ Transparency logging
4. ✅ Frontend config selector
5. ✅ Queue integration
6. ⏳ Deploy and test
7. ⏳ Add cost estimation display
8. ⏳ Add analysis history with configs

