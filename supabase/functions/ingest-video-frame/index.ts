/**
 * INGEST VIDEO FRAME
 *
 * Single-purpose intake for frames extracted from video files (GoPro, dashcam,
 * phone, etc.). Per chapter 12 (docs/library/technical/engineering-manual/
 * 12-bulk-photo-attribution.md): every frame becomes BOTH a vehicle_images
 * row AND an image_observations row, regardless of attribution.
 *
 * Idempotent on content_sha256.
 *
 * Request body:
 * {
 *   content_sha256: string (required),
 *   source: string (e.g. 'gopro_frame'),
 *   image_url: string (publicly resolvable URL OR a placeholder),
 *   storage_path: string (optional — local path until uploaded),
 *   file_bytes: number,
 *
 *   // Frame-specific provenance
 *   source_clip: string (e.g. 'GX010111.MP4'),
 *   frame_offset_s: number,
 *   wall_clock_utc: string (ISO),
 *   resolution: string (e.g. '5312x2988'),
 *   fps: number,
 *
 *   // Optional pre-computed signals
 *   youtube_url: string (if uploaded),
 *   youtube_video_id: string,
 *   inherited_lat: number (from photo-time-match),
 *   inherited_lon: number,
 *   inherited_from: string (e.g. 'iphone-photo-uuid'),
 *   attributed_via: string (e.g. 'temporal-photo','paperwork-session'),
 *
 *   // Optional initial vehicle attribution (manual tag)
 *   vehicle_id: string (UUID),
 *   confidence: number (0-1, defaults 0.3 if vehicle_id null, 0.85 if set)
 * }
 *
 * Response:
 * { ok: true, image_id: UUID, image_observation_id: UUID, idempotent_skip: bool }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isServiceCaller, requireWriteAuth, writeAuthResponse } from "../_shared/writeGuard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface IngestVideoFrameRequest {
  content_sha256: string;
  source: string;
  image_url?: string;
  storage_path?: string;
  file_bytes?: number;
  source_clip?: string;
  frame_offset_s?: number;
  wall_clock_utc?: string;
  resolution?: string;
  fps?: number;
  youtube_url?: string;
  youtube_video_id?: string;
  inherited_lat?: number;
  inherited_lon?: number;
  inherited_from?: string;
  attributed_via?: string;
  vehicle_id?: string;
  confidence?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // The caller is judged before the body is read. This intake acts with the service key, so being signed in
  // is not enough (sign-up is open): only the service key passes. The artifact intake and the frame scripts
  // send it.
  const denied = await requireWriteAuth(req, { headers: corsHeaders });
  if (denied) return denied;
  if (!(await isServiceCaller(req))) {
    return writeAuthResponse({ status: 403, reason: "service key required" }, corsHeaders);
  }

  try {
    const body: IngestVideoFrameRequest = await req.json();

    if (!body.content_sha256) {
      return jsonResponse({ ok: false, error: "content_sha256 required" }, 400);
    }
    if (!body.source) {
      return jsonResponse({ ok: false, error: "source required" }, 400);
    }

    // Idempotency check — vehicle_images.file_hash is the canonical hash field.
    const { data: existing } = await supabase
      .from("vehicle_images")
      .select("id")
      .eq("file_hash", body.content_sha256)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      // Find the matching image_observations row too
      const { data: existingObs } = await supabase
        .from("image_observations")
        .select("id")
        .eq("image_id", existing.id)
        .eq("observed_by", "video-frame-ingest-v1")
        .limit(1)
        .maybeSingle();

      return jsonResponse({
        ok: true,
        idempotent_skip: true,
        image_id: existing.id,
        image_observation_id: existingObs?.id ?? null,
      });
    }

    // Insert vehicle_images row
    const aiScanMetadata: Record<string, unknown> = {
      content_sha256: body.content_sha256,
      ingested_via: "ingest-video-frame",
      source_clip: body.source_clip,
      frame_offset_s: body.frame_offset_s,
      wall_clock_utc: body.wall_clock_utc,
      resolution: body.resolution,
      fps: body.fps,
      youtube_url: body.youtube_url,
      youtube_video_id: body.youtube_video_id,
    };

    const imageInsert: Record<string, unknown> = {
      vehicle_id: body.vehicle_id ?? null,
      image_url: body.image_url ?? `local://${body.content_sha256}`,
      storage_path: body.storage_path ?? null,
      source: body.source,
      file_hash: body.content_sha256,                    // canonical idempotency key
      file_size: body.file_bytes ?? null,
      file_name: body.source_clip
        ? `${body.source_clip.replace(/\.[^.]+$/,'')}_${String(body.frame_offset_s ?? 0).padStart(6,'0')}.jpg`
        : null,
      mime_type: "image/jpeg",
      latitude: body.inherited_lat ?? null,
      longitude: body.inherited_lon ?? null,
      taken_at: body.wall_clock_utc ?? null,
      ai_processing_status: "pending",
      ai_scan_metadata: aiScanMetadata,
    };

    const { data: image, error: imageErr } = await supabase
      .from("vehicle_images")
      .insert(imageInsert)
      .select("id")
      .single();

    if (imageErr || !image) {
      return jsonResponse({
        ok: false,
        error: `vehicle_images insert failed: ${imageErr?.message}`,
      }, 500);
    }

    // Insert image_observations row (chapter 12 foundation)
    // role='subject' for video frames by default — they're a primary depiction
    // of whatever the camera was pointed at.
    const confidence = body.confidence ??
      (body.vehicle_id ? 0.85 : 0.3);

    const confidenceBasis: Record<string, unknown> = {
      source: body.source,
      source_clip: body.source_clip,
      frame_offset_s: body.frame_offset_s,
      wall_clock_utc: body.wall_clock_utc,
      attributed_via: body.attributed_via ?? "video-frame-extract",
    };
    if (body.youtube_video_id) {
      confidenceBasis.youtube_video_id = body.youtube_video_id;
      confidenceBasis.youtube_url = body.youtube_url;
    }
    if (body.inherited_lat != null && body.inherited_lon != null) {
      confidenceBasis.inherited_location = {
        lat: body.inherited_lat,
        lon: body.inherited_lon,
        from: body.inherited_from,
      };
      // Inherited location is a real attribution signal worth ~0.65 (Tier 4
      // per ch.12) when no other vehicle attribution exists.
      if (!body.vehicle_id) {
        confidenceBasis.location_signal = 0.65;
      }
    }

    const { data: obs, error: obsErr } = await supabase
      .from("image_observations")
      .insert({
        image_id: image.id,
        vehicle_id: body.vehicle_id ?? null,
        cluster_id: null,
        role: "subject",
        confidence,
        confidence_basis: confidenceBasis,
        visual_signature: {},
        layer_version: { ingest: "v1" },
        observed_by: "video-frame-ingest-v1",
        agent_version: body.vehicle_id ? "human:manual" : null,
      })
      .select("id")
      .single();

    if (obsErr || !obs) {
      // Don't roll back the vehicle_images row — partial write is recoverable.
      // Return the image_id so caller knows where the row landed.
      console.warn(`[ingest-video-frame] image_observations insert failed: ${obsErr?.message}`);
      return jsonResponse({
        ok: false,
        error: `image_observations insert failed: ${obsErr?.message}`,
        image_id: image.id,
      }, 500);
    }

    return jsonResponse({
      ok: true,
      idempotent_skip: false,
      image_id: image.id,
      image_observation_id: obs.id,
    });
  } catch (e: any) {
    return jsonResponse({ ok: false, error: e.message ?? String(e) }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
