import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Process URL Drop
 * User pastes a URL, AI extracts data, creates profile, assigns contributor rank
 */

interface URLDropRequest {
  url: string;
  userId: string;
  opinion?: string;
  rating?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, userId, opinion, rating }: URLDropRequest = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Detect URL type
    const urlType = detectURLType(url);
    console.log('Detected URL type:', urlType);

    // 2. Queue the URL for processing
    const { data: queueEntry, error: queueError } = await supabase
      .from('url_drop_queue')
      .insert({
        user_id: userId,
        dropped_url: url,
        url_type: urlType,
        status: 'processing'
      })
      .select()
      .single();

    if (queueError) throw queueError;

    // 3. Process based on URL type
    let entityData: any = {};
    let entityType: string = '';
    let entityId: string | null = null;

    switch (urlType) {
      case 'n-zero_org':
        ({ entityData, entityId } = await processNZeroOrgURL(url, supabase));
        entityType = 'organization';
        break;
      
      case 'n-zero_vehicle':
        ({ entityData, entityId } = await processNZeroVehicleURL(url, supabase));
        entityType = 'vehicle';
        break;
      
      case 'bat_listing':
        ({ entityData, entityId } = await processBaTListingURL(url, supabase));
        entityType = 'vehicle';
        break;
      
      case 'instagram':
        ({ entityData, entityId } = await processInstagramURL(url, supabase));
        entityType = 'vehicle'; // Could be org too
        break;
      
      default:
        // Generic scrape
        ({ entityData, entityId } = await processGenericURL(url, supabase));
        entityType = entityData.type || 'unknown';
    }

    // 4. Calculate contributor rank (how many people already contributed?)
    const { count: existingContributors } = await supabase
      .from('entity_opinions')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);

    const contributorRank = (existingContributors || 0) + 1;
    const isOriginalDiscoverer = contributorRank === 1;

    // 5. Create opinion/contribution record
    const { error: opinionError } = await supabase
      .from('entity_opinions')
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        user_id: userId,
        opinion_text: opinion,
        rating: rating,
        contributor_rank: contributorRank,
        is_original_discoverer: isOriginalDiscoverer,
        source_url: url,
        data_contributed: entityData,
        contribution_score: isOriginalDiscoverer ? 100 : 50
      });

    if (opinionError && opinionError.code !== '23505') { // Ignore duplicate constraint
      console.error('Opinion error:', opinionError);
    }

    // 6. Award points
    const pointsCategory = isOriginalDiscoverer ? 'discovery' : 'data_fill';
    const pointsAmount = isOriginalDiscoverer ? 100 : 50;

    await supabase.rpc('award_points', {
      p_user_id: userId,
      p_category: pointsCategory,
      p_points: pointsAmount,
      p_reason: `Contributed to ${entityType} from ${urlType}`
    });

    // 7. Detect data gaps
    await supabase.rpc('detect_data_gaps', {
      p_entity_type: entityType,
      p_entity_id: entityId
    });

    // 8. Update queue status
    await supabase
      .from('url_drop_queue')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        extracted_data: entityData,
        entity_type: entityType,
        entity_id: entityId
      })
      .eq('id', queueEntry.id);

    return new Response(
      JSON.stringify({
        success: true,
        entityType,
        entityId,
        contributorRank,
        isOriginalDiscoverer,
        pointsAwarded: pointsAmount,
        message: isOriginalDiscoverer 
          ? `Congratulations! You discovered this ${entityType}! +${pointsAmount} points`
          : `You're contributor #${contributorRank}! +${pointsAmount} points`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Process URL drop error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================
// URL TYPE DETECTION
// ============================================

function detectURLType(url: string): string {
  if (url.includes('n-zero.dev/org/')) return 'n-zero_org';
  if (url.includes('n-zero.dev/vehicle/')) return 'n-zero_vehicle';
  if (url.includes('bringatrailer.com')) return 'bat_listing';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  return 'unknown';
}

// ============================================
// N-ZERO URL PROCESSORS
// ============================================

async function processNZeroOrgURL(url: string, supabase: any) {
  // Extract org ID from URL
  const orgId = url.split('/org/')[1]?.split('?')[0];
  
  if (!orgId) {
    throw new Error('Invalid n-zero org URL');
  }

  // Fetch existing org data
  const { data: org, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();

  if (error) throw error;

  return {
    entityData: org,
    entityId: orgId
  };
}

async function processNZeroVehicleURL(url: string, supabase: any) {
  // Extract vehicle ID from URL
  const vehicleId = url.split('/vehicle/')[1]?.split('?')[0];
  
  if (!vehicleId) {
    throw new Error('Invalid n-zero vehicle URL');
  }

  // Fetch existing vehicle data
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();

  if (error) throw error;

  return {
    entityData: vehicle,
    entityId: vehicleId
  };
}

// ============================================
// BAT LISTING PROCESSOR
// ============================================

async function processBaTListingURL(url: string, supabase: any) {
  // Check if vehicle already exists for this URL
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('listing_url', url)
    .single();

  if (existing) {
    return {
      entityData: { listing_url: url },
      entityId: existing.id
    };
  }

  // Call existing BaT import function
  const importResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/import-bat-listing`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url })
  });

  const importData = await importResponse.json();

  if (!importData.success) {
    throw new Error('Failed to import BaT listing');
  }

  return {
    entityData: importData.vehicle,
    entityId: importData.vehicleId
  };
}

// ============================================
// INSTAGRAM PROCESSOR
// ============================================

async function processInstagramURL(url: string, supabase: any) {
  // For now, just extract the post ID and store as reference
  // Future: Use OpenAI Vision to analyze the post
  
  const postId = url.match(/\/p\/([A-Za-z0-9_-]+)/)?.[1];

  return {
    entityData: {
      instagram_url: url,
      instagram_post_id: postId,
      type: 'social_media_reference'
    },
    entityId: null // No entity created yet
  };
}

// ============================================
// GENERIC URL PROCESSOR
// ============================================

async function processGenericURL(url: string, supabase: any) {
  // Use OpenAI to analyze the URL content
  const openaiKey = Deno.env.get('OPENAI_API_KEY');

  if (!openaiKey) {
    throw new Error('OpenAI API key not configured');
  }

  // Fetch the page content
  const response = await fetch(url);
  const html = await response.text();

  // Extract text content (simple version, could use Cheerio/JSDOM)
  const textContent = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000); // Limit to 4000 chars

  // Ask OpenAI to extract vehicle/org data
  const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a data extraction expert. Analyze the provided webpage content and extract vehicle or organization information. Return JSON.`
        },
        {
          role: 'user',
          content: `Extract data from this page:\n\n${textContent}\n\nReturn JSON with fields: type (vehicle/organization/unknown), year, make, model, vin, price, description, location, name, etc.`
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1000
    })
  });

  const aiData = await openaiResponse.json();
  const extractedData = JSON.parse(aiData.choices[0].message.content);

  // If it's a vehicle, create it
  if (extractedData.type === 'vehicle' && extractedData.make) {
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .insert({
        year: extractedData.year,
        make: extractedData.make,
        model: extractedData.model,
        vin: extractedData.vin || `VIVA-${Date.now()}`,
        listing_url: url,
        discovery_source: 'url_drop'
      })
      .select()
      .single();

    if (error) throw error;

    return {
      entityData: vehicle,
      entityId: vehicle.id
    };
  }

  return {
    entityData: extractedData,
    entityId: null
  };
}

