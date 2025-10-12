// Supabase Edge Function: receipt-extract (Deno)
// Real extraction via Azure Form Recognizer prebuilt-receipt model
// Deploy: supabase functions deploy receipt-extract

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// Basic CORS for local dev and app usage
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function fetchFileBytes(params: { url?: string; bucket?: string; path?: string }): Promise<Uint8Array> {
  const { url, bucket, path } = params;
  let fileUrl = url;
  if (!fileUrl && bucket && path) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) throw new Error('SUPABASE_URL not set');
    fileUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
  }
  if (!fileUrl) throw new Error('No file URL provided');
  const resp = await fetch(fileUrl);
  if (!resp.ok) throw new Error(`Failed to fetch file: ${resp.status}`);
  const ab = await resp.arrayBuffer();
  return new Uint8Array(ab);
}

async function analyzeWithAzureReceipt(bytes: Uint8Array) {
  const endpoint = Deno.env.get('AZURE_FORM_RECOGNIZER_ENDPOINT');
  const key = Deno.env.get('AZURE_FORM_RECOGNIZER_KEY');
  if (!endpoint || !key) throw new Error('Azure Form Recognizer env vars not set');

  const apiVersion = '2023-07-31';
  const analyzeUrl = `${endpoint.replace(/\/$/, '')}/formrecognizer/documentModels/prebuilt-receipt:analyze?api-version=${apiVersion}`;
  const post = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Ocp-Apim-Subscription-Key': key
    },
    body: bytes
  });

  if (post.status !== 202) {
    const text = await post.text();
    throw new Error(`Azure analyze start failed: ${post.status} ${text}`);
  }

  const opLoc = post.headers.get('operation-location');
  if (!opLoc) throw new Error('Missing operation-location header');

  // Poll for result
  let result;
  const maxTries = 20;
  for (let i = 0; i < maxTries; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const res = await fetch(opLoc, { headers: { 'Ocp-Apim-Subscription-Key': key } });
    if (!res.ok) throw new Error(`Azure poll failed: ${res.status}`);
    const json = await res.json();
    if (json.status === 'succeeded') { result = json; break; }
    if (json.status === 'failed') throw new Error('Azure analysis failed');
  }
  if (!result) throw new Error('Azure analysis timed out');
  return result;
}

function mapAzureToParsed(result: any) {
  const doc = result?.analyzeResult?.documents?.[0];
  const fields = doc?.fields || {};
  const val = (f: string) => fields?.[f]?.valueString ?? fields?.[f]?.valueDate ?? fields?.[f]?.content ?? null;
  const num = (f: string) => {
    const v = fields?.[f];
    return v?.valueNumber ?? (typeof v?.content === 'string' ? Number(v.content.replace(/[^0-9.\-]/g, '')) : null);
  };
  const itemsArr: any[] = (fields?.Items?.valueArray || []).map((it: any, idx: number) => {
    const obj = it?.valueObject || {};
    const get = (k: string) => obj?.[k]?.valueString ?? obj?.[k]?.content ?? null;
    const getNum = (k: string) => obj?.[k]?.valueNumber ?? (typeof obj?.[k]?.content === 'string' ? Number(obj?.[k]?.content.replace(/[^0-9.\-]/g, '')) : null);
    return {
      line_number: idx + 1,
      description: get('Description'),
      part_number: get('ProductCode') || null,
      quantity: getNum('Quantity'),
      unit_price: getNum('Price'),
      total_price: getNum('Total')
    };
  });

  const parsed = {
    vendor_name: val('MerchantName') || null,
    receipt_date: val('TransactionDate') || null,
    currency: null,
    subtotal: num('Subtotal') ?? null,
    tax: num('Tax') ?? null,
    total: num('Total') ?? null,
    payment_method: val('PaymentMethod') || null,
    card_last4: val('CardNumber') ? String(val('CardNumber')).slice(-4) : null,
    items: itemsArr,
    raw_json: result
  };
  return parsed;
}

serve(async (req: Request) => {
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    const { bucket, path, mimeType, url } = await req.json().catch(() => ({ bucket: '', path: '', mimeType: '', url: '' }));

    const provider = (Deno.env.get('RECEIPT_PROVIDER') || '').toLowerCase();
    const awsEndpoint = Deno.env.get('AWS_RECEIPT_ENDPOINT');
    const awsApiKey = Deno.env.get('AWS_RECEIPT_API_KEY');

    // Prefer AWS API Gateway if configured
    if (provider === 'aws' || awsEndpoint) {
      // Construct target URL
      let target = (awsEndpoint || '').trim();
      if (!target) throw new Error('AWS_RECEIPT_ENDPOINT not set');
      // If the endpoint is the stage root, append route
      if (!/\/analyze-receipt\/?$/.test(target)) {
        target = target.replace(/\/$/, '') + '/analyze-receipt';
      }
      // Prefer direct URL if given; else build public url from bucket/path
      let fileUrl = url;
      if (!fileUrl && bucket && path) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        if (!supabaseUrl) throw new Error('SUPABASE_URL not set');
        fileUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
      }
      if (!fileUrl) throw new Error('No url provided');

      const resp = await fetch(target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(awsApiKey ? { 'x-api-key': awsApiKey } : {})
        },
        body: JSON.stringify({ url: fileUrl, mimeType })
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`AWS gateway error ${resp.status}: ${text}`);
      return new Response(text, { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // Fallback: Azure Form Recognizer (requires env vars set)
    const bytes = await fetchFileBytes({ url, bucket, path });
    const azure = await analyzeWithAzureReceipt(bytes);
    const parsed = mapAzureToParsed(azure);
    return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
