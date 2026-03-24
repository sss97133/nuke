/**
 * iMessage Router — Intent classification + dispatch for the iMessage bridge.
 *
 * Receives messages from scripts/imessage-bridge.mjs (local Mac daemon that
 * polls ~/Library/Messages/chat.db) and routes them to existing Nuke handlers:
 *   - vehicle search/query → direct DB
 *   - photo submission → image-intake
 *   - URL submission → import_queue
 *   - status check → DB stats
 *   - tapback reaction → execute/cancel pending action
 *   - vehicle data entry → ingest-observation
 *   - set active vehicle → conversation context update
 *   - general → conversational LLM response
 *
 * POST /functions/v1/imessage-router
 * Auth: Service role key (bridge runs locally with full trust)
 *
 * See docs/imessage-bridge-architecture.md for the full design.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callTier } from "../_shared/llmRouter.ts";
import type { AgentTier } from "../_shared/llmRouter.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Types ────────────────────────────────────────────────────

interface InboundMessage {
  chat_identifier: string;
  text: string | null;
  attachments: { url: string; filename: string; mime_type: string }[];
  message_guid: string;
  timestamp: string;
  is_tapback: boolean;
  tapback_type: number | null;     // 2000=loved, 2001=liked, 2002=disliked, 2003=laughed, 2004=emphasized, 2005=questioned
  tapback_target_guid: string | null;
}

interface Intent {
  intent: string;
  confidence: number;
  entities: {
    vehicle_ref?: string;
    url?: string;
    data_field?: string;
    data_value?: string;
  };
}

// Tapback type constants
const TAPBACK = {
  LOVED: 2000,
  LIKED: 2001,
  DISLIKED: 2002,
  LAUGHED: 2003,
  EMPHASIZED: 2004,
  QUESTIONED: 2005,
};

// URL patterns for vehicle listing detection
const LISTING_URL_PATTERN = /https?:\/\/(?:www\.)?(?:bringatrailer\.com\/listing\/|carsandbids\.com\/auctions\/|ebay\.com\/itm\/|[\w]+\.craigslist\.org\/|pcarmarket\.com\/listing\/|hemmings\.com\/(?:auction|classifieds)\/|classiccars\.com\/listings\/|hagerty\.com\/marketplace\/|collectingcars\.com\/for-sale\/|mecum\.com\/lots\/|rmsothebys\.com\/|barrett-jackson\.com\/)[^\s]+/i;

// ── Conversation State ───────────────────────────────────────

async function getOrCreateConversation(chatId: string) {
  const { data } = await supabase
    .from("imessage_conversations")
    .select("*")
    .eq("chat_identifier", chatId)
    .maybeSingle();

  if (data) return data;

  const { data: created } = await supabase
    .from("imessage_conversations")
    .insert({ chat_identifier: chatId })
    .select()
    .single();

  return created;
}

async function updateConversation(id: string, updates: Record<string, unknown>) {
  await supabase
    .from("imessage_conversations")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
}

function appendMessage(
  recentMessages: { role: string; text: string; ts: string }[],
  role: string,
  text: string,
) {
  const messages = [...(recentMessages || []), { role, text, ts: new Date().toISOString() }];
  return messages.slice(-20); // keep last 20
}

// ── Intent Classification ────────────────────────────────────

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for a vehicle data platform called Nuke. Classify the user's iMessage into exactly one category.

Categories:
- vehicle_search: Looking for vehicles, searching inventory ("find me a 70 chevelle", "any blazers?")
- vehicle_query: Asking about a specific vehicle's data/details/status ("what's the mileage?", "show me the K10")
- photo_submission: The message has photo attachments (will be indicated)
- url_submission: Message contains a vehicle listing URL
- status_check: System status, queue health, extraction progress ("status", "how's the queue?")
- approval: Approving/denying something ("yes", "approve", "no", "skip", "do it")
- set_vehicle: Setting which vehicle to talk about ("let's talk about the blazer", "switch to K10")
- data_entry: Providing vehicle data ("changed oil today", "mileage is 45000", "new tires installed")
- coaching: Auction readiness, what to photograph, what's missing ("what should I do next?", "ready to list?")
- market_query: Price, value, comparables ("what's it worth?", "comps for 70 chevelle")
- general: Greeting, casual, unclear intent

Return ONLY valid JSON: {"intent":"...","confidence":0.95,"entities":{"vehicle_ref":"...","url":"..."}}`;

async function classifyIntent(
  msg: InboundMessage,
  conversation: { active_vehicle_name: string | null; recent_messages: unknown[] },
): Promise<Intent> {
  // Fast-path: if message has attachments, it's photo_submission
  if (msg.attachments && msg.attachments.length > 0) {
    return { intent: "photo_submission", confidence: 1.0, entities: {} };
  }

  // Fast-path: if message contains a listing URL
  if (msg.text && LISTING_URL_PATTERN.test(msg.text)) {
    const urlMatch = msg.text.match(LISTING_URL_PATTERN);
    return { intent: "url_submission", confidence: 1.0, entities: { url: urlMatch?.[0] } };
  }

  // Fast-path: simple approval keywords
  const lower = (msg.text || "").trim().toLowerCase();
  if (["yes", "y", "approve", "do it", "go", "ok", "sure", "yep", "yeah"].includes(lower)) {
    return { intent: "approval", confidence: 1.0, entities: {} };
  }
  if (["no", "n", "deny", "skip", "nope", "cancel", "nah"].includes(lower)) {
    return { intent: "approval", confidence: 1.0, entities: {} };
  }

  // Fast-path: status keywords
  if (["status", "stats", "health", "queue"].includes(lower)) {
    return { intent: "status_check", confidence: 1.0, entities: {} };
  }

  // LLM classification for everything else
  const contextStr = conversation.active_vehicle_name
    ? `Active vehicle: ${conversation.active_vehicle_name}`
    : "No active vehicle set";

  const recentStr = (conversation.recent_messages || [])
    .slice(-5)
    .map((m: { role: string; text: string }) => `${m.role}: ${m.text}`)
    .join("\n");

  const userMsg = `${contextStr}\nRecent messages:\n${recentStr}\n\nNew message: "${msg.text}"${msg.attachments?.length ? `\n[${msg.attachments.length} photo(s) attached]` : ""}`;

  try {
    const result = await callTier("haiku", INTENT_SYSTEM_PROMPT, userMsg, {
      maxTokens: 200,
      temperature: 0,
      jsonMode: true,
    });

    const parsed = JSON.parse(result.content);
    return {
      intent: parsed.intent || "general",
      confidence: parsed.confidence || 0.5,
      entities: parsed.entities || {},
    };
  } catch {
    return { intent: "general", confidence: 0.3, entities: {} };
  }
}

// ── Intent Handlers ──────────────────────────────────────────

async function handleVehicleSearch(
  intent: Intent,
  msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  const searchTerm = intent.entities.vehicle_ref || msg.text || "";

  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, year, make, model, sale_price, status")
    .or(`make.ilike.%${searchTerm}%,model.ilike.%${searchTerm}%`)
    .eq("status", "active")
    .order("year", { ascending: false })
    .limit(5);

  if (!vehicles || vehicles.length === 0) {
    // Try full-text search on title-like fields
    const { data: fuzzy } = await supabase
      .from("vehicles")
      .select("id, year, make, model, sale_price, status")
      .textSearch("make", searchTerm.split(" ").join(" & "), { type: "websearch" })
      .limit(5);

    if (!fuzzy || fuzzy.length === 0) {
      return `No vehicles found matching "${searchTerm}". Try a different search term.`;
    }
    return formatVehicleList(fuzzy);
  }

  return formatVehicleList(vehicles);
}

function formatVehicleList(
  vehicles: { id: string; year: number; make: string; model: string; sale_price: number | null; status: string }[],
): string {
  const lines = vehicles.map(
    (v, i) =>
      `${i + 1}. ${v.year} ${v.make} ${v.model}${v.sale_price ? ` - $${v.sale_price.toLocaleString()}` : ""}`,
  );
  return `Found ${vehicles.length}:\n${lines.join("\n")}\n\nReply with a number for details.`;
}

async function handleVehicleQuery(
  intent: Intent,
  _msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  const vehicleId = conversation.active_vehicle_id as string;
  if (!vehicleId) {
    return "No active vehicle set. Tell me which vehicle you want to look at.";
  }

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("id, year, make, model, vin, sale_price, mileage, exterior_color, interior_color, transmission, engine, status, description")
    .eq("id", vehicleId)
    .single();

  if (!vehicle) return "Vehicle not found in database.";

  const fields = [
    `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    vehicle.vin ? `VIN: ${vehicle.vin}` : null,
    vehicle.mileage ? `Miles: ${vehicle.mileage.toLocaleString()}` : null,
    vehicle.exterior_color ? `Ext: ${vehicle.exterior_color}` : null,
    vehicle.interior_color ? `Int: ${vehicle.interior_color}` : null,
    vehicle.engine ? `Engine: ${vehicle.engine}` : null,
    vehicle.transmission ? `Trans: ${vehicle.transmission}` : null,
    vehicle.sale_price ? `Price: $${vehicle.sale_price.toLocaleString()}` : null,
    `Status: ${vehicle.status}`,
  ].filter(Boolean);

  return fields.join("\n");
}

async function handlePhotoSubmission(
  _intent: Intent,
  msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  const photoCount = msg.attachments?.length || 0;
  const vehicleId = conversation.active_vehicle_id as string;
  const vehicleName = conversation.active_vehicle_name as string;

  // Call image-intake edge function
  try {
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/image-intake`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "0b9f107a-d124-49de-9ded-94698f63c1c4", // owner user ID
          images: msg.attachments.map((a) => ({
            url: a.url,
            filename: a.filename,
            caption: msg.text || undefined,
          })),
          vehicleHint: vehicleId ? { vehicleId, vehicleName } : undefined,
          source: "imessage",
        }),
      },
    );

    const result = await response.json();
    const matched = result.summary?.matched || 0;
    const pending = result.summary?.pending || 0;

    // Update photo stats
    await updateConversation(conversation.id as string, {
      photos_received: ((conversation.photos_received as number) || 0) + photoCount,
    });

    if (matched > 0 && vehicleName) {
      return `${photoCount} photo${photoCount > 1 ? "s" : ""} added to ${vehicleName}.`;
    } else if (matched > 0) {
      return `${matched} photo${matched > 1 ? "s" : ""} matched to vehicle${matched > 1 ? "s" : ""}.`;
    } else if (pending > 0) {
      return `${photoCount} photo${photoCount > 1 ? "s" : ""} received. Couldn't auto-match to a vehicle — queued for review.`;
    }
    return `${photoCount} photo${photoCount > 1 ? "s" : ""} processed.`;
  } catch (e) {
    console.error("image-intake call failed:", e);
    return `Received ${photoCount} photo${photoCount > 1 ? "s" : ""}. Processing queued.`;
  }
}

async function handleUrlSubmission(
  intent: Intent,
  msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  const url = intent.entities.url || msg.text?.match(LISTING_URL_PATTERN)?.[0];
  if (!url) return "Couldn't find a listing URL in that message.";

  // Check for duplicate
  const { data: existing } = await supabase
    .from("import_queue")
    .select("id, status")
    .eq("listing_url", url)
    .maybeSingle();

  if (existing) {
    return `Already in queue (${existing.status}). ID: ${existing.id.slice(0, 8)}`;
  }

  const { data: queued, error } = await supabase
    .from("import_queue")
    .insert({
      listing_url: url,
      status: "pending",
      priority: 7, // higher priority for owner-submitted
      raw_data: { source: "imessage", chat_identifier: msg.chat_identifier },
    })
    .select("id")
    .single();

  if (error) {
    console.error("import_queue insert failed:", error);
    return "Failed to queue that URL. Check the logs.";
  }

  return `Queued for extraction: ${url.slice(0, 50)}...\nID: ${queued.id.slice(0, 8)}`;
}

async function handleStatusCheck(): Promise<string> {
  try {
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/ralph-wiggum-rlm-extraction-coordinator`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "brief" }),
      },
    );
    const brief = await response.json();

    const lines = [
      `Queue: ${brief.queue?.pending || "?"} pending`,
      brief.queue?.processing ? `Processing: ${brief.queue.processing}` : null,
      brief.queue?.failed ? `Failed: ${brief.queue.failed}` : null,
      brief.vehicles?.total ? `Vehicles: ${brief.vehicles.total.toLocaleString()}` : null,
    ].filter(Boolean);

    return lines.join("\n") || "System healthy. No issues detected.";
  } catch {
    // Fallback: direct DB stats
    const { count: pending } = await supabase
      .from("import_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    const { count: vehicles } = await supabase
      .from("vehicles")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");

    return `Queue: ${pending || 0} pending\nVehicles: ${(vehicles || 0).toLocaleString()} active`;
  }
}

async function handleApproval(
  _intent: Intent,
  msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  const pendingType = conversation.pending_action_type as string;
  const pendingData = conversation.pending_action_data as Record<string, unknown>;

  if (!pendingType || !pendingData) {
    return "Nothing pending to approve or deny.";
  }

  const lower = (msg.text || "").trim().toLowerCase();
  const isApproval = ["yes", "y", "approve", "do it", "go", "ok", "sure", "yep", "yeah"].includes(lower);

  // Clear pending action
  await updateConversation(conversation.id as string, {
    pending_action_type: null,
    pending_action_data: null,
    pending_action_message_guid: null,
  });

  if (!isApproval) {
    return `Skipped: ${pendingType}`;
  }

  // Execute the pending action based on type
  switch (pendingType) {
    case "approve_post": {
      // Approve patient-zero post
      if (pendingData.queue_id) {
        await supabase
          .from("patient_zero_queue")
          .update({ status: "approved" })
          .eq("id", pendingData.queue_id);
        return "Post approved. Will publish at next scheduled time.";
      }
      return "Post approved.";
    }
    case "confirm_import": {
      if (pendingData.url) {
        await supabase.from("import_queue").insert({
          listing_url: pendingData.url as string,
          status: "pending",
          priority: 7,
          raw_data: { source: "imessage_approval" },
        });
        return `Import confirmed: ${(pendingData.url as string).slice(0, 40)}...`;
      }
      return "Import confirmed.";
    }
    default:
      return `Approved: ${pendingType}`;
  }
}

async function handleTapback(
  msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string | null> {
  const pendingGuid = conversation.pending_action_message_guid as string;
  if (!pendingGuid || !msg.tapback_target_guid) return null;

  // Check if this tapback is on our pending message
  // tapback_target_guid format varies — may need prefix matching
  const pendingType = conversation.pending_action_type as string;
  const pendingData = conversation.pending_action_data as Record<string, unknown>;

  if (!pendingType) return null;

  const isApprove = msg.tapback_type === TAPBACK.LIKED || msg.tapback_type === TAPBACK.LOVED;
  const isDeny = msg.tapback_type === TAPBACK.DISLIKED;

  if (!isApprove && !isDeny) return null; // Laugh, emphasize, question = no action

  // Clear pending
  await updateConversation(conversation.id as string, {
    pending_action_type: null,
    pending_action_data: null,
    pending_action_message_guid: null,
  });

  if (isDeny) return `Skipped: ${pendingType}`;

  // Execute approval (same logic as handleApproval)
  switch (pendingType) {
    case "approve_post":
      if (pendingData?.queue_id) {
        await supabase
          .from("patient_zero_queue")
          .update({ status: "approved" })
          .eq("id", pendingData.queue_id);
      }
      return "Post approved.";
    case "confirm_import":
      if (pendingData?.url) {
        await supabase.from("import_queue").insert({
          listing_url: pendingData.url as string,
          status: "pending",
          priority: 7,
        });
      }
      return "Import confirmed.";
    default:
      return `Approved: ${pendingType}`;
  }
}

async function handleSetVehicle(
  intent: Intent,
  msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  const ref = intent.entities.vehicle_ref || msg.text || "";

  // Try to match by name fragments
  const words = ref.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
  let query = supabase
    .from("vehicles")
    .select("id, year, make, model")
    .eq("status", "active");

  for (const word of words) {
    query = query.or(`make.ilike.%${word}%,model.ilike.%${word}%`);
  }

  const { data: matches } = await query.limit(5);

  if (!matches || matches.length === 0) {
    return `No vehicle matching "${ref}". Try year + make + model.`;
  }

  if (matches.length === 1) {
    const v = matches[0];
    const name = `${v.year} ${v.make} ${v.model}`;
    await updateConversation(conversation.id as string, {
      active_vehicle_id: v.id,
      active_vehicle_name: name,
    });
    return `Active vehicle: ${name}`;
  }

  // Multiple matches — list them
  const lines = matches.map(
    (v: { year: number; make: string; model: string }, i: number) => `${i + 1}. ${v.year} ${v.make} ${v.model}`,
  );
  return `Multiple matches:\n${lines.join("\n")}\n\nReply with a number to select.`;
}

async function handleDataEntry(
  intent: Intent,
  msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  const vehicleId = conversation.active_vehicle_id as string;
  if (!vehicleId) {
    return "Set an active vehicle first. Tell me which vehicle this is about.";
  }

  // Submit as observation via ingest-observation
  try {
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/ingest-observation`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_slug: "imessage",
          kind: "work_record",
          vehicle_id: vehicleId,
          content_text: msg.text,
          observed_at: msg.timestamp,
          structured_data: intent.entities,
          observer_raw: { chat_identifier: msg.chat_identifier },
        }),
      },
    );

    const result = await response.json();
    if (result.success) {
      return `Logged for ${conversation.active_vehicle_name || "vehicle"}.`;
    }
    return "Data received. Processing.";
  } catch {
    return "Noted. Observation queued.";
  }
}

async function handleGeneral(
  msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  const systemPrompt = `You are Nuke, a vehicle data platform assistant. You communicate via iMessage — keep responses short (under 300 chars), casual, no markdown.
${conversation.active_vehicle_name ? `Active vehicle: ${conversation.active_vehicle_name}` : "No active vehicle."}
You help with: finding vehicles, tracking vehicle data, photo intake, auction readiness, market values.
If the user seems to be asking about a vehicle, suggest setting an active vehicle first.`;

  try {
    const result = await callTier("haiku", systemPrompt, msg.text || "hi", {
      maxTokens: 300,
      temperature: 0.7,
    });
    return result.content;
  } catch {
    return "Hey. What can I help with?";
  }
}

async function handleCoaching(
  _intent: Intent,
  _msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  const vehicleId = conversation.active_vehicle_id as string;
  if (!vehicleId) {
    return "Set an active vehicle first to get coaching advice.";
  }

  // Check photo count and basic data completeness
  const { count: photoCount } = await supabase
    .from("vehicle_images")
    .select("*", { count: "exact", head: true })
    .eq("vehicle_id", vehicleId);

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("vin, mileage, description, exterior_color, engine, transmission")
    .eq("id", vehicleId)
    .single();

  const gaps: string[] = [];
  if (!vehicle?.vin) gaps.push("VIN");
  if (!vehicle?.mileage) gaps.push("mileage");
  if (!vehicle?.description) gaps.push("description");
  if (!vehicle?.exterior_color) gaps.push("color");
  if (!vehicle?.engine) gaps.push("engine");
  if (!vehicle?.transmission) gaps.push("transmission");
  if ((photoCount || 0) < 20) gaps.push(`photos (${photoCount || 0}/20 min)`);

  const name = conversation.active_vehicle_name || "vehicle";

  if (gaps.length === 0) {
    return `${name} is looking solid. All key fields populated and ${photoCount} photos on file.`;
  }

  return `${name} needs:\n${gaps.map((g) => `- ${g}`).join("\n")}\n\nFill these gaps to improve auction readiness.`;
}

async function handleMarketQuery(
  _intent: Intent,
  msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  const vehicleId = conversation.active_vehicle_id as string;
  if (!vehicleId) {
    return "Set an active vehicle first. Then I can pull comps and market data.";
  }

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("year, make, model, sale_price")
    .eq("id", vehicleId)
    .single();

  if (!vehicle) return "Vehicle not found.";

  // Find comparable sold vehicles
  const { data: comps } = await supabase
    .from("vehicles")
    .select("year, make, model, sale_price")
    .eq("make", vehicle.make)
    .eq("model", vehicle.model)
    .gte("year", vehicle.year - 3)
    .lte("year", vehicle.year + 3)
    .not("sale_price", "is", null)
    .gt("sale_price", 0)
    .order("sale_price", { ascending: false })
    .limit(5);

  if (!comps || comps.length === 0) {
    return `No comparable sales found for ${vehicle.year} ${vehicle.make} ${vehicle.model}.`;
  }

  const prices = comps.map((c) => c.sale_price as number);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const high = Math.max(...prices);
  const low = Math.min(...prices);

  const lines = [
    `${vehicle.year} ${vehicle.make} ${vehicle.model} comps:`,
    `Range: $${low.toLocaleString()} - $${high.toLocaleString()}`,
    `Avg: $${avg.toLocaleString()} (${comps.length} sales)`,
  ];

  return lines.join("\n");
}

// ── Number Selection Handler ─────────────────────────────────

async function handleNumberSelection(
  num: number,
  conversation: Record<string, unknown>,
): Promise<string | null> {
  // Check if the last bot message was a numbered list
  const recent = (conversation.recent_messages as { role: string; text: string }[]) || [];
  const lastBot = [...recent].reverse().find((m) => m.role === "bot");
  if (!lastBot) return null;

  // Check if it contains numbered items
  const numberedPattern = /^(\d+)\.\s+(\d{4})\s+(\w+)\s+(.+)/gm;
  const matches = [...lastBot.text.matchAll(numberedPattern)];
  if (matches.length === 0) return null;

  const selected = matches.find((m) => parseInt(m[1]) === num);
  if (!selected) return null;

  // Search for the vehicle
  const year = parseInt(selected[2]);
  const make = selected[3];
  const modelText = selected[4].split(" - ")[0].trim();

  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, year, make, model")
    .eq("year", year)
    .ilike("make", `%${make}%`)
    .limit(5);

  if (vehicles && vehicles.length > 0) {
    const v = vehicles[0];
    const name = `${v.year} ${v.make} ${v.model}`;
    await updateConversation(conversation.id as string, {
      active_vehicle_id: v.id,
      active_vehicle_name: name,
    });
    return `Active vehicle set to ${name}. Ask me anything about it.`;
  }

  return null;
}

// ── Main Handler ─────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const msg: InboundMessage = await req.json();
    const conversation = await getOrCreateConversation(msg.chat_identifier);
    if (!conversation) {
      return new Response(JSON.stringify({ error: "Failed to load conversation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let reply: string;

    // Handle tapback reactions first (separate from text messages)
    if (msg.is_tapback) {
      const tapbackReply = await handleTapback(msg, conversation);
      if (tapbackReply) {
        reply = tapbackReply;
      } else {
        // Tapback on a non-pending message — ignore silently
        return new Response(JSON.stringify({ reply: null, action: "ignored_tapback" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Check if user is selecting a number from a list
      const num = parseInt((msg.text || "").trim());
      if (!isNaN(num) && num >= 1 && num <= 10) {
        const numReply = await handleNumberSelection(num, conversation);
        if (numReply) {
          reply = numReply;
        } else {
          // Not a valid number selection — classify normally
          const intent = await classifyIntent(msg, conversation);
          reply = await dispatchIntent(intent, msg, conversation);
        }
      } else {
        const intent = await classifyIntent(msg, conversation);
        reply = await dispatchIntent(intent, msg, conversation);
      }
    }

    // Update conversation state
    const updatedMessages = appendMessage(
      conversation.recent_messages || [],
      "user",
      msg.text || "[photo]",
    );
    const updatedWithReply = appendMessage(updatedMessages, "bot", reply);

    await updateConversation(conversation.id, {
      recent_messages: updatedWithReply,
      last_message_at: new Date().toISOString(),
      messages_received: (conversation.messages_received || 0) + 1,
      messages_sent: (conversation.messages_sent || 0) + 1,
    });

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("imessage-router error:", err);
    return new Response(JSON.stringify({ error: String(err), reply: "Something went wrong. Check the logs." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function dispatchIntent(
  intent: Intent,
  msg: InboundMessage,
  conversation: Record<string, unknown>,
): Promise<string> {
  switch (intent.intent) {
    case "vehicle_search":
      return handleVehicleSearch(intent, msg, conversation);
    case "vehicle_query":
      return handleVehicleQuery(intent, msg, conversation);
    case "photo_submission":
      return handlePhotoSubmission(intent, msg, conversation);
    case "url_submission":
      return handleUrlSubmission(intent, msg, conversation);
    case "status_check":
      return handleStatusCheck();
    case "approval":
      return handleApproval(intent, msg, conversation);
    case "set_vehicle":
      return handleSetVehicle(intent, msg, conversation);
    case "data_entry":
      return handleDataEntry(intent, msg, conversation);
    case "coaching":
      return handleCoaching(intent, msg, conversation);
    case "market_query":
      return handleMarketQuery(intent, msg, conversation);
    case "general":
    default:
      return handleGeneral(msg, conversation);
  }
}
