/**
 * Work Order Attribution Engine
 * Analyzes all signals at image upload to infer organization relationships
 * Builds confidence-weighted attribution chains
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface AttributionSignal {
  type: 'gps' | 'user_org' | 'vehicle_history' | 'receipt' | 'ai_vision' | 'user_explicit';
  organization_id: string;
  organization_name: string;
  role: string; // 'originator' | 'location' | 'performer' | etc
  confidence: number; // 0.0-1.0
  evidence: string;
}

interface AttributionRequest {
  timelineEventId: string;
  vehicleId: string;
  userId: string;
  imageIds: string[];
  uploadMetadata?: any;
}

const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { timelineEventId, vehicleId, userId, imageIds }: AttributionRequest = await req.json();
    
    console.log(`🔍 Analyzing attribution for event ${timelineEventId}`);

    const signals: AttributionSignal[] = [];

    // ========================================================================
    // SIGNAL 1: GPS LOCATION
    // ========================================================================
    
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, latitude, longitude, location_name')
      .in('id', imageIds)
      .not('latitude', 'is', null);

    if (images && images.length > 0) {
      // Find nearby organizations
      for (const img of images) {
        const { data: nearbyOrgs } = await supabase
          .from('businesses')
          .select('id, business_name, latitude, longitude')
          .not('latitude', 'is', null);

        if (nearbyOrgs) {
          for (const org of nearbyOrgs) {
            const distance = calculateDistance(
              parseFloat(img.latitude),
              parseFloat(img.longitude),
              parseFloat(org.latitude),
              parseFloat(org.longitude)
            );

            if (distance <= 100) { // Within 100m
              signals.push({
                type: 'gps',
                organization_id: org.id,
                organization_name: org.business_name,
                role: 'location',
                confidence: Math.max(0.5, 1.0 - (distance / 100)), // Closer = higher confidence
                evidence: `Image taken ${distance.toFixed(0)}m from ${org.business_name}`
              });
            }
          }
        }
      }
    }

    // ========================================================================
    // SIGNAL 2: USER ORGANIZATION MEMBERSHIP
    // ========================================================================
    
    const { data: userOrgs } = await supabase
      .from('business_user_roles')
      .select(`
        business_id,
        role,
        businesses:business_id (
          id,
          business_name
        )
      `)
      .eq('user_id', userId);

    if (userOrgs && userOrgs.length > 0) {
      for (const userOrg of userOrgs) {
        const isOwner = userOrg.role === 'owner' || userOrg.role === 'admin';
        signals.push({
          type: 'user_org',
          organization_id: userOrg.business_id,
          organization_name: userOrg.businesses.business_name,
          role: isOwner ? 'originator' : 'performer',
          confidence: isOwner ? 0.8 : 0.6,
          evidence: `User is ${userOrg.role} at ${userOrg.businesses.business_name}`
        });
      }
    }

    // ========================================================================
    // SIGNAL 3: VEHICLE WORK HISTORY
    // ========================================================================
    
    const { data: vehicleOrgs } = await supabase
      .from('organization_vehicles')
      .select(`
        organization_id,
        relationship_type,
        businesses:organization_id (
          id,
          business_name
        )
      `)
      .eq('vehicle_id', vehicleId);

    if (vehicleOrgs && vehicleOrgs.length > 0) {
      for (const vOrg of vehicleOrgs) {
        signals.push({
          type: 'vehicle_history',
          organization_id: vOrg.organization_id,
          organization_name: vOrg.businesses.business_name,
          role: vOrg.relationship_type === 'work_location' ? 'location' : 'performer',
          confidence: 0.5,
          evidence: `Vehicle has ${vOrg.relationship_type} relationship with ${vOrg.businesses.business_name}`
        });
      }
    }

    // ========================================================================
    // AGGREGATE SIGNALS & ASSIGN ROLES
    // ========================================================================
    
    console.log(`📊 Collected ${signals.length} attribution signals`);

    // Group by organization and role
    const orgRoles = new Map();
    
    for (const signal of signals) {
      const key = `${signal.organization_id}_${signal.role}`;
      
      if (!orgRoles.has(key)) {
        orgRoles.set(key, {
          organization_id: signal.organization_id,
          organization_name: signal.organization_name,
          role: signal.role,
          confidenceSum: 0,
          signalCount: 0,
          evidence: []
        });
      }
      
      const existing = orgRoles.get(key);
      existing.confidenceSum += signal.confidence;
      existing.signalCount++;
      existing.evidence.push(`${signal.type}: ${signal.evidence}`);
    }

    // Calculate average confidence and filter low-confidence attributions
    const attributions = Array.from(orgRoles.values())
      .map(attr => ({
        ...attr,
        confidence: attr.confidenceSum / attr.signalCount
      }))
      .filter(attr => attr.confidence >= 0.4); // Threshold

    console.log(`✅ ${attributions.length} confident attributions`);

    // Insert into work_order_collaborators
    for (const attr of attributions) {
      await supabase
        .from('work_order_collaborators')
        .insert({
          timeline_event_id: timelineEventId,
          organization_id: attr.organization_id,
          role: attr.role,
          attribution_source: 'ai_vision', // Will be upgraded by receipt/user input later
          confidence: attr.confidence,
          notes: attr.evidence.join(' • ')
        })
        .onConflict('timeline_event_id,organization_id,role')
        .ignore();
    }

    return new Response(
      JSON.stringify({
        success: true,
        attributions: attributions.map(a => ({
          organization: a.organization_name,
          role: a.role,
          confidence: (a.confidence * 100).toFixed(0) + '%',
          signals: a.signalCount
        }))
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Attribution error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

// Haversine distance (meters)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

