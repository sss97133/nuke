import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NukeBoxUpload {
  metadata: {
    path: string;
    filename: string;
    size: number;
    created: string;
    camera_make?: string;
    camera_model?: string;
    datetime_original?: string;
    gps_latitude?: number;
    gps_longitude?: number;
    device_fingerprint?: string;
    phash?: string;      // Perceptual hash for similarity
    dhash?: string;      // Difference hash for crop detection
    file_hash?: string;  // Content hash
  };
  classification: {
    is_vehicle: boolean;
    is_document: boolean;
    document_type?: string;
    vehicle_attributes?: {
      make?: string;
      model?: string;
      year?: string;
      color?: string;
      body_style?: string;
      distinctive_features?: string[];
    };
    confidence: number;
    scene_description?: string;
    quality_indicators?: {
      blur_detected: boolean;
      low_light: boolean;
      partial_vehicle: boolean;
    };
  };
  vehicle_group?: string;
  source: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from JWT
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (user && !error) {
        userId = user.id;
      }
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const metadataStr = formData.get("metadata") as string;
    const classificationStr = formData.get("classification") as string;
    const vehicleGroup = formData.get("vehicle_group") as string;
    const source = formData.get("source") as string || "nuke-box";

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const metadata = metadataStr ? JSON.parse(metadataStr) : {};
    const classification = classificationStr ? JSON.parse(classificationStr) : {};

    // Generate unique filename
    const timestamp = Date.now();
    const ext = file.name.split(".").pop() || "jpg";
    const storagePath = `nuke-box/${timestamp}_${file.name}`;

    // Upload to Supabase Storage
    const fileBuffer = await file.arrayBuffer();
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("vehicle-images")
      .upload(storagePath, fileBuffer, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: "Failed to upload file", details: uploadError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("vehicle-images")
      .getPublicUrl(storagePath);

    const imageUrl = urlData.publicUrl;

    // Check for similar images if we have a pHash
    let similarImages: any[] = [];
    if (metadata.phash) {
      const { data: similar } = await supabase.rpc("find_similar_images", {
        target_phash: metadata.phash,
        max_distance: 10,
        limit_count: 5,
      });
      if (similar && similar.length > 0) {
        similarImages = similar;
        console.log(`Found ${similar.length} similar images for pHash ${metadata.phash}`);
      }
    }

    // Determine how to process this upload
    let result: any = {
      uploaded: true,
      storage_path: storagePath,
      public_url: imageUrl,
      classification,
      similar_images: similarImages.length > 0 ? similarImages : undefined,
    };

    // If it's a document (especially title), create pending ownership verification
    if (classification.is_document && classification.document_type === "title") {
      // Queue for title processing
      const { data: queueData, error: queueError } = await supabase
        .from("nuke_box_queue")
        .insert({
          user_id: userId,
          source_path: metadata.path,
          storage_path: storagePath,
          image_url: imageUrl,
          classification,
          metadata,
          vehicle_group: vehicleGroup,
          processing_status: "pending_title_extraction",
          priority: 0, // Highest priority for titles
          phash: metadata.phash,
          dhash: metadata.dhash,
          file_hash: metadata.file_hash,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (!queueError && queueData) {
        result.queue_id = queueData.id;
        result.processing_status = "pending_title_extraction";
      }
    }
    // If it's a vehicle image, try to match or create vehicle
    else if (classification.is_vehicle) {
      // Queue for vehicle matching
      const { data: queueData, error: queueError } = await supabase
        .from("nuke_box_queue")
        .insert({
          user_id: userId,
          source_path: metadata.path,
          storage_path: storagePath,
          image_url: imageUrl,
          classification,
          metadata,
          vehicle_group: vehicleGroup,
          processing_status: "pending_vehicle_match",
          priority: vehicleGroup && !vehicleGroup.startsWith("_") ? 1 : 2,
          phash: metadata.phash,
          dhash: metadata.dhash,
          file_hash: metadata.file_hash,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (!queueError && queueData) {
        result.queue_id = queueData.id;
        result.processing_status = "pending_vehicle_match";
      }
    }

    // Record device attribution if we have device info
    if (metadata.device_fingerprint) {
      await supabase
        .from("device_attributions")
        .upsert({
          device_fingerprint: metadata.device_fingerprint,
          camera_make: metadata.camera_make,
          camera_model: metadata.camera_model,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          image_count: 1,
        }, {
          onConflict: "device_fingerprint",
          ignoreDuplicates: false,
        });

      // Update image_count
      await supabase.rpc("increment_device_image_count", {
        fingerprint: metadata.device_fingerprint,
      });
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Nuke Box upload error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
