// Simple receipt extraction using OpenAI Vision
// Called by MobileDocumentUploader to parse receipts automatically

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReceiptData {
  vendor_name?: string;
  date?: string;
  receipt_date?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  confidence?: number;
  items?: Array<{
    description: string;
    quantity?: number;
    unit_price?: number;
    total_price?: number;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { imageUrl, mimeType } = await req.json();

    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    // Call OpenAI Vision to extract receipt data
    const prompt = `Extract data from this receipt/invoice/service record. Return ONLY valid JSON with:
{
  "vendor_name": "shop name",
  "date": "YYYY-MM-DD",
  "total": number,
  "subtotal": number,
  "tax": number,
  "items": [
    {
      "description": "item name",
      "quantity": 1,
      "unit_price": 0.00,
      "total_price": 0.00
    }
  ],
  "confidence": 0.0-1.0
}

If this is a service record, extract labor hours as an item. Be precise with numbers.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { 
              type: 'image_url', 
              image_url: { 
                url: imageUrl,
                detail: 'high'
              } 
            }
          ]
        }],
        max_tokens: 1500,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API failed: ${errorText}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';
    
    // Extract JSON from response (handles markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON found in AI response');
    }

    const extracted: ReceiptData = JSON.parse(jsonMatch[0]);
    
    // Normalize date field
    if (extracted.date && !extracted.receipt_date) {
      extracted.receipt_date = extracted.date;
    }

    return new Response(
      JSON.stringify(extracted),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error: any) {
    console.error('Receipt extraction error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Failed to extract receipt data',
        vendor_name: null,
        total: null,
        confidence: 0
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200  // Return 200 with error object so frontend can handle gracefully
      }
    );
  }
});

