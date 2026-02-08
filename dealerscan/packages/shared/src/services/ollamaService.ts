import type { OllamaModel, ExtractionResult } from '../types'

const OLLAMA_BASE_URL = 'http://localhost:11434'

export async function checkOllamaConnection(): Promise<boolean> {
  try {
    const resp = await fetch(`${OLLAMA_BASE_URL}/api/tags`)
    return resp.ok
  } catch {
    return false
  }
}

export async function listOllamaModels(): Promise<OllamaModel[]> {
  const resp = await fetch(`${OLLAMA_BASE_URL}/api/tags`)
  if (!resp.ok) throw new Error('Cannot connect to Ollama')

  const data = await resp.json()
  return (data.models || []).map((m: any) => ({
    name: m.name,
    size: m.size,
    modified_at: m.modified_at,
    supportsVision: ['llava', 'bakllava', 'moondream', 'llama3.2-vision'].some(v =>
      m.name.toLowerCase().includes(v)
    ),
  }))
}

// Extract document data using Ollama vision model (same prompt as cloud function)
export async function extractWithOllama(
  imageBase64: string,
  modelName: string,
  onProgress?: (pct: number) => void,
): Promise<Partial<ExtractionResult>> {
  onProgress?.(10)

  const prompt = `You are a document extraction AI. Analyze this dealer jacket document image and extract all relevant data.

For each field you extract, also rate your confidence from 0-100.

Return a JSON object with these possible fields (include only those present):
{
  "document_type": "title|bill_of_sale|cost_sheet|buyers_order|registration|insurance|inspection|other",
  "vin": "17-character VIN",
  "year": number,
  "make": "manufacturer",
  "model": "model name",
  "owner_name": "full name",
  "owner_address": "full address",
  "sale_price": number,
  "trade_in_value": number,
  "down_payment": number,
  "monthly_payment": number,
  "deal_date": "YYYY-MM-DD",
  "odometer": number,
  "license_plate": "plate number",
  "title_number": "title #",
  "lien_holder": "bank/finance company",
  "tax_amount": number,
  "total_due": number,
  "stock_number": "dealer stock #",
  "color": "exterior color"
}

Also return a "confidences" object with confidence scores (0-100) for each extracted field.
Return ONLY valid JSON, no markdown.`

  onProgress?.(30)

  const resp = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      prompt,
      images: [imageBase64],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 2000,
      },
    }),
  })

  onProgress?.(80)

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Ollama extraction failed: ${err}`)
  }

  const data = await resp.json()
  const responseText = data.response || ''

  // Parse JSON from response
  let extracted: Record<string, any> = {}
  let confidences: Record<string, number> = {}

  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      // Separate confidences from extracted data
      if (parsed.confidences) {
        confidences = parsed.confidences
        delete parsed.confidences
      }
      extracted = parsed
    }
  } catch {
    // If JSON parsing fails, return raw text
    extracted = { raw_text: responseText }
    confidences = {}
  }

  // Apply lower default confidence for local extractions
  for (const key of Object.keys(extracted)) {
    if (key !== 'document_type' && key !== 'raw_text') {
      confidences[key] = Math.min(confidences[key] || 50, 75) // Cap at 75 for local
    }
  }

  // VIN validation
  if (extracted.vin) {
    const vin = String(extracted.vin).replace(/[^A-HJ-NPR-Z0-9]/gi, '')
    if (vin.length !== 17) {
      confidences['vin'] = Math.min(confidences['vin'] || 0, 30)
    }
    extracted.vin = vin.toUpperCase()
  }

  onProgress?.(100)

  const needsReview = Object.values(confidences).some(c => c < 70)

  return {
    document_type: extracted.document_type || 'unknown',
    needs_review: needsReview || true, // Always flag local extractions for review
    review_reasons: needsReview
      ? ['Local extraction - lower confidence', ...Object.entries(confidences).filter(([, v]) => v < 70).map(([k]) => `Low confidence: ${k}`)]
      : ['Local extraction - verify accuracy'],
    extracted_data: extracted,
    confidences,
  }
}
