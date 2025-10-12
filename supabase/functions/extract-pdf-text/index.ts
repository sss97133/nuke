import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import * as pdfParse from 'https://cdn.skypack.dev/pdf-parse@1.1.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get the PDF file from the request
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file || file.type !== 'application/pdf') {
      throw new Error('Invalid file. Please upload a PDF.');
    }

    // Convert file to buffer
    const buffer = await file.arrayBuffer();
    const data = await pdfParse(new Uint8Array(buffer));
    
    // Return the extracted text
    return new Response(
      JSON.stringify({
        success: true,
        text: data.text,
        pages: data.numpages,
        info: data.info
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
