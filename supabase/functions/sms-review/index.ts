// SMS Review Handler
// Handles replies for photo vehicle assignment
// Twilio webhook: POST /functions/v1/sms-review

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const VEHICLES = [
  { num: "1", id: "a90c008a-3379-41d8-9eb2-b4eda365d74c", name: "C10" },
  { num: "2", id: "e08bf694-970f-4cbe-8a74-8715158a0f2e", name: "Blazer" },
  { num: "3", id: "e1b9c9ba-94e9-4a45-85c0-30bac65a40f8", name: "K10 (dad)" },
  { num: "4", id: null, name: "K10 (daily) - pending" },
  { num: "5", id: null, name: "K20 (Cameron) - pending" },
  { num: "0", id: null, name: "Skip/Not a vehicle" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST" }
    });
  }

  try {
    const formData = await req.formData();
    const body = formData.get("Body")?.toString().trim().toUpperCase() || "";
    const from = formData.get("From")?.toString() || "";

    // Handle REVIEW command - send pending photos
    if (body === "REVIEW") {
      const { data: photos } = await supabase
        .from("photo_inbox")
        .select("id, ai_match, confidence, image_data")
        .eq("needs_review", true)
        .limit(5);

      if (!photos?.length) {
        return twiml("No photos need review.");
      }

      const vehicleList = VEHICLES.map(v => `${v.num}=${v.name}`).join(", ");
      let msg = `${photos.length} photos to review:\n\n`;

      photos.forEach((p, i) => {
        const filename = p.image_data?.split("/").pop()?.slice(0, 15) || "?";
        msg += `#${i + 1}: ${p.ai_match || "unknown"} (${Math.round((p.confidence || 0) * 100)}%)\n`;
      });

      msg += `\nReply: 1-5 to assign (${vehicleList})\nOr: #1=2 to assign photo 1 to Blazer`;

      // Store session state
      await supabase.from("work_sessions").upsert({
        phone_number: from,
        state: "reviewing",
        context: { photo_ids: photos.map(p => p.id) },
        updated_at: new Date().toISOString()
      }, { onConflict: "phone_number" });

      return twiml(msg);
    }

    // Handle assignment: "2" assigns all to vehicle 2, "#1=3" assigns photo 1 to vehicle 3
    const { data: session } = await supabase
      .from("work_sessions")
      .select("context")
      .eq("phone_number", from)
      .eq("state", "reviewing")
      .single();

    if (!session?.context?.photo_ids?.length) {
      return twiml("No active review. Text REVIEW to start.");
    }

    const photoIds = session.context.photo_ids as string[];

    // Single number = assign all
    if (/^[0-5]$/.test(body)) {
      const vehicle = VEHICLES.find(v => v.num === body);
      if (!vehicle) return twiml("Invalid. Use 0-5.");

      if (vehicle.id) {
        await supabase
          .from("photo_inbox")
          .update({ vehicle_id: vehicle.id, needs_review: false, reviewed_at: new Date().toISOString() })
          .in("id", photoIds);
      } else {
        // Skip or pending vehicle
        await supabase
          .from("photo_inbox")
          .update({ needs_review: false, reviewed_at: new Date().toISOString(), ai_match: body === "0" ? "skipped" : vehicle.name })
          .in("id", photoIds);
      }

      // Clear session
      await supabase.from("work_sessions").update({ state: "idle" }).eq("phone_number", from);

      return twiml(`Assigned ${photoIds.length} photos to ${vehicle.name}. Text REVIEW for more.`);
    }

    // Specific assignment: #1=2
    const specific = body.match(/^#(\d+)=([0-5])$/);
    if (specific) {
      const photoIdx = parseInt(specific[1]) - 1;
      const vehicleNum = specific[2];

      if (photoIdx < 0 || photoIdx >= photoIds.length) {
        return twiml(`Invalid photo number. Use 1-${photoIds.length}`);
      }

      const vehicle = VEHICLES.find(v => v.num === vehicleNum);
      if (!vehicle) return twiml("Invalid vehicle. Use 0-5.");

      const photoId = photoIds[photoIdx];

      if (vehicle.id) {
        await supabase
          .from("photo_inbox")
          .update({ vehicle_id: vehicle.id, needs_review: false, reviewed_at: new Date().toISOString() })
          .eq("id", photoId);
      } else {
        await supabase
          .from("photo_inbox")
          .update({ needs_review: false, reviewed_at: new Date().toISOString() })
          .eq("id", photoId);
      }

      // Remove from session
      const remaining = photoIds.filter((_, i) => i !== photoIdx);
      if (remaining.length === 0) {
        await supabase.from("work_sessions").update({ state: "idle" }).eq("phone_number", from);
        return twiml(`Done! Photo assigned to ${vehicle.name}. Text REVIEW for more.`);
      }

      await supabase.from("work_sessions").update({
        context: { photo_ids: remaining }
      }).eq("phone_number", from);

      return twiml(`Photo ${photoIdx + 1} → ${vehicle.name}. ${remaining.length} left. Reply with next assignment.`);
    }

    return twiml("Commands: REVIEW, 1-5 (assign all), #1=2 (assign specific)");

  } catch (e) {
    console.error(e);
    return twiml("Error processing request");
  }
});

function twiml(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return new Response(xml, {
    headers: { "Content-Type": "text/xml" }
  });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] || c));
}
