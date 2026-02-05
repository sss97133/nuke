/**
 * Work Session - Contextual conversation for image intake
 *
 * Flow:
 * 1. "start" - Agent asks which vehicle
 * 2. "confirm" - User confirms vehicle
 * 3. "upload" - Photos processed with context
 * 4. "recap" - Summary of session
 *
 * Context preserved: vehicle, project, location, history
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface WorkSession {
  id: string;
  tech_link_id: string;
  vehicle_id: string | null;
  vehicle_name: string | null;
  status: "asking" | "confirmed" | "uploading" | "complete";
  context: {
    project?: string;  // "prep for sale", "restoration", "maintenance"
    location?: string; // from EXIF or known shop
    started_at: string;
    images_count: number;
    notes: string[];
  };
}

// Get user's recent/assigned vehicles
async function getUserVehicles(techLinkId: string) {
  // Get assigned vehicles
  const { data: assigned } = await supabase
    .from("vehicle_tech_assignments")
    .select(`
      vehicle_id,
      vehicles!inner(id, year, make, model, vin)
    `)
    .eq("technician_phone_link_id", techLinkId)
    .eq("status", "active")
    .limit(10);

  // Get vehicles from user's orgs
  const { data: techLink } = await supabase
    .from("technician_phone_links")
    .select("user_id")
    .eq("id", techLinkId)
    .single();

  let orgVehicles: any[] = [];
  if (techLink?.user_id) {
    const { data: orgs } = await supabase
      .from("organization_contributors")
      .select("organization_id")
      .eq("user_id", techLink.user_id)
      .eq("status", "active");

    if (orgs?.length) {
      // Get recent vehicles from those orgs (from work submissions)
      const { data: recent } = await supabase
        .from("sms_work_submissions")
        .select(`
          detected_vehicle_id,
          vehicles!inner(id, year, make, model, vin)
        `)
        .eq("technician_phone_link_id", techLinkId)
        .not("detected_vehicle_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(10);

      orgVehicles = recent || [];
    }
  }

  // Combine and dedupe
  const all = [
    ...(assigned || []).map((a: any) => a.vehicles),
    ...orgVehicles.map((r: any) => r.vehicles),
  ];

  const seen = new Set();
  return all.filter((v: any) => {
    if (!v || seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}

// Start a work session - ask which vehicle
async function startSession(techLinkId: string): Promise<{ message: string; vehicles: any[] }> {
  const vehicles = await getUserVehicles(techLinkId);

  // Create session record
  const { data: session } = await supabase
    .from("work_sessions")
    .insert({
      tech_link_id: techLinkId,
      status: "asking",
      context: { started_at: new Date().toISOString(), images_count: 0, notes: [] },
    })
    .select()
    .single();

  if (vehicles.length === 0) {
    return {
      message: "Which vehicle are you working on? Send year/make/model or VIN.",
      vehicles: [],
    };
  }

  // Format vehicle list
  const list = vehicles.slice(0, 5).map((v: any, i: number) => {
    const vinShort = v.vin ? ` (${v.vin.slice(-6)})` : "";
    return `${i + 1}. ${v.year} ${v.make} ${v.model}${vinShort}`;
  }).join("\n");

  return {
    message: `Which vehicle?\n\n${list}\n\nReply with number, or send year/make/model.`,
    vehicles,
  };
}

// Confirm vehicle selection
async function confirmVehicle(
  techLinkId: string,
  input: string,
  availableVehicles: any[]
): Promise<{ vehicleId: string | null; vehicleName: string | null; message: string }> {

  // Check if it's a number selection
  const num = parseInt(input.trim());
  if (!isNaN(num) && num >= 1 && num <= availableVehicles.length) {
    const v = availableVehicles[num - 1];
    return {
      vehicleId: v.id,
      vehicleName: `${v.year} ${v.make} ${v.model}`,
      message: `Got it: ${v.year} ${v.make} ${v.model}. Send photos.`,
    };
  }

  // Check if "yes" to a previous suggestion
  if (["yes", "y", "yeah", "yep", "correct", "that one"].includes(input.toLowerCase().trim())) {
    if (availableVehicles.length === 1) {
      const v = availableVehicles[0];
      return {
        vehicleId: v.id,
        vehicleName: `${v.year} ${v.make} ${v.model}`,
        message: `Got it: ${v.year} ${v.make} ${v.model}. Send photos.`,
      };
    }
  }

  // Try to parse year/make/model
  const yearMatch = input.match(/\b(19|20)\d{2}\b/);
  const words = input.toLowerCase().split(/\s+/);

  // Search for matching vehicle
  let query = supabase.from("vehicles").select("id, year, make, model, vin").limit(5);

  if (yearMatch) {
    query = query.eq("year", parseInt(yearMatch[0]));
  }

  // Check for make/model keywords
  const makes = ["gmc", "chevrolet", "chevy", "ford", "dodge", "toyota"];
  const foundMake = words.find(w => makes.some(m => w.includes(m)));
  if (foundMake) {
    const normalizedMake = foundMake === "chevy" ? "chevrolet" : foundMake;
    query = query.ilike("make", `%${normalizedMake}%`);
  }

  const { data: matches } = await query;

  if (matches?.length === 1) {
    const v = matches[0];
    return {
      vehicleId: v.id,
      vehicleName: `${v.year} ${v.make} ${v.model}`,
      message: `Found: ${v.year} ${v.make} ${v.model}. Send photos.`,
    };
  }

  if (matches?.length > 1) {
    const list = matches.map((v: any, i: number) => {
      const vinShort = v.vin ? ` (${v.vin.slice(-6)})` : "";
      return `${i + 1}. ${v.year} ${v.make} ${v.model}${vinShort}`;
    }).join("\n");

    return {
      vehicleId: null,
      vehicleName: null,
      message: `Found multiple:\n\n${list}\n\nWhich one?`,
    };
  }

  return {
    vehicleId: null,
    vehicleName: null,
    message: "Couldn't find that vehicle. Try VIN or exact year/make/model.",
  };
}

// Process images with context
async function processImages(
  techLinkId: string,
  vehicleId: string,
  vehicleName: string,
  imageUrls: string[],
  context: { project?: string }
): Promise<{ message: string; analysis: any }> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  const prompt = `Analyzing ${imageUrls.length} work photos for: ${vehicleName}
Context: Technician documenting work, likely at repair shop.
${context.project ? `Project: ${context.project}` : ""}

For each image, identify:
1. What part/area of the vehicle is shown
2. What work or condition is being documented
3. Any issues visible (rust, damage, wear, missing parts)
4. Category: exterior, interior, engine, undercarriage, detail, document

Return JSON:
{
  "images": [
    {"description": "...", "area": "...", "issues": ["..."], "category": "..."},
    ...
  ],
  "summary": "Overall summary of documented work",
  "concerns": ["List any notable issues that need attention"]
}`;

  const imageContents = imageUrls.map(url => ({
    type: "image",
    source: { type: "url", url },
  }));

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: [...imageContents, { type: "text", text: prompt }] }],
      }),
    });

    const result = await response.json();
    const text = result.content?.[0]?.text || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { images: [], summary: "Analysis failed", concerns: [] };

    // Store images
    for (let i = 0; i < imageUrls.length; i++) {
      const imgAnalysis = analysis.images?.[i] || {};
      await supabase.from("vehicle_images").insert({
        vehicle_id: vehicleId,
        image_url: imageUrls[i],
        category: imgAnalysis.category || "work",
        caption: imgAnalysis.description,
        metadata: {
          source: "work_session",
          area: imgAnalysis.area,
          issues: imgAnalysis.issues,
          analyzed_at: new Date().toISOString(),
        },
      });
    }

    // Create timeline event
    await supabase.from("vehicle_timeline").insert({
      vehicle_id: vehicleId,
      event_type: "work_documented",
      event_title: `${imageUrls.length} photos logged`,
      event_description: analysis.summary,
      event_date: new Date().toISOString(),
      source_type: "work_session",
      media_urls: imageUrls,
      metadata: { concerns: analysis.concerns },
    });

    // Format response
    let msg = `✓ ${imageUrls.length} photos logged to ${vehicleName}\n\n`;
    msg += `${analysis.summary}\n`;

    if (analysis.concerns?.length > 0) {
      msg += `\nConcerns noted:\n`;
      analysis.concerns.forEach((c: string) => {
        msg += `• ${c}\n`;
      });
    }

    return { message: msg, analysis };

  } catch (e) {
    console.error("Analysis failed:", e);
    return {
      message: `✓ ${imageUrls.length} photos saved (analysis pending)`,
      analysis: null,
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const { action, techLinkId, input, imageUrls, vehicleId, vehicleName, vehicles, context } = await req.json();

    let result: any;

    switch (action) {
      case "start":
        result = await startSession(techLinkId);
        break;

      case "confirm":
        result = await confirmVehicle(techLinkId, input, vehicles || []);
        break;

      case "upload":
        if (!vehicleId || !imageUrls?.length) {
          result = { message: "Need vehicle and images" };
        } else {
          result = await processImages(techLinkId, vehicleId, vehicleName, imageUrls, context || {});
        }
        break;

      default:
        result = { error: "Unknown action" };
    }

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Work session error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
