/**
 * Nukeproof Bot - Minimal technician data collection
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BOT_TOKEN = Deno.env.get("NUKEPROOF_BOT_TOKEN");
const OWNER_CHAT_ID = "7587296683";

async function send(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function getFileUrl(fileId: string): Promise<string | null> {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
  const d = await r.json();
  return d.ok ? `https://api.telegram.org/file/bot${BOT_TOKEN}/${d.result.file_path}` : null;
}

function extractVIN(text: string): string | null {
  const t = text.trim();
  if (t.includes(" ") && t.length > 25) return null;
  if (/^(the|this|i |my |a |it |is )/i.test(t)) return null;
  const m = t.toUpperCase().match(/(?:VIN[:\s]*)?([A-HJ-NPR-Z0-9]{17})/);
  return m && !/[IOQ]/.test(m[1]) ? m[1] : null;
}

async function decodeVIN(vin: string) {
  const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`);
  const d = await r.json();
  const get = (id: number) => d.Results?.find((x: any) => x.VariableId === id)?.Value || null;
  return { valid: get(143) === "0" || !get(143), year: get(29) ? parseInt(get(29)) : null, make: get(26), model: get(28) };
}

async function findTech(telegramId: number) {
  const { data } = await supabase.from("technician_phone_links").select("id, display_name, metadata, active_vehicle_id, active_vin").not("metadata", "is", null);
  return data?.find((t: any) => t.metadata?.telegram_id === telegramId) || null;
}

async function linkPhone(phone: string, telegramId: number, username?: string) {
  const p = phone.replace(/[\s\-\+\(\)]/g, "");
  const ph = p.length === 10 ? `1${p}` : p;
  const { data } = await supabase.from("technician_phone_links").select("id, display_name").eq("phone_number", ph).single();
  if (!data) return null;
  await supabase.from("technician_phone_links").update({ metadata: { telegram_id: telegramId, telegram_username: username } }).eq("id", data.id);
  return data;
}

async function getOrCreateVehicle(vin: string, d: any) {
  const { data: ex } = await supabase.from("vehicles").select("id").eq("vin", vin).single();
  if (ex) return { id: ex.id, isNew: false };
  const { data: nv } = await supabase.from("vehicles").insert({ vin, year: d.year, make: d.make, model: d.model, source: "telegram" }).select("id").single();
  return { id: nv!.id, isNew: true };
}

Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("setup") === "true") {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${Deno.env.get("SUPABASE_URL")}/functions/v1/nukeproof-bot`);
    return new Response(JSON.stringify(await r.json()));
  }
  if (req.method !== "POST") return new Response("OK");

  const u = await req.json();
  if (!u.message) return new Response("OK");

  const { message: m } = u;
  const chatId = m.chat.id, userId = m.from.id, text = m.text || "";
  const tech = await findTech(userId);

  const HELP = `🔧 *Nukeproof*\n\n/status - Current vehicle\n/vehicles - Switch vehicle\n/help - Commands\n\nSend VIN to set vehicle\nSend photo to attach (AI sorts)\nSend text to add note\nSend location to log position`;

  if (text === "/start" || text === "/help") {
    await send(chatId, tech ? HELP : `Send your phone number to link profile.\nExample: \`702-624-6793\``);
    return new Response("OK");
  }

  if (text === "/status") {
    if (!tech) { await send(chatId, "Link profile first"); return new Response("OK"); }
    if (tech.active_vin) {
      const { data: v } = await supabase.from("vehicles").select("year, make, model").eq("id", tech.active_vehicle_id).single();
      await send(chatId, `📍 *${v?.year} ${v?.make} ${v?.model}*\nVIN: \`${tech.active_vin}\``);
    } else {
      await send(chatId, "No active vehicle. Send a VIN.");
    }
    return new Response("OK");
  }

  // Phone linking
  if (/^[\d\-\+\(\)\s]{10,}$/.test(text) && !tech) {
    const linked = await linkPhone(text, userId, m.from.username);
    if (linked) {
      await send(chatId, `✅ Linked! Hey ${linked.display_name}!\n\nSend a VIN to start.`);
      await send(parseInt(OWNER_CHAT_ID), `🔗 ${linked.display_name} linked Telegram`);
    } else {
      await send(chatId, "❓ Couldn't find that number.");
    }
    return new Response("OK");
  }

  // Photo
  if (m.photo?.length && tech) {
    if (!tech.active_vehicle_id) { await send(chatId, "Send VIN first"); return new Response("OK"); }
    const url = await getFileUrl(m.photo[m.photo.length - 1].file_id);
    if (!url) { await send(chatId, "⚠️ Failed"); return new Response("OK"); }
    const blob = await (await fetch(url)).blob();
    const path = `tech/${tech.id}/${tech.active_vehicle_id}/${Date.now()}.jpg`;
    await supabase.storage.from("vehicle-photos").upload(path, blob, { contentType: "image/jpeg" });
    const { data: pu } = supabase.storage.from("vehicle-photos").getPublicUrl(path);
    const { data: imgRow } = await supabase.from("vehicle_images").insert({
      vehicle_id: tech.active_vehicle_id,
      image_url: pu.publicUrl,
      source: "telegram",
      caption: m.caption || null
    }).select("id").single();

    // Trigger auto-classification in background
    if (imgRow) {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/auto-sort-photos`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "classify", image_ids: [imgRow.id], auto_apply: true })
      }).catch(() => {}); // Fire and forget
    }

    await send(chatId, `📸 Saved!` + (m.caption ? `\n"${m.caption}"` : "") + `\n🤖 AI will sort if needed`);
    return new Response("OK");
  }

  // Location - associate with current vehicle
  if (m.location && tech?.active_vehicle_id) {
    await supabase.from("vehicle_notes").insert({
      vehicle_id: tech.active_vehicle_id,
      note: `📍 Location: ${m.location.latitude}, ${m.location.longitude}`,
      source: "telegram",
      created_by: tech.id
    });
    await send(chatId, `📍 Location saved for current vehicle`);
    return new Response("OK");
  }

  // /vehicles - list recent vehicles to switch between
  if (text === "/vehicles" && tech) {
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, year, make, model, vin")
      .or("source.eq.telegram,source.eq.telegram_technician")
      .order("updated_at", { ascending: false })
      .limit(5);

    if (!vehicles?.length) {
      await send(chatId, "No vehicles yet. Send a VIN to add one.");
    } else {
      const list = vehicles.map((v, i) =>
        `${i + 1}. ${v.year || ''} ${v.make || ''} ${v.model || ''}\n   VIN: \`${v.vin || 'N/A'}\``
      ).join("\n\n");
      await send(chatId, `🚗 *Recent Vehicles:*\n\n${list}\n\nSend a VIN to switch.`);
    }
    return new Response("OK");
  }

  // VIN
  const vin = extractVIN(text);
  if (vin && tech) {
    const d = await decodeVIN(vin);
    if (!d.valid) { await send(chatId, `⚠️ Invalid VIN`); return new Response("OK"); }
    const { id, isNew } = await getOrCreateVehicle(vin, d);
    await supabase.from("technician_phone_links").update({ active_vehicle_id: id, active_vin: vin }).eq("id", tech.id);
    await send(chatId, `${isNew ? "🆕" : "✅"} *${d.year} ${d.make} ${d.model}*\nVIN: \`${vin}\`\n\nSend photos!`);
    return new Response("OK");
  }

  // Note
  if (tech?.active_vehicle_id && text.length > 2 && !text.startsWith("/")) {
    await supabase.from("vehicle_notes").insert({ vehicle_id: tech.active_vehicle_id, note: text, source: "telegram", created_by: tech.id });
    await send(chatId, `📝 Note saved`);
    return new Response("OK");
  }

  await send(chatId, tech ? (tech.active_vin ? `Working on \`${tech.active_vin}\`\nSend photo/note/new VIN` : "Send a VIN") : "Send phone number");
  return new Response("OK");
});
