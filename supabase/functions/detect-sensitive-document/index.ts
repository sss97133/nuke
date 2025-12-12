import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      // Support both env var names (older deploys used SERVICE_ROLE_KEY)
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
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
          // Non-fatal; doc should still be protected and extracted into vehicle_title_documents.
          console.warn('Failed to attach title to ownership_verifications (non-fatal):', (e as any)?.message || e);
        }
      }

      // Store extracted document data
      if (analysisResult.document_type && analysisResult.document_type !== 'other') {
        await supabase
          .from('vehicle_title_documents')
          .insert({
            vehicle_id,
            image_id,
            document_type: analysisResult.document_type,
            title_number: analysisResult.extracted_data.title_number,
            vin: analysisResult.extracted_data.vin,
            state: analysisResult.extracted_data.state,
            issue_date: analysisResult.extracted_data.issue_date,
            owner_name: analysisResult.extracted_data.owner_name,
            previous_owner_name: analysisResult.extracted_data.previous_owner_name,
            lienholder_name: analysisResult.extracted_data.lienholder_name,
            odometer_reading: analysisResult.extracted_data.odometer_reading,
            odometer_date: analysisResult.extracted_data.odometer_date,
            brand: analysisResult.extracted_data.brand,
            raw_ocr_text: analysisResult.raw_text,
            extracted_data: analysisResult.extracted_data,
            extraction_confidence: analysisResult.confidence
          });

        console.log(`✅ Extracted data from ${analysisResult.document_type}`);
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
      JSON.stringify({ error: error.message }),
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
      
      // 10 second timeout per provider
      const result = await Promise.race([
        provider.fn(imageUrl),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Provider timeout')), 10000)
        )
      ]);

      console.log(`✅ ${provider.name} succeeded`);
      return { ...result, provider: provider.name };

    } catch (error) {
      console.warn(`❌ ${provider.name} failed:`, error.message);
      lastError = error;
      continue; // Try next provider
    }
  }

  // All providers failed - return non-sensitive default
  console.error('❌ All providers failed, marking as non-sensitive');
  return {
    is_sensitive: false,
    document_type: null,
    confidence: 0,
    extracted_data: {},
    raw_text: '',
    provider: 'none'
  };
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

  const result = JSON.parse(content);
  
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

  // Fetch image and convert to base64
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
  const mediaType = imageResponse.headers.get('content-type') || 'image/jpeg';

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
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image
              }
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
  const content = data.content[0]?.text;
  
  if (!content) {
    return {
      is_sensitive: false,
      document_type: null,
      confidence: 0,
      extracted_data: {},
      raw_text: ''
    };
  }

  // Extract JSON from response (Claude sometimes wraps in markdown)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
  
  return {
    is_sensitive: result.is_sensitive || false,
    document_type: result.document_type || null,
    confidence: result.confidence || 0,
    extracted_data: result.extracted_data || {},
    raw_text: result.raw_text || ''
  };
}

