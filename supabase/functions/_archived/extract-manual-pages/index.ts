/**
 * EXTRACT MANUAL PAGES
 * 
 * Takes PDF manuals and extracts individual pages as images
 * Tags each page with AI-detected topics (VIN decode, model ID, engine specs, etc.)
 * Enables on-demand reference display when editing vehicle fields
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const { document_id, pdf_url } = await req.json();

    console.log(`📄 Extracting pages from document: ${document_id}`);

    // For now, we'll use pdf.co or similar service to convert PDF to images
    // Alternative: Use CloudConvert API or pdf2image
    
    const pdfCoApiKey = Deno.env.get('PDFCO_API_KEY');
    if (!pdfCoApiKey) {
      throw new Error('PDFCO_API_KEY not configured');
    }

    // Step 1: Convert PDF to individual page images
    console.log('Converting PDF to images...');
    const convertResponse = await fetch('https://api.pdf.co/v1/pdf/convert/to/jpg', {
      method: 'POST',
      headers: {
        'x-api-key': pdfCoApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: pdf_url,
        async: false, // Wait for conversion
        pages: '0-end' // All pages
      })
    });

    if (!convertResponse.ok) {
      throw new Error(`PDF.co conversion failed: ${convertResponse.statusText}`);
    }

    const convertResult = await convertResponse.json();
    
    if (!convertResult.urls || convertResult.urls.length === 0) {
      throw new Error('No pages extracted from PDF');
    }

    console.log(`✅ Extracted ${convertResult.urls.length} pages`);

    // Step 2: Download each page image and upload to Supabase Storage
    const uploadedPages: any[] = [];
    
    for (let i = 0; i < convertResult.urls.length; i++) {
      const pageImageUrl = convertResult.urls[i];
      const pageNumber = i + 1;
      
      console.log(`Downloading page ${pageNumber}...`);
      const imageResponse = await fetch(pageImageUrl);
      const imageBlob = await imageResponse.blob();
      const imageBuffer = await imageBlob.arrayBuffer();
      
      // Upload to Supabase Storage
      const storagePath = `manuals/${document_id}/page_${pageNumber}.jpg`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('reference-docs')
        .upload(storagePath, imageBuffer, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (uploadError) {
        console.error(`Failed to upload page ${pageNumber}:`, uploadError);
        continue;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('reference-docs')
        .getPublicUrl(storagePath);

      uploadedPages.push({
        page_number: pageNumber,
        image_url: urlData.publicUrl,
        storage_path: storagePath
      });
    }

    console.log(`✅ Uploaded ${uploadedPages.length} pages to storage`);

    // Step 3: Use AI to index each page and detect topics
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      console.warn('OPENAI_API_KEY not set - skipping AI indexing');
    }

    for (const page of uploadedPages) {
      let topics: any = {};
      let pageText = '';

      if (openaiKey) {
        // Use GPT-4 Vision to analyze page and detect topics
        const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Analyze this manual page and identify its topics. Return JSON with:
{
  "topics": ["vin_decode", "model_identification", "engine_specs", "transmission", "axle_ratios", "paint_codes", "rpo_codes", "dimensions", "weights", "electrical", "wiring", "maintenance", "torque_specs"],
  "title": "page title or section name",
  "has_diagrams": true/false,
  "has_tables": true/false,
  "key_info": "brief summary of key info on this page"
}
Only include topics that are CLEARLY present on this page.`
                },
                {
                  type: 'image_url',
                  image_url: { url: page.image_url }
                }
              ]
            }],
            max_tokens: 500
          })
        });

        if (visionResponse.ok) {
          const visionResult = await visionResponse.json();
          const content = visionResult.choices[0].message.content;
          
          try {
            // Extract JSON from response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const analysis = JSON.parse(jsonMatch[0]);
              topics = analysis.topics || [];
              pageText = analysis.title || '';
              
              console.log(`  Page ${page.page_number}: ${topics.join(', ')}`);
            }
          } catch (e) {
            console.warn(`Failed to parse AI response for page ${page.page_number}`);
          }
        }
      }

      // Insert into catalog_pages
      const { error: pageError } = await supabase
        .from('catalog_pages')
        .upsert({
          catalog_id: document_id, // Treating library_document as catalog_source
          page_number: page.page_number,
          image_url: page.image_url,
          raw_text: pageText,
          metadata: {
            topics: topics,
            storage_path: page.storage_path
          }
        }, { onConflict: 'catalog_id,page_number' });

      if (pageError) {
        console.error(`Failed to save page ${page.page_number}:`, pageError);
      }
    }

    // Step 4: Update library_document with page count
    await supabase
      .from('library_documents')
      .update({
        page_count: uploadedPages.length,
        processing_status: 'indexed'
      })
      .eq('id', document_id);

    return new Response(
      JSON.stringify({
        success: true,
        document_id,
        pages_extracted: uploadedPages.length,
        message: `Extracted and indexed ${uploadedPages.length} pages`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error extracting manual pages:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});



