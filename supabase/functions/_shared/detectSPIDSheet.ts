/**
 * BULLETPROOF SPID Sheet Detection Utility
 * Detects GM SPID (Service Parts Identification) sheets with cascading API fallback
 * 
 * Priority order:
 * 1. OpenAI GPT-4o (user key → system key)
 * 2. Anthropic Claude Sonnet (user key → system key)
 * 3. Google Gemini Pro (user key → system key)
 */

type SPIDResult = {
  is_spid_sheet: boolean;
  confidence: number;
  extracted_data: {
    vin: string | null;
    model_code: string | null;
    build_date: string | null;
    sequence_number: string | null;
    paint_code_exterior: string | null;
    paint_code_interior: string | null;
    rpo_codes: string[];
    engine_code: string | null;
    transmission_code: string | null;
    axle_ratio: string | null;
  };
  raw_text: string;
  provider?: string;
  // Cost/usage (best-effort). Only populated when provider supports it (OpenAI).
  _usage?: any;
  _cost_usd?: number | null;
  _model?: string | null;
} | null;

const SPID_PROMPT = `You are a GM SPID (Service Parts Identification) sheet expert. Analyze images to detect and extract data from SPID sheets.

SPID sheets are labels found on GM vehicles (usually on the glove box or center console) that contain:
- VIN (17-character alphanumeric) - Usually top line
- MODEL CODE (e.g., CCE2436, CKE1418) - Contains series, year, cab config
- Build date and sequence number
- Paint codes (exterior and interior trim codes)
- RPO codes (3-character option codes like G80, KC4, Z84, LS4, M40, etc.)
- Engine code (e.g., L31, LT1, LS4) - Usually in RPO list
- Transmission code (e.g., M40, M38, M20) - Usually in RPO list
- Rear axle ratio (e.g., 3.73, 4.10)

CRITICAL: Extract the MODEL CODE line (often shows "MODEL:" or "MDL:"). This contains encoded information:
- Example: CCE2436 = C/K series, 1984, C20, Crew Cab

Return ONLY valid JSON:
{
  "is_spid_sheet": boolean,
  "confidence": number (0-100),
  "extracted_data": {
    "vin": string | null,
    "model_code": string | null,
    "build_date": string | null,
    "sequence_number": string | null,
    "paint_code_exterior": string | null,
    "paint_code_interior": string | null,
    "rpo_codes": string[],
    "engine_code": string | null,
    "transmission_code": string | null,
    "axle_ratio": string | null
  },
  "raw_text": string
}

Extract ALL RPO codes you see, including engine (LS4, L31) and transmission (M40, M38) codes.`;

export async function detectSPIDSheet(
  imageUrl: string,
  vehicleId?: string,
  supabaseClient?: any,
  userId?: string
): Promise<SPIDResult> {
  
  const { getUserApiKey } = await import('./getUserApiKey.ts');
  
  // BULLETPROOF: Try multiple providers in order
  const providers = [
    {
      name: 'openai',
      model: 'gpt-4o',
      envVar: 'OPENAI_API_KEY',
      fn: extractWithOpenAI
    },
    {
      name: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      envVar: 'ANTHROPIC_API_KEY',
      fn: extractWithAnthropic
    },
    {
      name: 'google',
      model: 'gemini-1.5-pro',
      envVar: 'GOOGLE_AI_API_KEY',
      fn: extractWithGoogleGemini
    }
  ];

  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      console.log(`🔍 [SPID] Trying ${provider.name}...`);
      
      // Get API key (user key → system key)
      const apiKeyResult = await getUserApiKey(
        supabaseClient,
        userId || null,
        provider.name as any,
        provider.envVar
      );

      if (!apiKeyResult.apiKey) {
        console.log(`⏭️  [SPID] ${provider.name} - no API key available`);
        continue;
      }

      // Call provider with timeout
      const result = await Promise.race([
        provider.fn(imageUrl, apiKeyResult.apiKey, provider.model),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Provider timeout (15s)')), 15000)
        )
      ]);

      console.log(`✅ [SPID] ${provider.name} succeeded - confidence: ${result.confidence}%`);
      
      return {
        ...result,
        provider: provider.name
      };

    } catch (error: any) {
      console.warn(`❌ [SPID] ${provider.name} failed:`, error.message);
      lastError = error;
      continue; // Try next provider
    }
  }

  // All providers failed
  console.error('❌ [SPID] ALL PROVIDERS FAILED:', lastError?.message);
  return null;
}

// ============================================================================
// PROVIDER-SPECIFIC EXTRACTION FUNCTIONS
// ============================================================================

async function extractWithOpenAI(
  imageUrl: string,
  apiKey: string,
  model: string
): Promise<Omit<SPIDResult, 'provider'>> {
  const { callOpenAiChatCompletions } = await import('./openaiChat.ts');
  const res = await callOpenAiChatCompletions({
    apiKey,
    body: {
      model,
      messages: [
        { role: 'system', content: SPID_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image. Is it a GM SPID sheet? If yes, extract all visible data.' },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
          ]
        }
      ],
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    },
    timeoutMs: 20000,
  });

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status} - ${JSON.stringify(res.raw?.error || res.raw)?.slice(0, 300)}`);
  }

  const parsed = (() => {
    try {
      return JSON.parse(res.content_text || '{}');
    } catch {
      return null;
    }
  })();
  if (!parsed) {
    throw new Error('OpenAI returned invalid JSON for SPID');
  }

  return {
    ...parsed,
    _usage: res.usage || null,
    _cost_usd: res.cost_usd ?? null,
    _model: res.model || model || null,
  };
}

async function extractWithAnthropic(
  imageUrl: string,
  apiKey: string,
  model: string
): Promise<Omit<SPIDResult, 'provider'>> {
  // Fetch image and convert to base64
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error('Failed to fetch image for Anthropic');
  
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
  const mediaType = imageResponse.headers.get('content-type') || 'image/jpeg';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Image }
            },
            { type: 'text', text: SPID_PROMPT + '\n\nAnalyze this image. Is it a GM SPID sheet? If yes, extract all visible data.' }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  
  if (!content) {
    throw new Error('No content in Anthropic response');
  }

  // Extract JSON (Claude may wrap in markdown)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : content);
}

async function extractWithGoogleGemini(
  imageUrl: string,
  apiKey: string,
  model: string
): Promise<Omit<SPIDResult, 'provider'>> {
  // Fetch image and convert to base64
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error('Failed to fetch image for Gemini');
  
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: SPID_PROMPT + '\n\nAnalyze this image. Is it a GM SPID sheet? If yes, extract all visible data.' },
            { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!content) {
    throw new Error('No content in Gemini response');
  }

  return JSON.parse(content);
}

