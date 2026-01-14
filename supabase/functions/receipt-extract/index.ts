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

async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  // Use pdf-parse (works in non-DOM runtimes) instead of pdfjs-dist workers.
  const mod: any = await import('https://cdn.skypack.dev/pdf-parse@1.1.1');
  const pdfParse: any = mod?.default ?? mod;
  if (typeof pdfParse !== 'function') throw new Error('pdf-parse import failed');
  const data: any = await pdfParse(bytes);
  return String(data?.text || '');
}

function parseMoneyText(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.\-]/g, '').replace(/(\..*)\./g, '$1'));
  return Number.isFinite(n) ? n : null;
}

function normalizeDateString(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const y = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    const mm = String(mdy[1]).padStart(2, '0');
    const dd = String(mdy[2]).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  return s;
}

function parsePdfTextDeterministic(fullText: string) {
  const findMoney = (re: RegExp) => {
    const m = fullText.match(re);
    return m?.[1] ? parseMoneyText(m[1]) : null;
  };

  const vendorName =
    /\bebay\b/i.test(fullText) ? 'eBay' :
    /\bpaypal\b/i.test(fullText) ? 'PayPal' :
    /\bamazon\b/i.test(fullText) ? 'Amazon' :
    null;

  const receiptDateRaw =
    (fullText.match(/\b(?:order\s+placed|date)\s*[:\-]?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i)?.[1] ?? null) ||
    (fullText.match(/\b([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})\b/)?.[1] ?? null);
  const receiptDate = normalizeDateString(receiptDateRaw);

  const shipping =
    findMoney(/(?:\bshipping\b)\s*[:\-]?\s*\$?\s*([0-9,]+\.[0-9]{2})/i);

  const tax =
    findMoney(/(?:\btax\b)\s*(?:\([^)]*\))?\s*[:\-]?\s*\$?\s*([0-9,]+\.[0-9]{2})/i);

  const subtotal =
    findMoney(/(?:\bsubtotal\b)\s*[:\-]?\s*\$?\s*([0-9,]+\.[0-9]{2})/i);

  const total =
    findMoney(/(?:order\s+total)\s*[:\-]?\s*\$?\s*([0-9,]+\.[0-9]{2})/i) ??
    findMoney(/(?:\btotal\b)\s*[:\-]?\s*\$?\s*([0-9,]+\.[0-9]{2})/i);

  return {
    vendor_name: vendorName,
    receipt_date: receiptDate,
    currency: 'USD',
    subtotal,
    shipping,
    tax,
    total,
    items: [],
    confidence: 0.35,
    parser: 'pdf_parse_regex_v1',
    raw_text: fullText.slice(0, 12000)
  };
}

async function analyzeWithAwsTextractExpense(bytes: Uint8Array) {
  const region = Deno.env.get('AWS_REGION') || 'us-east-1';
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID') || '';
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY') || '';
  const sessionToken = Deno.env.get('AWS_SESSION_TOKEN') || undefined;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)');
  }

  const { TextractClient, AnalyzeExpenseCommand } = await import('npm:@aws-sdk/client-textract@3.637.0');
  const client = new TextractClient({
    region,
    credentials: sessionToken ? { accessKeyId, secretAccessKey, sessionToken } : { accessKeyId, secretAccessKey }
  });

  return await client.send(new AnalyzeExpenseCommand({ Document: { Bytes: bytes } }));
}

function mapTextractExpenseToParsed(result: any) {
  const doc = Array.isArray(result?.ExpenseDocuments) ? result.ExpenseDocuments[0] : null;
  const summaryFields: any[] = Array.isArray(doc?.SummaryFields) ? doc.SummaryFields : [];

  const getSummaryText = (names: string[]) => {
    for (const name of names) {
      const f = summaryFields.find((sf) => String(sf?.Type?.Text || '').toUpperCase() === name);
      const t = f?.ValueDetection?.Text ?? null;
      if (t) return String(t);
    }
    return null;
  };

  const vendorName = getSummaryText(['VENDOR_NAME', 'VENDOR']);
  const receiptDate = normalizeDateString(getSummaryText(['INVOICE_RECEIPT_DATE', 'DATE', 'TRANSACTION_DATE']));
  const subtotal = parseMoneyText(getSummaryText(['SUBTOTAL']));
  const tax = parseMoneyText(getSummaryText(['TAX']));
  const total = parseMoneyText(getSummaryText(['TOTAL']));

  const items: any[] = [];
  const lineItemGroups: any[] = Array.isArray(doc?.LineItemGroups) ? doc.LineItemGroups : [];
  for (const g of lineItemGroups) {
    const lineItems: any[] = Array.isArray(g?.LineItems) ? g.LineItems : [];
    for (const li of lineItems) {
      const fields: any[] = Array.isArray(li?.LineItemExpenseFields) ? li.LineItemExpenseFields : [];
      const fieldText = (name: string) => {
        const f = fields.find((x) => String(x?.Type?.Text || '').toUpperCase() === name);
        const t = f?.ValueDetection?.Text ?? null;
        return t ? String(t) : null;
      };

      const description = fieldText('ITEM') || fieldText('DESCRIPTION') || fieldText('PRODUCT_NAME') || fieldText('EXPENSE_ROW') || null;
      const partNumber = fieldText('PRODUCT_CODE') || null;
      const quantity = parseMoneyText(fieldText('QUANTITY'));
      const unitPrice = parseMoneyText(fieldText('UNIT_PRICE'));
      const totalPrice = parseMoneyText(fieldText('PRICE') || fieldText('AMOUNT') || fieldText('TOTAL'));

      if (description || partNumber || totalPrice) {
        items.push({
          description: description || (partNumber ? `Item ${partNumber}` : 'Line item'),
          part_number: partNumber,
          quantity: quantity ?? null,
          unit_price: unitPrice ?? null,
          total_price: totalPrice ?? null
        });
      }
    }
  }

  // Rough confidence (0-1)
  const confidences: number[] = [];
  for (const sf of summaryFields) {
    const c = sf?.ValueDetection?.Confidence;
    if (typeof c === 'number') confidences.push(c);
  }
  const avgConf = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length / 100 : 0.6;

  return {
    vendor_name: vendorName || null,
    receipt_date: receiptDate || null,
    currency: 'USD',
    subtotal: subtotal ?? null,
    tax: tax ?? null,
    total: total ?? null,
    items,
    confidence: Math.max(0.05, Math.min(0.95, avgConf)),
    provider: 'aws_textract_expense'
  };
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
    const openaiKey =
      Deno.env.get('OPENAI_API_KEY') ||
      Deno.env.get('OPEN_AI_API_KEY') ||
      Deno.env.get('openai_api_key');
    const hasAzure = Boolean(Deno.env.get('AZURE_FORM_RECOGNIZER_ENDPOINT') && Deno.env.get('AZURE_FORM_RECOGNIZER_KEY'));
    const isPdf = String(mimeType || '').toLowerCase() === 'application/pdf';

    // Prefer AWS API Gateway if configured
    if (provider === 'aws' || awsEndpoint) {
      try {
        const rawEndpoint = (awsEndpoint || '').trim();
        if (!rawEndpoint) throw new Error('AWS_RECEIPT_ENDPOINT not set');
        const base = rawEndpoint.replace(/\/$/, '');

        // Historical deployments have used different resource paths.
        // Try the configured URL verbatim first, then common suffixes.
        const candidates: string[] = [base];
        if (!base.endsWith('/analyze-receipt')) candidates.push(`${base}/analyze-receipt`);
        if (!base.endsWith('/receipt')) candidates.push(`${base}/receipt`);

        let fileUrl = url;
        if (!fileUrl && bucket && path) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          if (!supabaseUrl) throw new Error('SUPABASE_URL not set');
          fileUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
        }
        if (!fileUrl) throw new Error('No url provided');

        let lastErr: Error | null = null;
        for (const target of candidates) {
          try {
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

            // Validate that the gateway actually returned the expected JSON object.
            // We've seen misconfigured endpoints return `"Hello from Lambda!"` (a JSON string),
            // which would silently bypass our OpenAI/Azure fallbacks.
            let parsed: any = null;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch {
              throw new Error(`AWS gateway returned non-JSON (first 200 chars): ${text.slice(0, 200)}`);
            }

            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error(`AWS gateway returned unexpected payload type: ${typeof parsed}`);
            }
            if (parsed?.error) {
              throw new Error(`AWS gateway returned error: ${String(parsed.error)}`);
            }

            return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
          } catch (e: any) {
            lastErr = e instanceof Error ? e : new Error(String(e));
          }
        }

        if (lastErr) throw lastErr;
        throw new Error('AWS gateway failed for all candidate endpoints');
      } catch (awsError) {
        console.log('AWS parsing failed, falling back to OpenAI:', awsError);
      }
    }

    // PDF text extraction (no DOM / worker required). This is the primary fix for "document is not defined".
    if (isPdf) {
      try {
        const bytes = await fetchFileBytes({ url, bucket, path });
        const fullText = await extractTextFromPdf(bytes);
        const hasText = fullText.trim().length >= 40;
        if (hasText) {
          if (openaiKey) {
            try {
              const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${openaiKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  model: 'gpt-4o',
                  messages: [{
                    role: 'user',
                    content: `Extract invoice/receipt data from this text. Return JSON with: vendor_name, receipt_date (YYYY-MM-DD), subtotal, tax, shipping, total, items array (each with: description, quantity, unit_price, total_price, part_number if available). If field not found, use null.\n\nText:\n${fullText.slice(0, 8000)}`
                  }],
                  response_format: { type: 'json_object' },
                  max_tokens: 2000
                })
              });
              if (openaiResp.ok) {
                const data = await openaiResp.json();
                const content = data.choices?.[0]?.message?.content;
                if (content) {
                  const parsed = JSON.parse(content);
                  return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
                }
              }
            } catch (e) {
              console.log('[receipt-extract] OpenAI PDF parse failed; falling back to regex:', e);
            }
          }

          const parsed = parsePdfTextDeterministic(fullText);
          return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
        }
      } catch (e: any) {
        console.log('[receipt-extract] PDF text extraction failed:', e?.message || String(e));
        // continue to Textract/Azure fallbacks (useful for scanned PDFs)
      }
    }

    let textractError: any = null;
    try {
      const bytes = await fetchFileBytes({ url, bucket, path });
      const textract = await analyzeWithAwsTextractExpense(bytes);
      const parsed = mapTextractExpenseToParsed(textract);
      return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    } catch (e: any) {
      textractError = e;
      console.log('[receipt-extract] Textract parse failed:', e?.message || String(e));
    }

    // OpenAI Vision (optional) for images only
    if (openaiKey && mimeType !== 'application/pdf') {
      let fileUrl = url;
      if (!fileUrl && bucket && path) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        if (!supabaseUrl) throw new Error('SUPABASE_URL not set');
        fileUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
      }

      const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{
            role: 'user',
            content: [{
              type: 'text',
              text: `Extract invoice/receipt data from this document. Return JSON with: vendor_name, receipt_date, subtotal, tax, total, items array (each with: description, quantity, unit_price, total_price, part_number if available). If you can't find a field, use null.`
            }, {
              type: 'image_url',
              image_url: { url: fileUrl }
            }]
          }],
          response_format: { type: 'json_object' },
          max_tokens: 2000
        })
      });

      if (openaiResp.ok) {
        const data = await openaiResp.json();
        const content = data.choices[0].message.content;
        const parsed = JSON.parse(content);
        return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
      }
    }

    if (textractError && !openaiKey && !hasAzure) {
      throw textractError;
    }

    // Last resort: Azure Form Recognizer (requires env vars set)
    const bytes = await fetchFileBytes({ url, bucket, path });
    const azure = await analyzeWithAzureReceipt(bytes);
    const parsed = mapAzureToParsed(azure);
    return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
