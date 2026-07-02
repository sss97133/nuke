// agent-chat — the in-app two-way agent (the "operate in the app, off Claude Code" surface).
//
// STAGED for Skylar's deploy. Needs ANTHROPIC_API_KEY in the edge env. It is the
// conversational FRONT-END to the same correction verbs the drill buttons use —
// grounded in the user's own garage, owner-gated (runs as the caller via their JWT),
// every action logged by the underlying RPCs. Not a chatbot bolted on: one verb set,
// two faces (the "Not this vehicle?" button and "these are my white truck" in chat both
// call relink_testimony / create-vehicle).
//
// Contract:
//   POST { messages: [{role:'user'|'assistant', content:string}], context?: {vehicle_id?, image_id?} }
//   → { reply: string, actions: [{tool, input, result}] }
//
// Tools (all run as the authed user under RLS):
//   list_garage()                         — ground the agent in what vehicles exist
//   move_photo(image_id, vehicle_id)      — relink_testimony('image', …) (forks, lineage, logged)
//   create_vehicle(year?, make?, model?)  — new profile owned by the user (the white-truck fork)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-opus-4-8"; // latest; swap per Config if needed
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const TOOLS = [
  {
    name: "list_garage",
    description: "List the user's vehicles (id, year, make, model). Call this first to know what profiles exist before moving a photo or deciding whether a new profile is needed.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "move_photo",
    description: "Move a photo to the vehicle it actually belongs to. Forks-not-hides: the photo moves with its history kept and the action is logged. Use when a photo is attributed to the wrong vehicle.",
    input_schema: {
      type: "object",
      properties: {
        image_id: { type: "string", description: "the vehicle_images id of the photo to move" },
        vehicle_id: { type: "string", description: "the destination vehicle id (must already exist; use create_vehicle first if it doesn't)" },
        reason: { type: "string", description: "short why, for the audit/training log" },
      },
      required: ["image_id", "vehicle_id"],
    },
  },
  {
    name: "find_photos",
    description:
      "Search the owner's photos — the find-machine. Filters compose: free-text over the deep-analysis narrative (what the frame SHOWS, e.g. 'trailer', 'loaded', 'paint booth'), a date window, a vehicle, a scene type. Returns matching frames newest-first with their day, attribution, narrative and thumbnail. LIMITATION: text search only reaches ANALYZED frames (~40% of the library and growing); date/vehicle filters reach everything. For event hunts ('when did we ship X'), try several synonyms across calls (trailer, hauler, loaded, transport, strapped) and summarize by DAY.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "one ilike pattern over the narrative, without % wrapping (added automatically)" },
        vehicle_id: { type: "string", description: "restrict to one vehicle profile" },
        date_from: { type: "string", description: "ISO date, inclusive" },
        date_to: { type: "string", description: "ISO date, exclusive" },
        scene_type: { type: "string", description: "exact scene: engine_bay|body_exterior|undercarriage|receipt_document|product_screenshot|wheel_assembly|road_test|off_property|shop_context|..." },
        limit: { type: "number", description: "max rows, default 20, cap 40" },
      },
      required: [],
    },
  },
  {
    name: "create_vehicle",
    description: "Create a NEW vehicle profile owned by the user, for a vehicle that doesn't have one yet (e.g. a daily-driver that got swept into a build's photos). Returns the new vehicle id. At least one of year/make/model is required.",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
      },
      required: [],
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return json({ error: "ANTHROPIC_API_KEY not configured on this function" }, 500);
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    // Run every DB action AS THE CALLER (their JWT → RLS + relink p_actor_user_id).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return json({ error: "Invalid session" }, 401);

    const body = await req.json();
    const userMessages = Array.isArray(body.messages) ? body.messages : [];
    const ctx = body.context ?? {};

    const system =
      "You help the owner ORGANIZE and FIND their vehicle photos inside the Nuke app. You are the " +
      "conversational face of the same tools the app's buttons use. The owner's " +
      "context: " + JSON.stringify(ctx) + ". When the owner says photos belong to a different " +
      "or a not-yet-existing vehicle (e.g. 'these interior shots are my white daily-driver'), " +
      "call list_garage to see what exists, create_vehicle if the right one doesn't, then " +
      "move_photo. When the owner is LOOKING for something ('the day we shipped the K10', " +
      "'that receipt from CarQuest'), use find_photos — try several synonym patterns across " +
      "calls, then answer with the DAY(s) and a one-line story per day, never a raw row dump. " +
      "Say honestly when a hunt only covered analyzed frames. Be concise. Confirm actions in " +
      "one line. Never invent vehicle ids — only use ids from list_garage or a fresh create_vehicle.";

    const messages = userMessages.map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? ""),
    }));

    const actions: any[] = [];

    // Tool-use loop, bounded (search sessions need a few synonym passes).
    for (let turn = 0; turn < 6; turn++) {
      const resp = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, tools: TOOLS, messages }),
      });
      if (!resp.ok) {
        return json({ error: `agent upstream ${resp.status}`, detail: await resp.text() }, 502);
      }
      const data = await resp.json();
      const toolUses = (data.content ?? []).filter((b: any) => b.type === "tool_use");

      if (toolUses.length === 0) {
        const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
        return json({ reply: text || "(no reply)", actions });
      }

      // Execute each tool, feed results back.
      messages.push({ role: "assistant", content: data.content });
      const toolResults: any[] = [];
      for (const tu of toolUses) {
        const result = await runTool(supabase, userId, tu.name, tu.input ?? {});
        actions.push({ tool: tu.name, input: tu.input, result });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return json({ reply: "Stopped after several steps — try rephrasing.", actions });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function runTool(supabase: any, userId: string, name: string, input: any) {
  try {
    if (name === "list_garage") {
      const { data, error } = await supabase.rpc("get_user_garage", { p_user_id: userId });
      if (error) throw error;
      return (data ?? []).map((v: any) => ({ vehicle_id: v.vehicle_id, year: v.year, make: v.make, model: v.model, relationship: v.relationship }));
    }
    if (name === "create_vehicle") {
      if (!input.year && !input.make && !input.model) return { error: "need at least one of year/make/model" };
      const { data, error } = await supabase
        .from("vehicles")
        .insert({ year: input.year, make: input.make, model: input.model, owner_id: userId, is_public: false })
        .select("id").single();
      if (error) throw error;
      return { vehicle_id: data.id };
    }
    if (name === "find_photos") {
      const lim = Math.min(Math.max(Number(input.limit) || 20, 1), 40);
      let q = supabase
        .from("vehicle_images")
        .select("id, vehicle_id, taken_at, thumbnail_url, image_url, ai_scan_metadata")
        .eq("user_id", userId)
        .order("taken_at", { ascending: false })
        .limit(lim);
      if (input.vehicle_id) q = q.eq("vehicle_id", input.vehicle_id);
      if (input.date_from) q = q.gte("taken_at", input.date_from);
      if (input.date_to) q = q.lt("taken_at", input.date_to);
      if (input.scene_type) q = q.eq("ai_scan_metadata->byok_deep_analysis->>scene_type", input.scene_type);
      if (input.text) q = q.ilike("ai_scan_metadata->byok_deep_analysis->>narrative_one_line", `%${input.text}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        image_id: r.id,
        vehicle_id: r.vehicle_id,
        day: (r.taken_at ?? "").slice(0, 10),
        narrative: r.ai_scan_metadata?.byok_deep_analysis?.narrative_one_line ?? null,
        scene: r.ai_scan_metadata?.byok_deep_analysis?.scene_type ?? null,
        thumbnail: r.thumbnail_url ?? r.image_url ?? null,
      }));
    }
    if (name === "move_photo") {
      if (!input.image_id || !input.vehicle_id) return { error: "need image_id and vehicle_id" };
      const { data, error } = await supabase.rpc("relink_testimony", {
        p_observation_type: "image",
        p_observation_id: input.image_id,
        p_target_vehicle_id: input.vehicle_id,
        p_reason: input.reason ? `agent · ${input.reason}` : "agent · owner correction",
        p_actor_user_id: userId,
      });
      if (error) throw error;
      return data ?? { moved: true };
    }
    return { error: `unknown tool ${name}` };
  } catch (e) {
    return { error: String(e) };
  }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
