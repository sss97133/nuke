import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OwnerDetectionRequest {
  vehicle_id: string;
  org_id?: string; // Organization trying to establish storage relationship
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );

    const { vehicle_id, org_id }: OwnerDetectionRequest = await req.json();
    
    console.log(`🔍 Auto-detecting owner for vehicle ${vehicle_id}`);

    // Get vehicle data
    const { data: vehicle, error: vehError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicle_id)
      .single();

    if (vehError || !vehicle) {
      throw new Error('Vehicle not found');
    }

    // Try to find owner through multiple methods
    const ownershipSignals = [];

    // 1. Direct user ownership
    if (vehicle.user_id) {
      const { data: owner } = await supabase
        .from('profiles')
        .select('id, full_name, username')
        .eq('id', vehicle.user_id)
        .single();

      if (owner) {
        ownershipSignals.push({
          type: 'direct_user',
          confidence: 1.0,
          owner_id: owner.id,
          owner_name: owner.full_name || owner.username,
          owner_type: 'user'
        });
      }
    }

    // 2. Title documents (highest confidence for external ownership)
    const { data: titleDocs } = await supabase
      .from('vehicle_title_documents')
      .select('owner_name, state, issue_date, extraction_confidence')
      .eq('vehicle_id', vehicle_id)
      .order('issue_date', { ascending: false })
      .limit(1);

    if (titleDocs && titleDocs.length > 0) {
      const titleDoc = titleDocs[0];
      // Try to find matching user by name
      const { data: matchingUser } = await supabase
        .from('profiles')
        .select('id, full_name, username')
        .ilike('full_name', `%${titleDoc.owner_name}%`)
        .single();

      ownershipSignals.push({
        type: 'title_document',
        confidence: titleDoc.extraction_confidence || 0.8,
        owner_name: titleDoc.owner_name,
        owner_id: matchingUser?.id,
        owner_type: matchingUser ? 'user' : 'external',
        state: titleDoc.state,
        issue_date: titleDoc.issue_date
      });
    }

    // 3. Organization ownership (current 'owner' relationships)
    const { data: orgOwnerships } = await supabase
      .from('organization_vehicles')
      .select(`
        organization_id,
        relationship_type,
        created_at,
        businesses!inner(business_name, city, state)
      `)
      .eq('vehicle_id', vehicle_id)
      .in('relationship_type', ['owner', 'in_stock'])
      .eq('status', 'active');

    if (orgOwnerships && orgOwnerships.length > 0) {
      orgOwnerships.forEach((ov: any) => {
        ownershipSignals.push({
          type: 'organization_owner',
          confidence: 0.9,
          owner_id: ov.organization_id,
          owner_name: ov.businesses.business_name,
          owner_type: 'organization',
          location: `${ov.businesses.city}, ${ov.businesses.state}`
        });
      });
    }

    // 4. Image uploaders (recent contributors)
    const { data: recentImages } = await supabase
      .from('vehicle_images')
      .select('user_id, created_at')
      .eq('vehicle_id', vehicle_id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (recentImages && recentImages.length > 0) {
      // Count uploads by user
      const uploaderCounts = new Map<string, number>();
      recentImages.forEach(img => {
        if (img.user_id) {
          uploaderCounts.set(img.user_id, (uploaderCounts.get(img.user_id) || 0) + 1);
        }
      });

      // Get top uploader
      const topUploader = Array.from(uploaderCounts.entries())
        .sort((a, b) => b[1] - a[1])[0];

      if (topUploader) {
        const { data: uploader } = await supabase
          .from('profiles')
          .select('id, full_name, username')
          .eq('id', topUploader[0])
          .single();

        if (uploader) {
          ownershipSignals.push({
            type: 'primary_contributor',
            confidence: Math.min(topUploader[1] / 10, 0.7), // Max 70% confidence
            owner_id: uploader.id,
            owner_name: uploader.full_name || uploader.username,
            owner_type: 'user',
            upload_count: topUploader[1]
          });
        }
      }
    }

    // 5. Check for incomplete profiles that might be the same person
    const profileMergeSuggestions = [];
    if (vehicle.user_id) {
      const { data: mainProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', vehicle.user_id)
        .single();

      if (mainProfile) {
        // Look for similar profiles (same name, nearby location, etc.)
        const { data: similarProfiles } = await supabase
          .from('profiles')
          .select('id, full_name, username, created_at')
          .neq('id', vehicle.user_id)
          .limit(10);

        if (similarProfiles) {
          similarProfiles.forEach(profile => {
            // Simple name similarity check
            const mainName = (mainProfile.full_name || '').toLowerCase();
            const otherName = (profile.full_name || '').toLowerCase();
            
            if (mainName && otherName && 
                (mainName.includes(otherName) || otherName.includes(mainName))) {
              profileMergeSuggestions.push({
                profile_id: profile.id,
                profile_name: profile.full_name || profile.username,
                similarity_reason: 'name_match',
                created_at: profile.created_at
              });
            }
          });
        }
      }
    }

    // Sort by confidence
    ownershipSignals.sort((a, b) => b.confidence - a.confidence);

    console.log(`✅ Found ${ownershipSignals.length} ownership signals`);

    return new Response(
      JSON.stringify({ 
        success: true,
        vehicle_id,
        ownership_signals: ownershipSignals,
        most_likely_owner: ownershipSignals[0] || null,
        profile_merge_suggestions: profileMergeSuggestions
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error detecting owner:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

