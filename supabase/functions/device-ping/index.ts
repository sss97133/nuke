import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * device-ping: Receives location pings from iOS Shortcuts, FindMy polling, etc.
 *
 * POST /device-ping
 * Body: { device_key, latitude, longitude, address?, accuracy_m?, source? }
 *
 * Or batch: { pings: [{ device_key, latitude, longitude, observed_at?, ... }] }
 *
 * Called by iOS Shortcut every 15 min during "Work" focus mode.
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();

    // Support single ping or batch
    const pings = body.pings || [body];

    const results = [];
    for (const ping of pings) {
      const { device_key, latitude, longitude, address, accuracy_m, source, observed_at } = ping;

      if (!device_key || !latitude || !longitude) {
        results.push({ device_key, error: "missing device_key, latitude, or longitude" });
        continue;
      }

      // Look up device
      const { data: device } = await supabase
        .from("tracked_devices")
        .select("id, device_type, display_name, vehicle_id")
        .eq("device_key", device_key)
        .limit(1);

      if (!device?.length) {
        results.push({ device_key, error: "unknown device" });
        continue;
      }

      // Insert location ping
      const { error } = await supabase.from("device_locations").insert({
        device_id: device[0].id,
        latitude,
        longitude,
        address: address || null,
        accuracy_m: accuracy_m || null,
        observed_at: observed_at || new Date().toISOString(),
        source: source || "shortcut",
      });

      if (error) {
        results.push({ device_key, error: error.message });
      } else {
        // Match to known place
        const { data: places } = await supabase.from("known_places").select("*");
        let place = null;
        if (places) {
          for (const p of places) {
            const R = 6371000;
            const dLat = (p.latitude - latitude) * Math.PI / 180;
            const dLon = (p.longitude - longitude) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 +
              Math.cos(latitude*Math.PI/180) * Math.cos(p.latitude*Math.PI/180) *
              Math.sin(dLon/2)**2;
            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            if (dist <= p.radius_m) { place = p; break; }
          }
        }

        results.push({
          device_key,
          ok: true,
          device_type: device[0].device_type,
          vehicle_id: device[0].vehicle_id,
          place: place?.name || null,
        });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
