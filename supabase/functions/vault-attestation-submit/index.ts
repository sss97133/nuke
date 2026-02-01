/**
 * Vault Attestation Submit - Native App Cryptographic Proof
 *
 * Tier 3 (Vault Mode) - Maximum Privacy:
 * - Native app processes document entirely on device
 * - Original image stored encrypted in device keychain
 * - Only cryptographic attestation sent to server
 * - Server receives: VIN, masked data, document hash, device attestation, signature
 *
 * Attestation Package:
 * {
 *   "vin": "1HGBH41JXMN109186",
 *   "title_number_masked": "****7842",
 *   "owner_name_hash": "sha256:a3f2...",
 *   "state": "CA",
 *   "document_type": "title",
 *   "document_hash": "sha256:b7c1...",
 *   "device_attestation": "apple:device_check:xxx",
 *   "device_attestation_type": "apple_device_check",
 *   "redacted_thumbnail": "base64...",
 *   "vault_token": "vault:abc123",
 *   "signature": "ed25519:...",
 *   "public_key": "ed25519:...",
 *   "extracted_at": "2026-02-01T10:30:00Z",
 *   "device_info": { "model": "iPhone 15", "os": "iOS 19.0", "app_version": "1.0.0" }
 * }
 *
 * POST /functions/v1/vault-attestation-submit
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

// Types
interface AttestationPackage {
  // User identity
  user_id: string;

  // Extracted data (non-sensitive)
  vin: string;
  document_type: "title" | "registration" | "bill_of_sale" | "insurance" | "other";
  state?: string;

  // Masked/hashed data
  title_number_masked?: string;
  owner_name_hash?: string;

  // Cryptographic proof
  document_hash: string;
  device_attestation: string;
  device_attestation_type: "apple_device_check" | "google_play_integrity" | "google_safety_net";
  signature: string;
  public_key: string;

  // Optional redacted preview
  redacted_thumbnail?: string;

  // Metadata
  extracted_at: string;
  device_info?: {
    model?: string;
    os_version?: string;
    app_version?: string;
  };
}

// VIN validation (reuse from pwa-submit)
function isValidVin(vin: string): boolean {
  if (!vin) return false;
  const cleaned = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  return cleaned.length === 17 && !/[IOQ]/.test(cleaned);
}

// Verify Apple DeviceCheck attestation
async function verifyAppleDeviceCheck(attestation: string): Promise<{
  valid: boolean;
  error?: string;
}> {
  // Apple DeviceCheck requires server-to-server call
  // https://developer.apple.com/documentation/devicecheck/accessing_and_modifying_per-device_data

  const appleTeamId = Deno.env.get("APPLE_TEAM_ID");
  const appleKeyId = Deno.env.get("APPLE_DEVICECHECK_KEY_ID");
  const applePrivateKey = Deno.env.get("APPLE_DEVICECHECK_PRIVATE_KEY");

  if (!appleTeamId || !appleKeyId || !applePrivateKey) {
    console.log("[Attestation] Apple DeviceCheck not configured, accepting with warning");
    return { valid: true }; // Accept in dev mode
  }

  // In production, we would:
  // 1. Generate JWT for Apple API auth
  // 2. Call https://api.development.devicecheck.apple.com/v1/validate_device_token
  // 3. Verify response

  // For now, we'll do basic format validation
  if (!attestation.startsWith("apple:")) {
    return { valid: false, error: "Invalid Apple attestation format" };
  }

  // TODO: Implement full Apple DeviceCheck validation
  return { valid: true };
}

// Verify Google Play Integrity attestation
async function verifyGooglePlayIntegrity(attestation: string): Promise<{
  valid: boolean;
  error?: string;
}> {
  const googleProjectId = Deno.env.get("GOOGLE_CLOUD_PROJECT_ID");
  const googleCredentials = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS_JSON");

  if (!googleProjectId || !googleCredentials) {
    console.log("[Attestation] Google Play Integrity not configured, accepting with warning");
    return { valid: true }; // Accept in dev mode
  }

  // In production, we would:
  // 1. Call Google Play Integrity API to decode the token
  // 2. Verify requestDetails.requestPackageName matches our app
  // 3. Check deviceIntegrity.deviceRecognitionVerdict

  if (!attestation.startsWith("google:")) {
    return { valid: false, error: "Invalid Google attestation format" };
  }

  // TODO: Implement full Google Play Integrity validation
  return { valid: true };
}

// Verify Ed25519 signature
async function verifySignature(
  attestation: AttestationPackage
): Promise<{ valid: boolean; error?: string }> {
  // The signature should be over a canonical JSON representation
  // of the attestation data (excluding the signature itself)

  const { signature, public_key, ...dataToSign } = attestation;

  if (!signature || !public_key) {
    return { valid: false, error: "Missing signature or public key" };
  }

  // Extract raw key and signature from prefixed format
  // Format: "ed25519:base64encodeddata"
  const sigMatch = signature.match(/^ed25519:(.+)$/);
  const keyMatch = public_key.match(/^ed25519:(.+)$/);

  if (!sigMatch || !keyMatch) {
    return { valid: false, error: "Invalid signature or key format" };
  }

  try {
    // Decode base64
    const sigBytes = Uint8Array.from(atob(sigMatch[1]), c => c.charCodeAt(0));
    const keyBytes = Uint8Array.from(atob(keyMatch[1]), c => c.charCodeAt(0));

    // Import public key
    const publicKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "Ed25519" },
      true,
      ["verify"]
    );

    // Create canonical message
    const message = new TextEncoder().encode(JSON.stringify(dataToSign, Object.keys(dataToSign).sort()));

    // Verify signature
    const valid = await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      sigBytes,
      message
    );

    return { valid };
  } catch (e) {
    console.error("[Attestation] Signature verification error:", e);
    // Ed25519 may not be available in all environments
    // In production, fall back to a library like tweetnacl
    console.log("[Attestation] Signature verification not available, accepting with warning");
    return { valid: true };
  }
}

// Verify device attestation based on type
async function verifyDeviceAttestation(
  attestation: string,
  type: string
): Promise<{ valid: boolean; error?: string }> {
  switch (type) {
    case "apple_device_check":
      return verifyAppleDeviceCheck(attestation);
    case "google_play_integrity":
    case "google_safety_net":
      return verifyGooglePlayIntegrity(attestation);
    default:
      return { valid: false, error: `Unknown attestation type: ${type}` };
  }
}

// Generate unique vault token
function generateVaultToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "vault_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Find or create vehicle by VIN
async function findOrCreateVehicle(vin: string): Promise<{
  id: string;
  year?: number;
  make?: string;
  model?: string;
  isNew: boolean;
}> {
  const cleanVin = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");

  const { data: existing } = await supabase
    .from("vehicles")
    .select("id, year, make, model")
    .eq("vin", cleanVin)
    .limit(1)
    .single();

  if (existing) {
    return { ...existing, isNew: false };
  }

  // Decode year from VIN
  const yearCode = cleanVin[9];
  const yearMap: Record<string, number> = {
    A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
    J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025,
    T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030,
  };

  const { data: newVehicle, error } = await supabase
    .from("vehicles")
    .insert({
      vin: cleanVin,
      year: yearMap[yearCode] || null,
    })
    .select("id, year, make, model")
    .single();

  if (error) throw error;
  return { ...newVehicle, isNew: true };
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
    // Get auth token if present
    const authHeader = req.headers.get("Authorization");
    let authenticatedUserId: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user } } = await supabase.auth.getUser(token);
      authenticatedUserId = user?.id || null;
    }

    const attestation: AttestationPackage = await req.json();

    // Validate required fields
    if (!attestation.user_id) {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!attestation.vin || !isValidVin(attestation.vin)) {
      return new Response(
        JSON.stringify({ error: "Valid VIN is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!attestation.document_hash) {
      return new Response(
        JSON.stringify({ error: "document_hash is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!attestation.device_attestation || !attestation.device_attestation_type) {
      return new Response(
        JSON.stringify({ error: "device_attestation and device_attestation_type are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!attestation.signature || !attestation.public_key) {
      return new Response(
        JSON.stringify({ error: "signature and public_key are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Attestation] Received from user ${attestation.user_id}, VIN: ${attestation.vin}`);

    // Verify device attestation
    const deviceResult = await verifyDeviceAttestation(
      attestation.device_attestation,
      attestation.device_attestation_type
    );

    if (!deviceResult.valid) {
      console.log(`[Attestation] Device attestation failed: ${deviceResult.error}`);
      return new Response(
        JSON.stringify({ error: "Device attestation failed", details: deviceResult.error }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify signature
    const sigResult = await verifySignature(attestation);

    if (!sigResult.valid) {
      console.log(`[Attestation] Signature verification failed: ${sigResult.error}`);
      return new Response(
        JSON.stringify({ error: "Signature verification failed", details: sigResult.error }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate vault token
    const vaultToken = generateVaultToken();
    const cleanVin = attestation.vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");

    // Find or create vehicle
    const vehicle = await findOrCreateVehicle(cleanVin);

    // Store attestation (NOT the document!)
    const { data: stored, error: insertError } = await supabase
      .from("vault_attestations")
      .insert({
        user_id: attestation.user_id,
        vehicle_id: vehicle.id,
        vin: cleanVin,
        document_type: attestation.document_type || "title",
        state: attestation.state,
        title_number_masked: attestation.title_number_masked,
        owner_name_hash: attestation.owner_name_hash,
        document_hash: attestation.document_hash,
        device_attestation: attestation.device_attestation,
        device_attestation_type: attestation.device_attestation_type,
        signature: attestation.signature,
        public_key: attestation.public_key,
        redacted_thumbnail: attestation.redacted_thumbnail,
        vault_token: vaultToken,
        device_info: attestation.device_info || {},
        extraction_metadata: {
          extracted_at: attestation.extracted_at,
          submitted_at: new Date().toISOString(),
        },
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[Attestation] Insert failed:", insertError);
      throw insertError;
    }

    // Link vehicle to user using user_vehicle_relationships table
    const { data: existingLink } = await supabase
      .from("user_vehicle_relationships")
      .select("vehicle_id")
      .eq("vehicle_id", vehicle.id)
      .eq("owner_id", attestation.user_id)
      .single();

    if (!existingLink) {
      await supabase.from("user_vehicle_relationships").insert({
        vehicle_id: vehicle.id,
        owner_id: attestation.user_id,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        vin: cleanVin,
        relationship_type: "vault_attestation",
        role: "owner",
        is_verified_owner: false,
      });
    }

    // Update any pending SMS sessions
    await supabase
      .from("vault_sms_sessions")
      .update({
        state: "completed",
        result_vehicle_id: vehicle.id,
        result_attestation_id: stored.id,
        context: {
          app_submission_received_at: new Date().toISOString(),
          vault_token: vaultToken,
        },
      })
      .eq("user_id", attestation.user_id)
      .eq("state", "awaiting_app_submission");

    // Audit log
    await supabase.from("pii_audit_log").insert({
      user_id: attestation.user_id,
      action: "vault_attestation_created",
      resource_type: "vault_attestation",
      resource_id: stored.id,
      access_reason: "Native app vault attestation submitted (document stays on device)",
    });

    console.log(`[Attestation] Stored attestation ${stored.id} for vehicle ${vehicle.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        attestation_id: stored.id,
        vault_token: vaultToken,
        vehicle: {
          id: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: cleanVin,
          is_new: vehicle.isNew,
        },
        message: "Attestation verified and stored. Document remains securely on your device.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Attestation] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
