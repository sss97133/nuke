/**
 * Shared SPID Sheet Detection Utility
 * Detects GM SPID (Service Parts Identification) sheets and extracts data
 */

export async function detectSPIDSheet(
  imageUrl: string,
  vehicleId?: string,
  supabaseClient?: any,
  userId?: string
): Promise<{
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
} | null> {
  // Get user API key or fallback to system key
  let openAiKey: string | null = null;
  
  try {
    if (userId && supabaseClient) {
      const { getUserApiKey } = await import('./getUserApiKey.ts')
      const apiKeyResult = await getUserApiKey(
        supabaseClient,
        userId,
        'openai',
        'OPENAI_API_KEY'
      )
      openAiKey = apiKeyResult.apiKey;
    } else {
      openAiKey = Deno.env.get('OPENAI_API_KEY') || null;
    }
  } catch (err) {
    console.warn('Failed to get API key, using system key:', err)
    openAiKey = Deno.env.get('OPENAI_API_KEY') || null;
  }
  
  if (!openAiKey) return null

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a GM SPID (Service Parts Identification) sheet expert. Analyze images to detect and extract data from SPID sheets.

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

Return a JSON object with:
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

Extract ALL RPO codes you see, including engine (LS4, L31) and transmission (M40, M38) codes.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this image. Is it a GM SPID sheet? If yes, extract all visible data.'
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.warn('SPID detection API error:', response.status, errorText)
    return null
  }

  const data = await response.json()
  if (data.error) {
    console.warn('SPID detection API error:', data.error)
    return null
  }

  try {
    return JSON.parse(data.choices[0].message.content)
  } catch (err) {
    console.warn('Failed to parse SPID detection response:', err)
    return null
  }
}

