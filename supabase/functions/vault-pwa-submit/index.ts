/**
 * Vault PWA Submit - Receive extracted text from on-device processing
 *
 * Tier 2 (Private Mode):
 * - PWA runs OCR on device using TensorFlow.js + Tesseract.js
 * - Only extracted text is sent (VIN, owner name, etc.)
 * - Original image never leaves user's device
 *
 * POST /functions/v1/vault-pwa-submit
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

// VIN validation (basic format check)
function isValidVin(vin: string): { valid: boolean; error?: string } {
  if (!vin) return { valid: false, error: "VIN is required" };

  // Clean VIN
  const cleaned = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");

  // Length check
  if (cleaned.length !== 17) {
    return { valid: false, error: `VIN must be 17 characters (got ${cleaned.length})` };
  }

  // Invalid characters check (no I, O, Q)
  if (/[IOQ]/.test(cleaned)) {
    return { valid: false, error: "VIN cannot contain I, O, or Q" };
  }

  // Check digit validation (position 9)
  const transliteration: Record<string, number> = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
    "0": 0, "1": 1, "2": 2, "3": 3, "4": 4,
    "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  };

  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const char = cleaned[i];
    const value = transliteration[char];
    if (value === undefined) {
      return { valid: false, error: `Invalid character at position ${i + 1}` };
    }
    sum += value * weights[i];
  }

  const checkDigit = sum % 11;
  const expectedCheck = checkDigit === 10 ? "X" : String(checkDigit);
  const actualCheck = cleaned[8];

  if (actualCheck !== expectedCheck) {
    // Some older VINs may not strictly follow check digit rules
    console.log(`[VIN] Check digit mismatch: expected ${expectedCheck}, got ${actualCheck}`);
    // We'll still accept it but log the warning
  }

  return { valid: true };
}

// Decode VIN to get basic vehicle info
function decodeVinBasic(vin: string): {
  year: number | null;
  manufacturer: string | null;
  country: string | null;
} {
  const cleaned = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (cleaned.length !== 17) return { year: null, manufacturer: null, country: null };

  // Year from position 10
  const yearCode = cleaned[9];
  const yearMap: Record<string, number> = {
    A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
    J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025,
    T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030,
    "1": 2001, "2": 2002, "3": 2003, "4": 2004, "5": 2005,
    "6": 2006, "7": 2007, "8": 2008, "9": 2009,
  };

  // Country from position 1
  const countryCode = cleaned[0];
  const countryMap: Record<string, string> = {
    "1": "USA", "4": "USA", "5": "USA",
    "2": "Canada",
    "3": "Mexico",
    J: "Japan",
    K: "Korea",
    S: "UK",
    W: "Germany",
    Z: "Italy",
    V: "France/Spain",
    Y: "Sweden/Finland",
  };

  return {
    year: yearMap[yearCode] || null,
    manufacturer: null, // Would need full WMI database
    country: countryMap[countryCode] || null,
  };
}

// Find or create vehicle by VIN
async function findOrCreateVehicle(
  vin: string,
  extractedData: {
    state?: string;
    owner_name?: string;
    title_number?: string;
    document_type?: string;
  }
): Promise<{ id: string; year?: number; make?: string; model?: string; isNew: boolean }> {
  const cleanVin = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");

  // Check for existing vehicle
  const { data: existing } = await supabase
    .from("vehicles")
    .select("id, year, make, model")
    .eq("vin", cleanVin)
    .limit(1)
    .single();

  if (existing) {
    return { ...existing, isNew: false };
  }

  // Create new vehicle with basic decoded info
  const decoded = decodeVinBasic(cleanVin);

  const { data: newVehicle, error } = await supabase
    .from("vehicles")
    .insert({
      vin: cleanVin,
      year: decoded.year,
    })
    .select("id, year, make, model")
    .single();

  if (error) {
    console.error("Failed to create vehicle:", error);
    throw error;
  }

  return { ...newVehicle, isNew: true };
}

// Link vehicle to user
async function linkVehicleToUser(
  vehicleId: string,
  userId: string,
  vehicleData: { year?: number; make?: string; model?: string; vin?: string },
  role: string = "owner"
): Promise<void> {
  // Check for existing link
  const { data: existing } = await supabase
    .from("user_vehicle_relationships")
    .select("vehicle_id")
    .eq("vehicle_id", vehicleId)
    .eq("owner_id", userId)
    .single();

  if (existing) return;

  // Create link using user_vehicle_relationships table
  await supabase.from("user_vehicle_relationships").insert({
    vehicle_id: vehicleId,
    owner_id: userId,
    year: vehicleData.year,
    make: vehicleData.make,
    model: vehicleData.model,
    vin: vehicleData.vin,
    relationship_type: "vault_submission",
    role,
    is_verified_owner: false,
  });
}

// Send SMS confirmation
async function sendSmsConfirmation(
  phoneNumber: string,
  vehicle: { year?: number; make?: string; model?: string },
  vin: string
): Promise<void> {
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!twilioSid || !twilioAuth || !twilioFrom) {
    console.log("[PWA Submit] Twilio not configured, skipping SMS");
    return;
  }

  const vehicleDesc = vehicle.year && vehicle.make && vehicle.model
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
    : "Vehicle";

  const message = `${vehicleDesc} verified!\n\nVIN: ${vin}\n\nDocument processed privately - your image never left your device.`;

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`,
          From: twilioFrom,
          Body: message,
        }),
      }
    );

    if (!response.ok) {
      console.error("[PWA Submit] SMS send failed:", await response.text());
    }
  } catch (e) {
    console.error("[PWA Submit] SMS error:", e);
  }
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
    const body = await req.json();

    // Validate required fields
    const { session_token, extracted } = body as {
      session_token: string;
      extracted: {
        vin?: string;
        owner_name?: string;
        title_number?: string;
        state?: string;
        document_type?: string;
        issue_date?: string;
        odometer?: number;
        raw_text?: string;
        confidence?: number;
        extraction_time_ms?: number;
      };
    };

    if (!session_token) {
      return new Response(
        JSON.stringify({ error: "session_token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!extracted || !extracted.vin) {
      return new Response(
        JSON.stringify({ error: "extracted.vin is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[PWA Submit] Token: ${session_token.slice(0, 10)}..., VIN: ${extracted.vin}`);

    // Validate session
    const { data: session, error: sessionError } = await supabase
      .from("vault_sms_sessions")
      .select("*")
      .eq("pwa_session_token", session_token)
      .single();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check session state
    if (session.state !== "awaiting_pwa_completion") {
      return new Response(
        JSON.stringify({
          error: "Invalid session state",
          current_state: session.state,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate VIN format
    const vinValidation = isValidVin(extracted.vin);
    if (!vinValidation.valid) {
      return new Response(
        JSON.stringify({ error: vinValidation.error, field: "vin" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean VIN
    const cleanVin = extracted.vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");

    // Find or create vehicle
    const vehicle = await findOrCreateVehicle(cleanVin, extracted);

    // Link to user if known
    if (session.user_id) {
      await linkVehicleToUser(vehicle.id, session.user_id, {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        vin: cleanVin,
      });
    }

    // Store title document info (but not the image!)
    if (extracted.document_type === "title" || !extracted.document_type) {
      const { error: titleError } = await supabase.from("vehicle_title_documents").insert({
        vehicle_id: vehicle.id,
        vin: cleanVin,
        state: extracted.state,
        title_number: extracted.title_number,
        owner_name: extracted.owner_name,
        issue_date: extracted.issue_date,
        odometer_reading: extracted.odometer,
        extraction_confidence: extracted.confidence,
        extracted_data: {
          raw_text: extracted.raw_text,
          extraction_time_ms: extracted.extraction_time_ms,
          pwa_session_id: session.id,
          source: "vault_pwa",
          privacy_tier: "private",
          user_id: session.user_id,
        },
      });

      if (titleError) {
        console.error("[PWA Submit] Failed to insert title document:", titleError);
        // Continue anyway - vehicle was created successfully
      }
    }

    // Update session as completed
    await supabase
      .from("vault_sms_sessions")
      .update({
        state: "completed",
        result_vehicle_id: vehicle.id,
        context: {
          ...session.context,
          pwa_completed_at: new Date().toISOString(),
          extracted_vin: cleanVin,
          extraction_confidence: extracted.confidence,
        },
      })
      .eq("id", session.id);

    // Log to audit
    if (session.user_id) {
      await supabase.from("pii_audit_log").insert({
        user_id: session.user_id,
        action: "vault_pwa_submission",
        resource_type: "vehicle",
        resource_id: vehicle.id,
        access_reason: "PWA on-device extraction submitted (image never sent)",
      });
    }

    // Send SMS confirmation
    if (session.phone_number) {
      await sendSmsConfirmation(session.phone_number, vehicle, cleanVin);
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle: {
          id: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: cleanVin,
          is_new: vehicle.isNew,
        },
        message: "Document processed successfully",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[PWA Submit] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
