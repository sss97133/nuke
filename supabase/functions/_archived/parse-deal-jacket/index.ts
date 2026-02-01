import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedDealJacket {
  vehicle: {
    vin?: string;
    year?: number;
    make?: string;
    model?: string;
    series?: string;
    color?: string;
    odometer?: number;
  };
  financial: {
    purchase_cost?: number;
    sale_price?: number;
    total_reconditioning?: number;
    total_cost?: number;
    gross_profit?: number;
    reconditioning_breakdown: Array<{
      description: string;
      amount: number;
      category?: string;
      attributed_to?: string;
    }>;
  };
  people: {
    acquired_from?: {
      name: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
    sold_to?: {
      name: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      email?: string;
      phone?: string;
    };
  };
  dates: {
    acquisition_date?: string;
    sold_date?: string;
  };
  organizations: Array<{
    name: string;
    role: string;
    amount?: number;
  }>;
  investors: Array<{
    name: string;
    investment_amount: number;
    return_amount?: number;
    percentage?: number;
  }>;
  contractors: Array<{
    name: string;
    work_description: string;
    amount: number;
    category?: string;
  }>;
  metadata: {
    stock_number?: string;
    confidence_score: number;
    needs_review: boolean;
    extraction_notes: string[];
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const { imageUrl, organizationId } = await req.json();

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: 'Image URL required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Call OpenAI Vision API to parse the deal jacket
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert at parsing vehicle deal jackets and financial documents. Extract ALL data from the document in a structured format. Pay special attention to:
- Vehicle details (VIN, year, make, model, color, odometer)
- Financial data (purchase cost, sale price, reconditioning costs broken down by line item)
- People (Acquired From, Sold To, contractors, investors)
- Organizations (dealerships, shops, service providers)
- Dates (acquisition, sale)
- Attribution (who did what work, investor contributions like "Laura Wynne $19000 Inv")
- Work breakdown (parts, labor, paint, upholstery, detail work)

Return valid JSON matching the ParsedDealJacket interface. Be thorough and accurate.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Parse this vehicle deal jacket and extract all data. Pay special attention to financial flows, investor contributions (like "Laura Wynne"), contractor attributions (like "Ernie\'s Upholstery", "Doug labor", "Skylar repairs"), and organizational fees (like "A Car\'s Life LLC 5%").',
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });

    if (!openaiResponse.ok) {
      const error = await openaiResponse.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices[0].message.content;

    // Extract JSON from markdown code blocks if present
    let parsedData: ParsedDealJacket;
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      parsedData = JSON.parse(jsonMatch[1]);
    } else {
      parsedData = JSON.parse(content);
    }

    // Store the parsed deal jacket for review
    const { data: dealJacket, error: insertError } = await supabaseAdmin
      .from('deal_jacket_imports')
      .insert({
        user_id: user.id,
        organization_id: organizationId,
        image_url: imageUrl,
        parsed_data: parsedData,
        status: parsedData.metadata.needs_review ? 'needs_review' : 'parsed',
        confidence_score: parsedData.metadata.confidence_score,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({
        success: true,
        dealJacketId: dealJacket.id,
        parsedData,
        message: parsedData.metadata.needs_review
          ? 'Parsed successfully but needs manual review'
          : 'Parsed successfully',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Parse error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

