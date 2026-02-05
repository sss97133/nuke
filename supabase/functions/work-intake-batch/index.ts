/**
 * Work Intake Batch - Multi-photo submission with vehicle grouping
 *
 * Handles batch photo submissions from technicians via SMS or Telegram.
 * AI analyzes all photos, groups by vehicle, each vehicle "claims" its photos.
 *
 * POST /functions/v1/work-intake-batch
 * Body: { techLinkId, mediaUrls[], messageBody?, source: "sms"|"telegram" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface VehicleGroup {
  vehicleHints: {
    year?: number;
    make?: string;
    model?: string;
    color?: string;
    vin?: string;
  };
  photoIndices: number[];
  workType: string;
  description: string;
  confidence: number;
}

interface BatchAnalysis {
  vehicleGroups: VehicleGroup[];
  unmatched: number[];
  totalPhotos: number;
}

// Analyze batch of photos, group by vehicle
async function analyzeBatch(
  mediaUrls: string[],
  messageBody: string,
  context: {
    techName?: string;
    assignedVehicles?: any[];
    affiliatedOrgs?: any[];
  }
): Promise<BatchAnalysis> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  // Build context about assigned vehicles and orgs
  const vehicleContext = context.assignedVehicles?.length
    ? `Technician's assigned vehicles:\n${context.assignedVehicles.map((v, i) =>
        `${i + 1}. ${v.year} ${v.make} ${v.model} (${v.org_name || 'unknown org'})`
      ).join('\n')}`
    : '';

  const orgContext = context.affiliatedOrgs?.length
    ? `Technician works for: ${context.affiliatedOrgs.map(o => o.business_name).join(', ')}`
    : '';

  const prompt = `You are analyzing ${mediaUrls.length} work photos from automotive technician "${context.techName || 'unknown'}".

${orgContext}
${vehicleContext}

Message from tech: "${messageBody || '(no text)'}"

TASK: Group these photos by which vehicle they belong to. Photos of the same vehicle should be grouped together.

For each group, identify:
1. Vehicle (year, make, model, color, VIN if visible)
2. Which photo indices belong to this vehicle (0-indexed)
3. Work type (body_work, paint, mechanical, interior, electrical, suspension, engine, detailing, other)
4. Brief description of work shown
5. Confidence (0-1)

Return JSON:
{
  "vehicleGroups": [
    {
      "vehicleHints": {"year": 2019, "make": "Ford", "model": "F-150", "color": "white"},
      "photoIndices": [0, 2, 4],
      "workType": "body_work",
      "description": "Rust repair on rocker panels",
      "confidence": 0.9
    },
    {
      "vehicleHints": {"year": 1967, "make": "Chevrolet", "model": "Camaro", "color": "red"},
      "photoIndices": [1, 3],
      "workType": "paint",
      "description": "Primer coat applied",
      "confidence": 0.85
    }
  ],
  "unmatched": [5],
  "totalPhotos": ${mediaUrls.length}
}

If a photo can't be matched to a vehicle, add its index to "unmatched".`;

  const imageContents = mediaUrls.map((url) => ({
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
        messages: [
          {
            role: "user",
            content: [...imageContents, { type: "text", text: prompt }],
          },
        ],
      }),
    });

    const result = await response.json();
    const text = result.content?.[0]?.text || "{}";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Batch analysis failed:", e);
  }

  // Fallback - treat all as one unknown vehicle
  return {
    vehicleGroups: [],
    unmatched: mediaUrls.map((_, i) => i),
    totalPhotos: mediaUrls.length,
  };
}

// Match vehicle hints to existing vehicle, considering org affiliation
async function matchVehicleWithOrg(
  hints: { year?: number; make?: string; model?: string; vin?: string },
  orgIds: string[]
): Promise<{ vehicleId: string | null; orgId: string | null; vehicleName: string | null }> {
  if (!hints.year && !hints.make && !hints.model && !hints.vin) {
    return { vehicleId: null, orgId: null, vehicleName: null };
  }

  // Try VIN first (exact match)
  if (hints.vin) {
    const { data: vinMatch } = await supabase
      .from("vehicles")
      .select("id, year, make, model, owner_org_id")
      .eq("vin", hints.vin)
      .single();

    if (vinMatch) {
      return {
        vehicleId: vinMatch.id,
        orgId: vinMatch.owner_org_id,
        vehicleName: `${vinMatch.year} ${vinMatch.make} ${vinMatch.model}`,
      };
    }
  }

  // Try year/make/model with org preference
  let query = supabase
    .from("vehicles")
    .select("id, year, make, model, owner_org_id")
    .limit(10);

  if (hints.year) query = query.eq("year", hints.year);
  if (hints.make) query = query.ilike("make", `%${hints.make}%`);
  if (hints.model) query = query.ilike("model", `%${hints.model}%`);

  const { data: matches } = await query;

  if (!matches?.length) return { vehicleId: null, orgId: null, vehicleName: null };

  // Prefer vehicles owned by tech's affiliated orgs
  const orgMatch = matches.find(v => orgIds.includes(v.owner_org_id));
  if (orgMatch) {
    return {
      vehicleId: orgMatch.id,
      orgId: orgMatch.owner_org_id,
      vehicleName: `${orgMatch.year} ${orgMatch.make} ${orgMatch.model}`,
    };
  }

  // Otherwise take first match
  const first = matches[0];
  return {
    vehicleId: first.id,
    orgId: first.owner_org_id,
    vehicleName: `${first.year} ${first.make} ${first.model}`,
  };
}

// Get org name by ID
async function getOrgName(orgId: string): Promise<string> {
  const { data } = await supabase
    .from("businesses")
    .select("business_name")
    .eq("id", orgId)
    .single();
  return data?.business_name || "unknown";
}

// Get vehicle agent response for claiming photos
async function getVehicleAgentResponse(
  vehicleId: string,
  photoCount: number,
  workType: string,
  techName: string
): Promise<{ agentName: string; response: string }> {
  try {
    // Call vehicle agent to generate response
    const agentResponse = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/vehicle-agent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          vehicleId,
          action: "message",
          payload: {
            message: `${techName} just sent ${photoCount} photo${photoCount > 1 ? "s" : ""} of ${workType.replace(/_/g, " ")} work on me.`,
            fromName: techName,
            channel: "work_intake",
          },
        }),
      }
    );

    const result = await agentResponse.json();
    return {
      agentName: result.agent?.agent_name || "Vehicle",
      response: result.response || "Got my photos, thanks!",
    };
  } catch (e) {
    console.error("Vehicle agent call failed:", e);
    return {
      agentName: "Vehicle",
      response: "Got my photos, thanks!",
    };
  }
}

// Create timeline event for vehicle
async function createTimelineEvent(
  vehicleId: string,
  mediaUrls: string[],
  workType: string,
  description: string,
  techLink: any
) {
  const { data: event } = await supabase
    .from("vehicle_timeline")
    .insert({
      vehicle_id: vehicleId,
      event_type: "work_performed",
      event_title: `${workType.replace(/_/g, " ")} documented`,
      event_description: description,
      event_date: new Date().toISOString(),
      source_type: "technician_submission",
      media_urls: mediaUrls,
      created_by: techLink.user_id,
      metadata: {
        technician_phone_link_id: techLink.id,
        technician_name: techLink.display_name,
        photo_count: mediaUrls.length,
      },
    })
    .select()
    .single();

  return event;
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

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { techLinkId, mediaUrls, messageBody, source } = await req.json();

    if (!techLinkId || !mediaUrls?.length) {
      return new Response(JSON.stringify({ error: "Missing techLinkId or mediaUrls" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get technician info
    const { data: techLink } = await supabase
      .from("technician_phone_links")
      .select("*")
      .eq("id", techLinkId)
      .single();

    if (!techLink) {
      return new Response(JSON.stringify({ error: "Technician not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get affiliated organizations
    const { data: orgContribs } = await supabase
      .from("organization_contributors")
      .select("organization_id, businesses!inner(id, business_name)")
      .eq("user_id", techLink.user_id)
      .eq("status", "active");

    const affiliatedOrgs = orgContribs?.map((oc: any) => ({
      id: oc.organization_id,
      business_name: oc.businesses.business_name,
    })) || [];

    const orgIds = affiliatedOrgs.map(o => o.id);

    // Get assigned vehicles with org info
    const { data: assignments } = await supabase
      .from("vehicle_tech_assignments")
      .select(`
        vehicle_id,
        vehicles!inner(id, year, make, model, owner_org_id),
        businesses:vehicles(owner_org_id(business_name))
      `)
      .eq("technician_phone_link_id", techLink.id)
      .eq("status", "active");

    const assignedVehicles = assignments?.map((a: any) => ({
      ...a.vehicles,
      org_name: affiliatedOrgs.find(o => o.id === a.vehicles?.owner_org_id)?.business_name,
    })) || [];

    // Analyze batch
    console.log(`Analyzing ${mediaUrls.length} photos for ${techLink.display_name}...`);
    const analysis = await analyzeBatch(mediaUrls, messageBody || "", {
      techName: techLink.display_name,
      assignedVehicles,
      affiliatedOrgs,
    });

    // Process each vehicle group
    const results: Array<{
      vehicleName: string;
      orgName: string;
      photoCount: number;
      agentName: string;
      response: string;
      logged: boolean;
    }> = [];

    for (const group of analysis.vehicleGroups) {
      const groupUrls = group.photoIndices.map(i => mediaUrls[i]);

      // Match to existing vehicle
      const match = await matchVehicleWithOrg(group.vehicleHints, orgIds);

      let vehicleName = match.vehicleName ||
        `${group.vehicleHints.year || "?"} ${group.vehicleHints.make || "?"} ${group.vehicleHints.model || "?"}`;
      let orgName = match.orgId ? await getOrgName(match.orgId) : "unassigned";

      // Create timeline event if we have a vehicle match
      let logged = false;
      let agentResponse = { agentName: "Vehicle", response: "Got my photos!" };

      if (match.vehicleId) {
        await createTimelineEvent(
          match.vehicleId,
          groupUrls,
          group.workType,
          group.description,
          techLink
        );
        logged = true;

        // Get vehicle agent's response
        agentResponse = await getVehicleAgentResponse(
          match.vehicleId,
          groupUrls.length,
          group.workType,
          techLink.display_name || "Tech"
        );
      }

      // Store submission record
      await supabase.from("sms_work_submissions").insert({
        technician_phone_link_id: techLink.id,
        from_phone: source === "telegram" ? `telegram:${techLink.user_id}` : techLink.phone_number,
        message_body: messageBody,
        media_urls: groupUrls,
        processing_status: logged ? "logged" : "needs_vehicle",
        detected_vehicle_id: match.vehicleId,
        detected_vehicle_hints: group.vehicleHints,
        detected_work_type: group.workType,
        detected_description: group.description,
        confidence_score: group.confidence,
        ai_processed_at: new Date().toISOString(),
      });

      results.push({
        vehicleName,
        orgName,
        photoCount: groupUrls.length,
        agentName: agentResponse.agentName,
        response: agentResponse.response,
        logged,
      });
    }

    // Handle unmatched photos
    const unmatchedCount = analysis.unmatched.length;
    if (unmatchedCount > 0) {
      const unmatchedUrls = analysis.unmatched.map(i => mediaUrls[i]);
      await supabase.from("sms_work_submissions").insert({
        technician_phone_link_id: techLink.id,
        from_phone: source === "telegram" ? `telegram:${techLink.user_id}` : techLink.phone_number,
        message_body: messageBody,
        media_urls: unmatchedUrls,
        processing_status: "needs_vehicle",
        ai_processed_at: new Date().toISOString(),
      });
    }

    // Update tech stats
    await supabase
      .from("technician_phone_links")
      .update({
        photos_submitted: (techLink.photos_submitted || 0) + mediaUrls.length,
        last_submission_at: new Date().toISOString(),
      })
      .eq("id", techLink.id);

    // Format response message - each vehicle speaks
    let responseMsg = "";
    for (const r of results) {
      const emoji = r.logged ? "🚗" : "📸";
      responseMsg += `${emoji} **${r.agentName}** (${r.orgName}):\n   "${r.response}"\n   _${r.photoCount} photo${r.photoCount > 1 ? "s" : ""} logged_\n\n`;
    }

    if (unmatchedCount > 0) {
      responseMsg += `\n❓ ${unmatchedCount} photo${unmatchedCount > 1 ? "s" : ""} - couldn't ID the vehicle. VIN or year/make/model?`;
    }

    return new Response(JSON.stringify({
      success: true,
      message: responseMsg.trim(),
      results,
      unmatchedCount,
      totalProcessed: mediaUrls.length,
    }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Batch intake error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
