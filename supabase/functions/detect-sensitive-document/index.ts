import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { requireOwnerOrService, requireWriteAuth } from '../_shared/writeGuard.ts';
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DocumentAnalysisRequest {
  image_url: string;
  vehicle_id: string;
  image_id: string;
}

interface DocumentDetectionResult {
  is_sensitive: boolean;
  document_type: 'title' | 'registration' | 'bill_of_sale' | 'insurance' | 'inspection' | 'spid' | 'other' | null;
  confidence: number;
  extracted_data: any;
  raw_text: string;
  provider: string; // Track which AI provider succeeded
}

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  // Works on deals, documents, receipts or profiles by id (several run paid AI): the owner or the
  // service key only, because "signed in" is anyone while sign-up is open (2026-09-29).
  const notOwner = await requireOwnerOrService(req);
  if (notOwner) return notOwner;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      // Support both env var names (older deploys used SERVICE_ROLE_KEY)
      projectSecretKey() ?? '',
      {
        auth: {
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );

    const { image_url, vehicle_id, image_id }: DocumentAnalysisRequest = await req.json();
    
    console.log(`🔒 Analyzing image for sensitive content: ${image_id}`);

    // Call OpenAI Vision to detect document type and extract data
    const analysisResult = await analyzeDocument(image_url);

    // If sensitive, mark image and extract data
    if (analysisResult.is_sensitive) {
      console.log(`🚨 SENSITIVE DOCUMENT DETECTED: ${analysisResult.document_type}`);
      
      // Mark image as sensitive AND as a document.
      // This prevents sensitive uploads (title/registration/etc) from appearing in the public image gallery.
      // Ownership verification uploads should happen via the Ownership flow, but if a user uploads a title into
      // the gallery, we still need to route it out of the gallery for safety + correctness.
      await supabase
        .from('vehicle_images')
        .update({
          is_sensitive: true,
          sensitive_type: analysisResult.document_type,
          is_document: true,
          document_category: analysisResult.document_type && analysisResult.document_type !== 'other'
            ? analysisResult.document_type
            : 'other_document'
        })
        .eq('id', image_id);

      // If this is likely a title document, best-effort attach it to an ownership verification record
      // so it participates in the claim workflow (instead of staying as a random gallery upload).
      //
      // We only do this at high confidence to avoid accidental claims from false positives.
      if (analysisResult.document_type === 'title' && (analysisResult.confidence || 0) >= 0.85) {
        try {
          const { data: imgRow } = await supabase
            .from('vehicle_images')
            .select('user_id')
            .eq('id', image_id)
            .maybeSingle();

          const uploaderId = (imgRow as any)?.user_id || null;
          if (uploaderId) {
            const { data: existing } = await supabase
              .from('ownership_verifications')
              .select('id, status, title_document_url, drivers_license_url')
              .eq('vehicle_id', vehicle_id)
              .eq('user_id', uploaderId)
              .maybeSingle();

            const patch: any = {
              vehicle_id,
              user_id: uploaderId,
              verification_type: 'title',
              title_document_url: image_url,
              // If no DL on file, mark as pending so the user can complete the flow.
              drivers_license_url: (existing as any)?.drivers_license_url || 'pending',
              status: (existing as any)?.status && ['approved', 'rejected'].includes((existing as any).status)
                ? (existing as any).status
                : 'pending',
              updated_at: new Date().toISOString()
            };

            if (existing?.id) {
              await supabase
                .from('ownership_verifications')
                .update(patch)
                .eq('id', existing.id);
            } else {
              await supabase
                .from('ownership_verifications')
                .insert({
                  ...patch,
                  // Required fields in some schemas; provide safe placeholders if missing.
                  drivers_license_url: 'pending',
                  submitted_at: new Date().toISOString()
                } as any);
            }
          }
        } catch (e) {
          // Non-fatal; doc is still protected (marked sensitive) even if this attach fails.
          console.warn('Failed to attach title to ownership_verifications (non-fatal):', (e as any)?.message || e);
        }
      }

      // Store extracted document data
      // TODO(ghost-ref 2026-07-12): vehicle_title_documents does not exist (half-built) — guarded; see docs/ledger/FINISH_ROADMAP.md
      // The structured OCR fields (title_number, previous_owner_name, lienholder_name, odometer_*, brand, etc.)
      // have no home table yet. deal_documents is not a fit (requires deal_id, drops these columns, and this
      // path fires for any non-'other' doc type, not just titles). Skip the write so detection still succeeds;
      // the image is already marked sensitive and attached to ownership_verifications above.
      if (analysisResult.document_type && analysisResult.document_type !== 'other') {
        console.log(`✅ Extracted data from ${analysisResult.document_type} (persistence skipped — vehicle_title_documents not yet built)`);
      }
    } else {
      console.log(`✅ Image is not sensitive`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        is_sensitive: analysisResult.is_sensitive,
        document_type: analysisResult.document_type,
        extracted_fields: Object.keys(analysisResult.extracted_data || {})
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error analyzing document:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

/**
 * Analyze document with multi-provider failover
 */
async function analyzeDocument(imageUrl: string): Promise<DocumentDetectionResult> {
  // Try providers in order: OpenAI → Anthropic → timeout fallback
  const providers = [
    { name: 'openai', fn: analyzeWithOpenAI },
    { name: 'anthropic', fn: analyzeWithAnthropic }
  ];

  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      console.log(`🔄 Trying ${provider.name}...`);
      
      // 45 second timeout per provider: a Sonnet 5.5 read of one image with up to 1,500 output tokens does not
      // finish in 10 (measured 13 to 26 s for 2,000 to 3,800 output tokens on text, 2026-11-20).
      const result = await Promise.race([
        provider.fn(imageUrl),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Provider timeout')), 45000)
        )
      ]);

      console.log(`✅ ${provider.name} succeeded`);
      return { ...result, provider: provider.name };

    } catch (error) {
      console.warn(`❌ ${provider.name} failed:`, error instanceof Error ? error.message : String(error));
      lastError = error instanceof Error ? error : new Error(String(error));
      continue; // Try next provider
    }
  }

  // No provider answered. "Not sensitive" is a reading, and nothing was read: fail, so the caller sees an error
  // and the image keeps whatever mark it had, instead of being reported clean.
  console.error('❌ All providers failed; no verdict');
  throw new Error(`no provider read the image: ${lastError?.message ?? 'unknown'}`);
}

/**
 * OpenAI Vision Analysis
 */
async function analyzeWithOpenAI(imageUrl: string): Promise<Omit<DocumentDetectionResult, 'provider'>> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const prompt = `Analyze this image and determine if it contains sensitive vehicle documents.

DETECT:
1. Vehicle Title (Certificate of Title)
2. Vehicle Registration
3. Bill of Sale
4. Insurance Card
5. Inspection Certificate
6. SPID Sheet (Structural Part Identification Document) - IMPORTANT!

**SPID SHEETS ARE GOLD** - These contain critical part numbers, installation dates, technician info!

If this IS a sensitive document, extract ALL visible data:
- Title Number
- VIN (Vehicle Identification Number)
- State/DMV
- Issue Date
- Owner Name
- Previous Owner Name (if visible)
- Lienholder Name (if visible)
- Odometer Reading
- Odometer Date
- Brand (Clean, Salvage, Rebuilt, etc.)
- For SPID: Part numbers, install dates, shop info
- Any other visible structured data

Return JSON:
{
  "is_sensitive": boolean,
  "document_type": "title" | "registration" | "bill_of_sale" | "insurance" | "inspection" | "spid" | null,
  "confidence": 0.0-1.0,
  "extracted_data": {
    "title_number": string,
    "vin": string,
    "state": string,
    "issue_date": "YYYY-MM-DD",
    "owner_name": string,
    "previous_owner_name": string,
    "lienholder_name": string,
    "odometer_reading": number,
    "odometer_date": "YYYY-MM-DD",
    "brand": string,
    "other_fields": {}
  },
  "raw_text": "full OCR text"
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 1500,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  
  if (!content) {
    return {
      is_sensitive: false,
      document_type: null,
      confidence: 0,
      extracted_data: {},
      raw_text: ''
    };
  }

  let result;
  try {
    result = JSON.parse(content);
  } catch {
    return { is_sensitive: false, document_type: null, confidence: 0, extracted_data: {}, raw_text: '' };
  }

  return {
    is_sensitive: result.is_sensitive || false,
    document_type: result.document_type || null,
    confidence: result.confidence || 0,
    extracted_data: result.extracted_data || {},
    raw_text: result.raw_text || ''
  };
}

/**
 * Anthropic Claude Vision Analysis (Fallback)
 */
async function analyzeWithAnthropic(imageUrl: string): Promise<Omit<DocumentDetectionResult, 'provider'>> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  // The image goes by address, not as base64: spreading a multi-megabyte photo into String.fromCharCode overflowed
  // the stack, so that route failed on any full-size photo before the model was asked. A photo in public storage
  // is asked for as a 1,600 px render (the address heic_render_url() builds): the model cannot read a HEIC
  // original (400 "file format is invalid or unsupported", measured 2026-11-20) and reads the render in 3 to 8 s.
  const modelUrl = imageUrl.includes('/storage/v1/object/public/') && !imageUrl.includes('?')
    ? imageUrl.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
      '?width=1600&height=1600&resize=contain&quality=80'
    : imageUrl;

  const prompt = `Analyze this image for sensitive vehicle documents.

DETECT: Title, Registration, Bill of Sale, Insurance, Inspection, SPID Sheet

Extract ALL visible data including VIN, names, dates, part numbers.

Return ONLY valid JSON:
{
  "is_sensitive": boolean,
  "document_type": "title" | "registration" | "bill_of_sale" | "insurance" | "inspection" | "spid" | null,
  "confidence": 0.0-1.0,
  "extracted_data": {...},
  "raw_text": "..."
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 1500,
      thinking: { type: 'between_tools' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: modelUrl }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  // The reply can open with a thinking block, so take the text blocks by type. No text or no JSON is a failed
  // read, not a "not sensitive" verdict: throw, so the next provider is tried or the call fails.
  const content = (Array.isArray(data.content) ? data.content : [])
    .filter((b: any) => b?.type === 'text').map((b: any) => b.text ?? '').join('');
  if (!content.trim()) {
    throw new Error(`Anthropic returned no text (stop_reason ${data.stop_reason ?? 'unknown'})`);
  }

  // Extract JSON from response (Claude sometimes wraps in markdown)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  let result;
  try {
    result = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch {
    throw new Error(`Anthropic answer was not JSON (stop_reason ${data.stop_reason ?? 'unknown'})`);
  }
  if (typeof result?.is_sensitive !== 'boolean') {
    throw new Error('Anthropic answer has no is_sensitive verdict');
  }

  return {
    is_sensitive: result.is_sensitive || false,
    document_type: result.document_type || null,
    confidence: result.confidence || 0,
    extracted_data: result.extracted_data || {},
    raw_text: result.raw_text || ''
  };
}

