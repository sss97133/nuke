import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

type ChecklistResult = {
  missing: string[]
  low_confidence: string[]
  notes: string[]
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CHECKLIST = [
  'year',
  'make',
  'model',
  'trim',
  'price',
  'mileage',
  'vin',
  'body_style',
  'drivetrain',
  'transmission',
  'engine',
  'exterior_color',
  'interior_color',
  'location',
  'seller_name',
  'seller_type',
  'organization_name',
  'listing_url',
  'posted_date',
  'updated_date',
  'description',
  'images',
  'bids',          // for auctions
  'comments',      // for auctions
  'result_status', // sold/unsold
]

function sanitizeHtml(html: string): string {
  // Drop script/style to shrink context, then hard-cap length to keep within model limit
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  return stripped.slice(0, 12000)
}

async function runLLM(html: string, data: Record<string, unknown> | null): Promise<ChecklistResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('OPEN_AI_API_KEY')
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const compactHtml = sanitizeHtml(html)

  const payload = {
    model: 'gpt-3.5-turbo-0125',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are an inspection agent. Given raw HTML (and optional scraped JSON), identify which standard vehicle fields are missing or low-confidence. Only flag fields that are absent or clearly unreliable. Be concise.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          checklist: CHECKLIST,
          html_sample: compactHtml,
          scraped_data: data,
        }),
      },
    ],
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LLM call failed: ${res.status} ${text}`)
  }

  const json = await res.json()
  const content: string = json?.choices?.[0]?.message?.content || ''
  // Expect a simple JSON object; be tolerant of minor formatting issues
  try {
    const parsed = JSON.parse(content)
    return {
      missing: parsed.missing || [],
      low_confidence: parsed.low_confidence || [],
      notes: parsed.notes || [],
    }
  } catch (_err) {
    // Fallback: try to parse bullet-like text
    const lower = content.toLowerCase()
    const missing = CHECKLIST.filter((field) => lower.includes(`${field}: missing`) || lower.includes(`${field} missing`))
    return { missing, low_confidence: [], notes: [content] }
  }
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; scrape-inspector/1.0)',
    },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch URL ${url}: ${res.status}`)
  }
  return await res.text()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { url, html, scraped_data = null } = body || {}

    if (!url && !html) {
      return new Response(JSON.stringify({ success: false, error: 'Provide url or html' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const htmlContent = html || (url ? await fetchHtml(url) : '')
    const result = await runLLM(htmlContent, scraped_data)

    return new Response(
      JSON.stringify({
        success: true,
        missing: result.missing,
        low_confidence: result.low_confidence,
        notes: result.notes,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error: any) {
    console.error('inspect-scrape-coverage error:', error)
    return new Response(JSON.stringify({ success: false, error: error?.message || 'Unknown error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})

