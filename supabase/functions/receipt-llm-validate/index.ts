// Supabase Edge Function: receipt-llm-validate (Deno)
// Validates and normalizes receipt parsing using Anthropic Claude.
// Secrets required: ANTHROPIC_API_KEY
// Deploy: supabase functions deploy receipt-llm-validate

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ParsedReceiptItem {
  line_number?: number;
  description?: string;
  part_number?: string;
  vendor_sku?: string;
  category?: string;
  quantity?: number;
  unit_price?: number;
  total_price?: number;
}

interface ParsedReceipt {
  vendor_name?: string;
  receipt_date?: string;
  currency?: string;
  subtotal?: number;
  shipping?: number;
  tax?: number;
  total?: number;
  payment_method?: string;
  card_last4?: string;
  card_holder?: string;
  invoice_number?: string;
  purchase_order?: string;
  items?: ParsedReceiptItem[];
  raw_json?: any;
}

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { parsed, ocr_text }: { parsed?: ParsedReceipt; ocr_text?: string } = await req.json().catch(() => ({ parsed: undefined, ocr_text: '' }));

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const model = Deno.env.get('ANTHROPIC_MODEL') || 'claude-3-5-sonnet-20240620';

    const system = `You are a meticulous receipts parsing validator for an automotive build tracking app.
- Only infer from the provided text; do not hallucinate.
- If a field is unknown or ambiguous, return null.
- Normalize totals as numbers in USD if currency symbol present, else leave as extracted numeric.
- Extract line items; prefer rows with a quantity and a trailing price; include part_number/vendor_sku when present.
- Dates: return the source string if not ISO; do not reformat aggressively.
Return strictly a JSON object with keys: vendor_name, receipt_date, invoice_number, subtotal, shipping, tax, total, payment_method, card_last4, items (array of {description, part_number, vendor_sku, quantity, unit_price, total_price}).`;

    const user = `OCR_TEXT:\n${ocr_text || ''}\n\nCURRENT_PARSED:\n${JSON.stringify(parsed || {}, null, 2)}\n\nTASK:\nValidate/correct CURRENT_PARSED using OCR_TEXT. If CURRENT_PARSED already has a correct field, keep it. Otherwise fill from OCR_TEXT. If uncertain, set null. Output only JSON.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        temperature: 0,
        system,
        messages: [
          { role: 'user', content: [{ type: 'text', text: user }] }
        ]
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return new Response(JSON.stringify({ error: `Anthropic error ${resp.status}: ${txt}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const json = await resp.json();
    const text: string = json?.content?.[0]?.text || '';
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!data || typeof data !== 'object') {
      return new Response(JSON.stringify({ error: 'LLM returned non-JSON' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
