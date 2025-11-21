// Get Manual Pages for Image
// Returns relevant manual pages/sections for a labeled image

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );

    const { imageId } = await req.json();

    if (!imageId) {
      return new Response(
        JSON.stringify({ error: 'Missing imageId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📚 Fetching manual pages for image ${imageId}`);

    // Get image classification data
    const { data: imageData, error: imageError } = await supabase
      .from('vehicle_images')
      .select(`
        id,
        vehicle_id,
        vehicle_image_angles (
          angle_id,
          image_coverage_angles (
            angle_name,
            category
          )
        ),
        image_spatial_metadata (
          part_name,
          part_category,
          system_area
        )
      `)
      .eq('id', imageId)
      .single();

    if (imageError || !imageData) {
      return new Response(
        JSON.stringify({ error: 'Image not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const vehicleId = imageData.vehicle_id;
    const partName = imageData.image_spatial_metadata?.[0]?.part_name;
    const systemArea = imageData.image_spatial_metadata?.[0]?.system_area;
    const angleCategory = imageData.vehicle_image_angles?.[0]?.image_coverage_angles?.category;

    // Get available manuals for this vehicle
    const { data: manualLinks } = await supabase
      .from('vehicle_manual_links')
      .select(`
        manual_id,
        match_confidence,
        vehicle_manuals (
          id,
          title,
          manual_type,
          file_url,
          storage_path
        )
      `)
      .eq('vehicle_id', vehicleId)
      .order('match_confidence', { ascending: false });

    if (!manualLinks || manualLinks.length === 0) {
      return new Response(
        JSON.stringify({ 
          manuals: [],
          message: 'No manuals available for this vehicle'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const manualIds = manualLinks.map(link => link.manual_id);

    // Build query for manual references
    let query = supabase
      .from('manual_image_references')
      .select('*')
      .in('manual_id', manualIds);

    // Prioritize matches by part name, then system area, then angle
    const conditions: any[] = [];
    
    if (partName) {
      conditions.push({ part_name: { ilike: `%${partName}%` } });
    }
    if (systemArea) {
      conditions.push({ system_area: { eq: systemArea } });
    }
    if (angleCategory) {
      conditions.push({ angle_family: { eq: angleCategory } });
    }

    // Get matching references
    const { data: references, error: refError } = await query;

    if (refError) {
      console.error('Error fetching manual references:', refError);
    }

    // Group by manual and calculate match scores
    const manualPages: any[] = [];
    
    if (references && references.length > 0) {
      for (const ref of references) {
        const manual = manualLinks.find(link => link.manual_id === ref.manual_id);
        if (!manual) continue;

        let matchScore = 50;
        let matchReason = 'General reference';

        if (partName && ref.part_name && ref.part_name.toLowerCase().includes(partName.toLowerCase())) {
          matchScore = 95;
          matchReason = `Part match: ${ref.part_name}`;
        } else if (systemArea && ref.system_area && ref.system_area.toLowerCase() === systemArea.toLowerCase()) {
          matchScore = 85;
          matchReason = `System area match: ${ref.system_area}`;
        } else if (angleCategory && ref.angle_family && ref.angle_family === angleCategory) {
          matchScore = 75;
          matchReason = `Angle category match: ${ref.angle_family}`;
        }

        manualPages.push({
          manual_id: ref.manual_id,
          manual_title: manual.vehicle_manuals.title,
          manual_type: manual.vehicle_manuals.manual_type,
          manual_url: manual.vehicle_manuals.file_url || 
            (manual.vehicle_manuals.storage_path 
              ? `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/manuals/${manual.vehicle_manuals.storage_path}`
              : null),
          page_number: ref.page_number,
          section_title: ref.section_title,
          part_name: ref.part_name,
          system_area: ref.system_area,
          diagram_type: ref.diagram_type,
          diagram_image_url: ref.image_url,
          match_reason: matchReason,
          match_confidence: matchScore
        });
      }
    }

    // Sort by match confidence
    manualPages.sort((a, b) => b.match_confidence - a.match_confidence);

    // If no specific matches, return available manuals (general reference)
    if (manualPages.length === 0) {
      for (const link of manualLinks) {
        manualPages.push({
          manual_id: link.manual_id,
          manual_title: link.vehicle_manuals.title,
          manual_type: link.vehicle_manuals.manual_type,
          manual_url: link.vehicle_manuals.file_url || 
            (link.vehicle_manuals.storage_path 
              ? `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/manuals/${link.vehicle_manuals.storage_path}`
              : null),
          page_number: null,
          section_title: null,
          part_name: null,
          system_area: null,
          diagram_type: null,
          diagram_image_url: null,
          match_reason: 'General reference - no specific page match',
          match_confidence: link.match_confidence
        });
      }
    }

    return new Response(
      JSON.stringify({
        image_id: imageId,
        vehicle_id: vehicleId,
        image_classification: {
          part_name: partName,
          system_area: systemArea,
          angle_category: angleCategory
        },
        manuals: manualPages,
        count: manualPages.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error getting manual pages:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error',
        manuals: []
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

