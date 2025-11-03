/**
 * WORK ORDER OCR EXTRACTOR
 * 
 * Specialized for extracting structured data from printed work orders:
 * - Customer name, vehicle details
 * - Line items (labor, parts, materials)
 * - Labor hours, rates, totals
 * - Date of service
 * - Technician names
 * - Invoice/PO numbers
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const openaiKey = Deno.env.get('OPENAI_API_KEY');

serve(async (req) => {
  try {
    const { image_url } = await req.json();
    
    // Use GPT-4 Vision with OCR-optimized prompt
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert at extracting data from automotive work orders and invoices.

Extract ALL visible information, including:
1. Customer name and vehicle details (year, make, model, VIN if visible)
2. Service date
3. Line items with descriptions, hours, rates, costs
4. Technician names
5. Subtotals, tax, total
6. Invoice/PO/RO numbers
7. Shop name and contact info

Be PRECISE - copy exact text from the document.
If something is unclear or partially visible, note it.
Return valid JSON only.`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Extract all data from this work order. Return JSON with this structure:
{
  "shop_name": "string",
  "work_order_number": "string",
  "service_date": "YYYY-MM-DD",
  "customer_name": "string",
  "vehicle": {
    "year": number,
    "make": "string",
    "model": "string",
    "vin": "string"
  },
  "line_items": [
    {
      "description": "string",
      "quantity": number,
      "hours": number,
      "rate": number,
      "amount": number,
      "category": "labor" | "parts" | "materials" | "shop_supplies"
    }
  ],
  "technicians": ["string"],
  "labor_total": number,
  "parts_total": number,
  "subtotal": number,
  "tax": number,
  "total": number,
  "currency": "EUR" | "USD",
  "notes": "string",
  "extraction_confidence": 0-100
}`
              },
              {
                type: 'image_url',
                image_url: { url: image_url }
              }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000
      })
    });
    
    const result = await response.json();
    const extracted = JSON.parse(result.choices[0].message.content);
    
    return new Response(JSON.stringify({
      success: true,
      data: extracted
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

