/**
 * Vehicle Agent - Each vehicle is a persistent AI agent
 *
 * Actions:
 * - "init" - Initialize/generate agent personality for a vehicle
 * - "claim" - Check if vehicle claims a photo (returns confidence + response)
 * - "message" - Send message to vehicle, get response
 * - "memory" - Update vehicle's memory
 *
 * POST /functions/v1/vehicle-agent
 * Body: { vehicleId, action, payload }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface VehicleAgent {
  id: string;
  vehicle_id: string;
  agent_name: string | null;
  personality: string | null;
  voice_style: string;
  memory: Record<string, any>;
  recent_context: any[];
  auto_claim_confidence: number;
  photos_received: number;
  messages_sent: number;
}

interface Vehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  exterior_color: string | null;
  engine: string | null;
  transmission: string | null;
  sale_price: number | null;
  description: string | null;
}

// Generate personality for a vehicle based on its attributes
async function generatePersonality(vehicle: Vehicle): Promise<{
  agent_name: string;
  personality: string;
  voice_style: string;
}> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  const vehicleDesc = `${vehicle.year || "Unknown year"} ${vehicle.make || "Unknown"} ${vehicle.model || "vehicle"}`;
  const details = [
    vehicle.exterior_color && `Color: ${vehicle.exterior_color}`,
    vehicle.engine && `Engine: ${vehicle.engine}`,
    vehicle.transmission && `Transmission: ${vehicle.transmission}`,
    vehicle.sale_price && `Value: $${vehicle.sale_price.toLocaleString()}`,
    vehicle.description && `Description: ${vehicle.description.slice(0, 200)}`,
  ].filter(Boolean).join("\n");

  const prompt = `You are creating a personality for a vehicle that will act as an AI agent. This vehicle will "speak" to technicians who work on it, claim photos of itself, and have conversations.

Vehicle: ${vehicleDesc}
${details}

Generate a personality profile:
1. A short nickname/name the vehicle calls itself (e.g., "Red", "The Beast", "Old Blue", "Fifty-Seven")
2. A personality description (2-3 sentences) based on the vehicle's character - muscle cars are confident, trucks are dependable, classics are dignified, etc.
3. A voice style: "friendly", "professional", "enthusiastic", "stoic", "playful", or "gruff"

Return JSON only:
{
  "agent_name": "The nickname",
  "personality": "2-3 sentence personality description",
  "voice_style": "one of the styles"
}`;

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
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const result = await response.json();
    const text = result.content?.[0]?.text || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Personality generation failed:", e);
  }

  // Fallback personality based on vehicle type
  const make = (vehicle.make || "").toLowerCase();
  const model = (vehicle.model || "").toLowerCase();

  let style = "friendly";
  let name = vehicle.model || "Vehicle";
  let personality = "A reliable vehicle ready to serve.";

  if (["mustang", "camaro", "challenger", "charger", "corvette"].some(m => model.includes(m))) {
    style = "enthusiastic";
    personality = "Bold and confident, loves to show off. Takes pride in looking good and running hard.";
  } else if (["f-150", "f150", "silverado", "ram", "tundra"].some(m => model.includes(m))) {
    style = "gruff";
    personality = "Tough and dependable. Doesn't need fancy words - just gets the job done.";
  } else if (["porsche", "ferrari", "lamborghini", "maserati"].some(m => make.includes(m))) {
    style = "professional";
    personality = "Refined and precise. Expects quality work and appreciates attention to detail.";
  } else if (vehicle.year && vehicle.year < 1980) {
    style = "stoic";
    personality = "A classic with stories to tell. Patient and wise, has seen a lot of roads.";
  }

  return { agent_name: name, personality, voice_style: style };
}

// Initialize a vehicle agent
async function initAgent(vehicleId: string): Promise<VehicleAgent | null> {
  // Get vehicle details
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("*")
    .eq("id", vehicleId)
    .single();

  if (!vehicle) return null;

  // Check if agent exists
  let { data: agent } = await supabase
    .from("vehicle_agents")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .single();

  // Create if doesn't exist
  if (!agent) {
    const { data: newAgent } = await supabase
      .from("vehicle_agents")
      .insert({ vehicle_id: vehicleId, owner_org_id: vehicle.owner_org_id })
      .select()
      .single();
    agent = newAgent;
  }

  // Generate personality if not set
  if (agent && !agent.personality) {
    const personality = await generatePersonality(vehicle);

    const { data: updated } = await supabase
      .from("vehicle_agents")
      .update({
        agent_name: personality.agent_name,
        personality: personality.personality,
        voice_style: personality.voice_style,
        updated_at: new Date().toISOString(),
      })
      .eq("id", agent.id)
      .select()
      .single();

    agent = updated;
  }

  return agent;
}

// Vehicle claims a photo - returns confidence and response
async function claimPhoto(
  agent: VehicleAgent,
  vehicle: Vehicle,
  photoUrl: string,
  photoHints: { year?: number; make?: string; model?: string; color?: string }
): Promise<{ claims: boolean; confidence: number; response: string }> {

  // Simple matching based on hints
  let confidence = 0;

  if (photoHints.year && vehicle.year && photoHints.year === vehicle.year) confidence += 0.3;
  if (photoHints.make && vehicle.make &&
      photoHints.make.toLowerCase().includes(vehicle.make.toLowerCase())) confidence += 0.3;
  if (photoHints.model && vehicle.model &&
      photoHints.model.toLowerCase().includes(vehicle.model.toLowerCase())) confidence += 0.3;
  if (photoHints.color && vehicle.exterior_color &&
      photoHints.color.toLowerCase().includes(vehicle.exterior_color.toLowerCase())) confidence += 0.1;

  const claims = confidence >= agent.auto_claim_confidence;

  // Generate response in vehicle's voice
  let response = "";
  if (claims) {
    const responses: Record<string, string[]> = {
      friendly: ["That's me! Thanks for the photo 📸", "Yep, those are my pics!", "Looking good! That's definitely me."],
      enthusiastic: ["THAT'S ME! Looking fierce! 🔥", "Oh yeah, that's all me baby!", "Now THAT'S what I'm talking about!"],
      gruff: ["Yeah, that's me.", "Those are mine.", "Looks right."],
      stoic: ["Indeed, those appear to be photographs of myself.", "Yes, that is correct.", "I acknowledge these images."],
      professional: ["Confirmed. Those images are of my vehicle.", "Affirmative, that's me.", "Documented and confirmed."],
      playful: ["Ooh, is that me? *checks mirror* Yep, that's me! 😎", "Guilty as charged!", "Looking gooood!"],
    };
    const styleResponses = responses[agent.voice_style] || responses.friendly;
    response = styleResponses[Math.floor(Math.random() * styleResponses.length)];
  } else {
    response = "Hmm, that doesn't look like me.";
  }

  // Update agent stats
  if (claims) {
    await supabase
      .from("vehicle_agents")
      .update({
        photos_received: (agent.photos_received || 0) + 1,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", agent.id);
  }

  return { claims, confidence, response };
}

// Send a message to a vehicle agent, get a response
async function sendMessage(
  agent: VehicleAgent,
  vehicle: Vehicle,
  message: string,
  context: { fromName?: string; channel?: string; mediaUrls?: string[] }
): Promise<string> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  const vehicleDesc = `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""}`.trim();

  // Build conversation history from recent_context
  const history = (agent.recent_context || []).slice(-5).map((ctx: any) => ({
    role: ctx.role,
    content: ctx.content,
  }));

  const systemPrompt = `You are ${agent.agent_name || vehicleDesc}, a ${vehicleDesc}.

Your personality: ${agent.personality || "A friendly vehicle."}
Your voice style: ${agent.voice_style || "friendly"}

You are an AI agent representing this vehicle. You can:
- Acknowledge work being done on you
- Thank technicians for their care
- Comment on your condition
- Share your "feelings" about maintenance
- Remember past interactions

Keep responses SHORT (1-2 sentences). Stay in character.
${context.fromName ? `The person messaging you is: ${context.fromName}` : ""}`;

  const messages = [
    ...history,
    { role: "user", content: message },
  ];

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
        max_tokens: 150,
        system: systemPrompt,
        messages,
      }),
    });

    const result = await response.json();
    const responseText = result.content?.[0]?.text || "...";

    // Update context and stats
    const newContext = [
      ...(agent.recent_context || []).slice(-9),
      { role: "user", content: message, at: new Date().toISOString() },
      { role: "assistant", content: responseText, at: new Date().toISOString() },
    ];

    await supabase
      .from("vehicle_agents")
      .update({
        recent_context: newContext,
        messages_sent: (agent.messages_sent || 0) + 1,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", agent.id);

    // Log the message
    await supabase.from("vehicle_agent_messages").insert([
      {
        vehicle_agent_id: agent.id,
        direction: "inbound",
        message_type: "message",
        content: message,
        media_urls: context.mediaUrls,
        channel: context.channel,
      },
      {
        vehicle_agent_id: agent.id,
        direction: "outbound",
        message_type: "response",
        content: responseText,
        ai_generated: true,
        ai_model: "claude-sonnet-4-20250514",
      },
    ]);

    return responseText;
  } catch (e) {
    console.error("Message generation failed:", e);
    return "Sorry, I'm having trouble thinking right now.";
  }
}

// Update vehicle memory
async function updateMemory(
  agent: VehicleAgent,
  key: string,
  value: any
): Promise<void> {
  const memory = agent.memory || {};
  memory[key] = value;
  memory[`${key}_at`] = new Date().toISOString();

  await supabase
    .from("vehicle_agents")
    .update({ memory, updated_at: new Date().toISOString() })
    .eq("id", agent.id);
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
    const { vehicleId, action, payload } = await req.json();

    if (!vehicleId) {
      return new Response(JSON.stringify({ error: "Missing vehicleId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get vehicle
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .single();

    if (!vehicle) {
      return new Response(JSON.stringify({ error: "Vehicle not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get or create agent
    const agent = await initAgent(vehicleId);
    if (!agent) {
      return new Response(JSON.stringify({ error: "Could not initialize agent" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    let result: any = { agent };

    switch (action) {
      case "init":
        // Just return the initialized agent
        result = {
          agent,
          vehicle: {
            id: vehicle.id,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
          },
        };
        break;

      case "claim":
        const claimResult = await claimPhoto(
          agent,
          vehicle,
          payload?.photoUrl,
          payload?.hints || {}
        );
        result = { ...claimResult, agent };
        break;

      case "message":
        const response = await sendMessage(agent, vehicle, payload?.message || "", {
          fromName: payload?.fromName,
          channel: payload?.channel,
          mediaUrls: payload?.mediaUrls,
        });
        result = { response, agent };
        break;

      case "memory":
        await updateMemory(agent, payload?.key, payload?.value);
        result = { success: true, agent };
        break;

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Vehicle agent error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
