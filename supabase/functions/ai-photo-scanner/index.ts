import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PhotoAnalysis {
  photo_id: string;
  photo_url: string;
  photo_timestamp: string;
  gps?: { lat: number; lng: number };
  confidence_score: number;
  suggested_vehicle_id: string | null;
  reasoning: string[];
  needs_human: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { userId, photoIds } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'userId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[AI Photo Scanner] Processing for user: ${userId}`);

    // Get photos to analyze (either specific photoIds or new photos)
    let photos: any[] = [];
    
    if (photoIds && photoIds.length > 0) {
      // Analyze specific photos
      const { data, error } = await supabaseClient
        .from('vehicle_images')
        .select('id, image_url, created_at, metadata')
        .in('id', photoIds)
        .eq('uploaded_by', userId);
      
      if (error) throw error;
      photos = data || [];
    } else {
      // Get recent unanalyzed photos (last 24 hours)
      const { data, error } = await supabaseClient
        .from('vehicle_images')
        .select('id, image_url, created_at, metadata, vehicle_id')
        .eq('uploaded_by', userId)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .is('metadata->ai_analyzed', null)
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      photos = data || [];
    }

    console.log(`[AI Photo Scanner] Found ${photos.length} photos to analyze`);

    if (photos.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: 'No photos to analyze',
          auto_filed: 0,
          needs_review: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Analyze each photo
    const analyses: PhotoAnalysis[] = await Promise.all(
      photos.map(photo => analyzePhoto(supabaseClient, userId, photo))
    );

    // Auto-file high confidence photos
    const autoFiled = analyses.filter(a => a.confidence_score >= 90 && a.suggested_vehicle_id);
    const needsReview = analyses.filter(a => a.confidence_score < 90 || !a.suggested_vehicle_id);

    console.log(`[AI Photo Scanner] Auto-filing ${autoFiled.length}, needs review: ${needsReview.length}`);

    // Auto-file high confidence
    for (const analysis of autoFiled) {
      await filePhotoToVehicle(
        supabaseClient,
        analysis.photo_id,
        analysis.suggested_vehicle_id!,
        userId,
        {
          confidence_score: analysis.confidence_score,
          reasoning: analysis.reasoning,
          auto_filed: true
        }
      );
    }

    // Add low confidence to review queue
    for (const analysis of needsReview) {
      await supabaseClient
        .from('photo_review_queue')
        .insert({
          user_id: userId,
          photo_url: analysis.photo_url,
          photo_timestamp: analysis.photo_timestamp,
          gps_lat: analysis.gps?.lat,
          gps_lng: analysis.gps?.lng,
          confidence_score: analysis.confidence_score,
          suggested_vehicle_id: analysis.suggested_vehicle_id,
          reasoning: analysis.reasoning,
          status: 'pending',
        });
    }

    // Send notification if there are items to review
    if (needsReview.length > 0) {
      await sendReviewNotification(supabaseClient, userId, needsReview.length);
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_analyzed: analyses.length,
        auto_filed: autoFiled.length,
        needs_review: needsReview.length,
        analyses: analyses.map(a => ({
          photo_id: a.photo_id,
          confidence: a.confidence_score,
          vehicle_id: a.suggested_vehicle_id,
          reasoning: a.reasoning
        }))
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[AI Photo Scanner] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function analyzePhoto(
  supabase: any,
  userId: string,
  photo: any
): Promise<PhotoAnalysis> {
  let confidence = 0;
  const reasoning: string[] = [];
  let vehicleId: string | null = photo.vehicle_id || null;
  
  const gps = photo.metadata?.gps;
  const timestamp = new Date(photo.created_at);

  // Signal 1: GPS location matching (40 points)
  if (gps?.lat && gps?.lng) {
    const { data: nearbyVehicles } = await supabase.rpc('find_vehicles_near_gps', {
      p_lat: gps.lat,
      p_lng: gps.lng,
      p_radius_meters: 100,
      p_user_id: userId
    });

    if (nearbyVehicles && nearbyVehicles.length === 1) {
      if (!vehicleId) vehicleId = nearbyVehicles[0].id;
      if (vehicleId === nearbyVehicles[0].id) {
        confidence += 40;
        reasoning.push(`GPS matches ${nearbyVehicles[0].year} ${nearbyVehicles[0].make} ${nearbyVehicles[0].model} (${Math.round(nearbyVehicles[0].distance_meters)}m away)`);
      }
    } else if (nearbyVehicles && nearbyVehicles.length > 1) {
      confidence += 20;
      reasoning.push(`GPS matches ${nearbyVehicles.length} vehicles - need clarification`);
    }
  }

  // Signal 2: Recent work history (30 points)
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const { data: recentWork } = await supabase
    .from('vehicle_timeline_events')
    .select('vehicle_id, vehicles(id, year, make, model)')
    .eq('user_id', userId)
    .gte('event_date', threeDaysAgo.toISOString())
    .order('event_date', { ascending: false })
    .limit(10);

  if (recentWork && recentWork.length > 0) {
    // Count occurrences of each vehicle
    const vehicleCounts: { [key: string]: { count: number; vehicle: any } } = {};
    recentWork.forEach((event: any) => {
      const id = event.vehicle_id;
      if (!vehicleCounts[id]) {
        vehicleCounts[id] = { count: 0, vehicle: event.vehicles };
      }
      vehicleCounts[id].count++;
    });

    // Find most common vehicle
    const sorted = Object.entries(vehicleCounts).sort((a, b) => b[1].count - a[1].count);
    const mostCommon = sorted[0];

    if (mostCommon) {
      const [commonVehicleId, { vehicle }] = mostCommon;
      if (!vehicleId) vehicleId = commonVehicleId;
      if (vehicleId === commonVehicleId) {
        confidence += 30;
        reasoning.push(`You worked on ${vehicle.year} ${vehicle.make} ${vehicle.model} recently (${vehicleCounts[commonVehicleId].count} times in last 3 days)`);
      } else if (sorted.length === 1) {
        confidence += 15;
        reasoning.push(`Only worked on one vehicle recently`);
      }
    }
  }

  // Signal 3: Time clustering (20 points)
  // Check if there are other photos around the same time
  const tenMinutesBefore = new Date(timestamp.getTime() - 10 * 60 * 1000);
  const tenMinutesAfter = new Date(timestamp.getTime() + 10 * 60 * 1000);
  
  const { data: nearbyTimePhotos } = await supabase
    .from('vehicle_images')
    .select('vehicle_id, vehicles(year, make, model)')
    .eq('uploaded_by', userId)
    .gte('created_at', tenMinutesBefore.toISOString())
    .lte('created_at', tenMinutesAfter.toISOString())
    .neq('id', photo.id);

  if (nearbyTimePhotos && nearbyTimePhotos.length > 0) {
    // Check if they're all the same vehicle
    const vehicleIds = nearbyTimePhotos.map((p: any) => p.vehicle_id).filter(Boolean);
    const uniqueVehicles = [...new Set(vehicleIds)];
    
    if (uniqueVehicles.length === 1 && uniqueVehicles[0]) {
      if (!vehicleId) vehicleId = uniqueVehicles[0];
      if (vehicleId === uniqueVehicles[0]) {
        confidence += 20;
        const vehicle = nearbyTimePhotos[0].vehicles;
        reasoning.push(`${nearbyTimePhotos.length} other photos from same time are ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      }
    }
  }

  // Bonus: If photo already has vehicle_id (10 points)
  if (photo.vehicle_id) {
    confidence += 10;
    reasoning.push(`Photo was already assigned to this vehicle`);
  }

  return {
    photo_id: photo.id,
    photo_url: photo.image_url,
    photo_timestamp: photo.created_at,
    gps: gps,
    confidence_score: Math.min(confidence, 100),
    suggested_vehicle_id: vehicleId,
    reasoning,
    needs_human: confidence < 90 || !vehicleId
  };
}

async function filePhotoToVehicle(
  supabase: any,
  photoId: string,
  vehicleId: string,
  userId: string,
  metadata: any
) {
  // Update photo record
  await supabase
    .from('vehicle_images')
    .update({
      vehicle_id: vehicleId,
      metadata: {
        ...metadata,
        ai_analyzed: true,
        ai_analyzed_at: new Date().toISOString()
      }
    })
    .eq('id', photoId);

  // Create timeline event if it doesn't exist
  const { data: existingEvent } = await supabase
    .from('vehicle_timeline_events')
    .select('id')
    .eq('metadata->image_id', photoId)
    .single();

  if (!existingEvent) {
    await supabase
      .from('vehicle_timeline_events')
      .insert({
        vehicle_id: vehicleId,
        user_id: userId,
        event_type: 'image_added',
        title: 'Work Photo (AI Filed)',
        event_date: new Date().toISOString(),
        metadata: {
          image_id: photoId,
          ai_confidence: metadata.confidence_score,
          ai_reasoning: metadata.reasoning
        }
      });
  }

  console.log(`[AI Photo Scanner] Filed photo ${photoId} to vehicle ${vehicleId} (${metadata.confidence_score}% confidence)`);
}

async function sendReviewNotification(
  supabase: any,
  userId: string,
  count: number
) {
  try {
    // Create in-app notification
    await supabase
      .from('user_notifications')
      .insert({
        user_id: userId,
        notification_type: 'photo_review_needed',
        title: `AI Work Review: ${count} question${count > 1 ? 's' : ''}`,
        message: `I need your help organizing ${count} photo${count > 1 ? 's' : ''}`,
        metadata: {
          count,
          action_url: '/review-queue'
        },
        is_read: false
      });

    console.log(`[AI Photo Scanner] Sent notification to user ${userId} for ${count} photos`);
  } catch (error) {
    console.error('[AI Photo Scanner] Failed to send notification:', error);
  }
}

