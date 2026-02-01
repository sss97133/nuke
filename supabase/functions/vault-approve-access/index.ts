/**
 * Vault Approve Access - User approves/denies access request
 *
 * When user receives access request notification:
 * 1. Opens Nuke Vault app
 * 2. Reviews request details
 * 3. Approves (with duration) or denies
 * 4. If approved, uploads document temporarily for signed URL
 *
 * POST /functions/v1/vault-approve-access
 *
 * Actions:
 * - approve: Grant temporary access with signed URL
 * - deny: Reject the request with optional reason
 * - upload: Upload document for approved request (generates signed URL)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Constants
const DEFAULT_ACCESS_HOURS = 24;
const MAX_ACCESS_HOURS = 168; // 1 week
const STORAGE_BUCKET = "vault-temp-access";

// Types
interface ApproveInput {
  request_id: string;
  action: "approve" | "deny" | "upload";
  duration_hours?: number; // For approve
  denial_reason?: string; // For deny
  document_data?: string; // For upload - base64 encoded
  document_mime?: string; // For upload - e.g., "image/jpeg"
}

// Get request with ownership check
async function getRequestIfOwner(
  requestId: string,
  userId: string
): Promise<{
  request: {
    id: string;
    attestation_id: string;
    status: string;
    requested_by: string;
    request_reason: string;
    approved_duration_hours: number | null;
    url_expires_at: string | null;
  };
  attestation: {
    id: string;
    user_id: string;
    vin: string;
    document_type: string;
    vault_token: string;
  };
} | null> {
  // Get request
  const { data: request, error } = await supabase
    .from("vault_access_requests")
    .select("id, attestation_id, status, requested_by, request_reason, approved_duration_hours, url_expires_at")
    .eq("id", requestId)
    .single();

  if (error || !request) return null;

  // Get attestation
  const { data: attestation } = await supabase
    .from("vault_attestations")
    .select("id, user_id, vin, document_type, vault_token")
    .eq("id", request.attestation_id)
    .single();

  if (!attestation) return null;

  // Check ownership
  if (attestation.user_id !== userId) {
    return null;
  }

  return { request, attestation };
}

// Generate signed URL for temporary document access
async function generateSignedUrl(
  storagePath: string,
  expiresInSeconds: number
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    console.error("[Signed URL] Error:", error);
    return null;
  }

  return data.signedUrl;
}

// Upload document to temporary storage
async function uploadTempDocument(
  requestId: string,
  userId: string,
  documentData: string, // base64
  mimeType: string
): Promise<{ path: string; error?: string }> {
  // Decode base64
  const binaryStr = atob(documentData);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  // Generate unique path
  const timestamp = Date.now();
  const extension = mimeType.split("/")[1] || "bin";
  const path = `${userId}/${requestId}/${timestamp}.${extension}`;

  // Upload
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, bytes, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    console.error("[Upload] Error:", error);
    return { path: "", error: error.message };
  }

  return { path };
}

// Send notification to requester
async function notifyRequester(
  requesterId: string,
  attestationVin: string,
  action: "approved" | "denied",
  signedUrl?: string
): Promise<void> {
  // Get requester's email/phone for notification
  const { data: requester } = await supabase
    .from("profiles")
    .select("email, phone_number")
    .eq("id", requesterId)
    .single();

  if (!requester) return;

  // For now, just log. In production, send email/SMS/push
  console.log(`[Notify] Request ${action} for VIN ${attestationVin}. Requester: ${requester.email}`);

  // TODO: Send actual notification
  // - Email via SendGrid/SES
  // - SMS via Twilio
  // - In-app notification via push
}

// Main handler
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Authenticate request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.slice(7);
    const { data: { user: authUser } } = await supabase.auth.getUser(token);

    if (!authUser) {
      return new Response(
        JSON.stringify({ error: "Invalid authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request
    const input: ApproveInput = await req.json();

    if (!input.request_id) {
      return new Response(
        JSON.stringify({ error: "request_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["approve", "deny", "upload"].includes(input.action)) {
      return new Response(
        JSON.stringify({ error: "action must be 'approve', 'deny', or 'upload'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get request and verify ownership
    const data = await getRequestIfOwner(input.request_id, authUser.id);
    if (!data) {
      return new Response(
        JSON.stringify({ error: "Request not found or you don't own this document" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { request, attestation } = data;

    // Get client IP and user agent for audit
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0] ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";

    // Handle different actions
    switch (input.action) {
      case "approve": {
        if (request.status !== "pending") {
          return new Response(
            JSON.stringify({ error: "Request is not pending", current_status: request.status }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const durationHours = Math.min(
          input.duration_hours || DEFAULT_ACCESS_HOURS,
          MAX_ACCESS_HOURS
        );

        // Update request status
        const { error: updateError } = await supabase
          .from("vault_access_requests")
          .update({
            status: "approved",
            approved_at: new Date().toISOString(),
            responded_at: new Date().toISOString(),
            approved_duration_hours: durationHours,
            url_expires_at: new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString(),
            response_ip: clientIp,
            response_user_agent: userAgent,
          })
          .eq("id", request.id);

        if (updateError) throw updateError;

        // Audit log
        await supabase.from("pii_audit_log").insert({
          user_id: authUser.id,
          accessed_by: request.requested_by,
          action: "vault_access_approved",
          resource_type: "vault_access_request",
          resource_id: request.id,
          ip_address: clientIp,
          user_agent: userAgent,
          access_reason: `Approved access for ${durationHours} hours`,
        });

        // Notify requester
        await notifyRequester(request.requested_by, attestation.vin, "approved");

        return new Response(
          JSON.stringify({
            success: true,
            action: "approved",
            request_id: request.id,
            duration_hours: durationHours,
            expires_at: new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString(),
            next_step: "Upload the document using action='upload' to generate the signed URL",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "deny": {
        if (request.status !== "pending") {
          return new Response(
            JSON.stringify({ error: "Request is not pending", current_status: request.status }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update request status
        const { error: updateError } = await supabase
          .from("vault_access_requests")
          .update({
            status: "denied",
            denied_at: new Date().toISOString(),
            responded_at: new Date().toISOString(),
            denial_reason: input.denial_reason || null,
            response_ip: clientIp,
            response_user_agent: userAgent,
          })
          .eq("id", request.id);

        if (updateError) throw updateError;

        // Audit log
        await supabase.from("pii_audit_log").insert({
          user_id: authUser.id,
          accessed_by: request.requested_by,
          action: "vault_access_denied",
          resource_type: "vault_access_request",
          resource_id: request.id,
          ip_address: clientIp,
          user_agent: userAgent,
          access_reason: input.denial_reason || "User denied access request",
        });

        // Notify requester
        await notifyRequester(request.requested_by, attestation.vin, "denied");

        return new Response(
          JSON.stringify({
            success: true,
            action: "denied",
            request_id: request.id,
            denial_reason: input.denial_reason,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "upload": {
        if (request.status !== "approved") {
          return new Response(
            JSON.stringify({
              error: "Request must be approved before uploading",
              current_status: request.status,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!input.document_data || !input.document_mime) {
          return new Response(
            JSON.stringify({ error: "document_data and document_mime are required for upload" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check if URL already expired
        if (request.url_expires_at && new Date(request.url_expires_at) < new Date()) {
          return new Response(
            JSON.stringify({ error: "Access window has expired" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Upload document
        const { path, error: uploadError } = await uploadTempDocument(
          request.id,
          authUser.id,
          input.document_data,
          input.document_mime
        );

        if (uploadError) {
          return new Response(
            JSON.stringify({ error: "Failed to upload document", details: uploadError }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Calculate remaining time for signed URL
        const expiresAt = new Date(request.url_expires_at!);
        const remainingSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

        if (remainingSeconds <= 0) {
          return new Response(
            JSON.stringify({ error: "Access window has expired" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Generate signed URL
        const signedUrl = await generateSignedUrl(path, remainingSeconds);

        if (!signedUrl) {
          return new Response(
            JSON.stringify({ error: "Failed to generate signed URL" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update request with URL
        await supabase
          .from("vault_access_requests")
          .update({ temporary_url: signedUrl })
          .eq("id", request.id);

        // Audit log
        await supabase.from("pii_audit_log").insert({
          user_id: authUser.id,
          accessed_by: request.requested_by,
          action: "vault_document_uploaded",
          resource_type: "vault_access_request",
          resource_id: request.id,
          ip_address: clientIp,
          user_agent: userAgent,
          access_reason: "Document uploaded for approved access request",
        });

        // Log signed URL generation
        await supabase.from("pii_audit_log").insert({
          user_id: request.requested_by,
          accessed_by: request.requested_by,
          action: "vault_signed_url_generated",
          resource_type: "vault_access_request",
          resource_id: request.id,
          access_reason: `Signed URL generated, expires in ${Math.floor(remainingSeconds / 60)} minutes`,
        });

        return new Response(
          JSON.stringify({
            success: true,
            action: "uploaded",
            request_id: request.id,
            signed_url: signedUrl,
            expires_at: request.url_expires_at,
            message: "Document uploaded and signed URL generated",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
  } catch (error) {
    console.error("[Approve Access] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
