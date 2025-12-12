// Supabase Edge Function: mailbox
// Reads Supabase credentials from environment secrets.
// Set secrets with:
//   supabase functions secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
//
// Deploy with:
//   supabase functions deploy mailbox --project-ref <your-project-ref>

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.48.0"

// ===== CONFIG (from secrets) =====
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

// Minimal message/type defs
type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

interface Mailbox {
  id: string
  vehicle_id: string
  vin: string | null
  user_access_level?: string
  message_count?: number
}

interface MailboxMessage {
  id: string
  mailbox_id: string
  message_type: string
  title: string
  content: string
  priority: string
  sender_type: string
  metadata: Record<string, any> | null
  read_by: string[] | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
    }
  })

const parseAuth = (req: Request) => {
  const header = req.headers.get("authorization") || ""
  if (!header.startsWith("Bearer ")) return null
  const token = header.replace("Bearer ", "").trim()
  return token.length > 0 ? token : null
}

const getUserId = async (token: string | null) => {
  if (!token) return null
  const client = createClient(SUPABASE_URL, token, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data, error } = await client.auth.getUser()
  if (error || !data?.user?.id) return null
  return data.user.id
}

const getMailboxWithAccess = async (vehicleId: string, userId: string | null) => {
  const { data, error } = await supabaseAdmin
    .from("vehicle_mailboxes")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .maybeSingle()

  if (error || !data) return null

  // Enforce access using mailbox_access_keys (Edge uses service role; must gate here)
  if (!userId) return null
  const { data: keyRow, error: keyErr } = await supabaseAdmin
    .from("mailbox_access_keys")
    .select("permission_level, expires_at")
    .eq("mailbox_id", data.id)
    .eq("user_id", userId)
    .in("permission_level", ["read_write", "read_only", "filtered", "write_only"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (keyErr || !keyRow) return null
  if (keyRow.expires_at && new Date(keyRow.expires_at).getTime() <= Date.now()) return null

  const messageCount = await supabaseAdmin
    .from("mailbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("mailbox_id", data.id)

  return {
    ...data,
    user_access_level: keyRow.permission_level || "read_only",
    message_count: messageCount.count || 0
  } as Mailbox
}

const getMessages = async (mailboxId: string, page = 1, limit = 20, type?: string) => {
  let query = supabaseAdmin
    .from("mailbox_messages")
    .select("*")
    .eq("mailbox_id", mailboxId)
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (type) query = query.eq("message_type", type)
  const { data, error } = await query
  if (error) throw error
  return data as MailboxMessage[]
}

const markRead = async (mailboxId: string, messageId: string, userId: string | null) => {
  if (!userId) throw new Error("unauthorized")
  const { data: msg, error: fetchErr } = await supabaseAdmin
    .from("mailbox_messages")
    .select("*")
    .eq("id", messageId)
    .eq("mailbox_id", mailboxId)
    .maybeSingle()
  if (fetchErr || !msg) throw new Error("not_found")

  const updatedReadBy = Array.isArray(msg.read_by)
    ? Array.from(new Set([...msg.read_by, userId]))
    : [userId]

  const { error: updErr } = await supabaseAdmin
    .from("mailbox_messages")
    .update({ read_by: updatedReadBy })
    .eq("id", messageId)
  if (updErr) throw updErr
}

const resolveMessage = async (mailboxId: string, messageId: string, userId: string | null, resolutionData: Json = {}) => {
  if (!userId) throw new Error("unauthorized")
  const { data: msg, error: fetchErr } = await supabaseAdmin
    .from("mailbox_messages")
    .select("*")
    .eq("id", messageId)
    .eq("mailbox_id", mailboxId)
    .maybeSingle()
  if (fetchErr || !msg) throw new Error("not_found")

  const { data, error: updErr } = await supabaseAdmin
    .from("mailbox_messages")
    .update({ resolved_at: new Date().toISOString(), resolved_by: userId, metadata: resolutionData })
    .eq("id", messageId)
    .select()
    .maybeSingle()
  if (updErr) throw updErr
  return data as MailboxMessage
}

// Wallet helpers (cash balance)
const getWallet = async (userId: string) => {
  const { data, error } = await supabaseAdmin
    .from("user_cash_balances")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) {
    return { balance_cents: 0, available_cents: 0, reserved_cents: 0 }
  }
  if (!data) return { balance_cents: 0, available_cents: 0, reserved_cents: 0 }
  return data as { balance_cents: number; available_cents: number; reserved_cents: number }
}

const updateWallet = async (userId: string, deltaCents: number) => {
  const wallet = await getWallet(userId)
  const newAvailable = (wallet.available_cents || 0) + deltaCents
  const newBalance = (wallet.balance_cents || 0) + deltaCents
  if (newAvailable < 0) throw new Error("insufficient_funds")
  const { data, error } = await supabaseAdmin
    .from("user_cash_balances")
    .upsert({
      user_id: userId,
      balance_cents: newBalance,
      available_cents: newAvailable,
      reserved_cents: wallet.reserved_cents || 0,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" })
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

// Stamp helpers (burn on use)
const getOwnedStamp = async (stampId: string, userId: string) => {
  const { data, error } = await supabaseAdmin
    .from("stamps")
    .select("*")
    .eq("id", stampId)
    .eq("user_id", userId)
    .eq("is_burned", false)
    .maybeSingle()
  if (error || !data) return null
  if ((data.remaining_uses || 0) <= 0) return null
  return data as { id: string; remaining_uses: number; face_value_cents?: number }
}

const burnStamp = async (stamp: { id: string; remaining_uses: number }) => {
  const newUses = Math.max(0, (stamp.remaining_uses || 1) - 1)
  const updates: Record<string, any> = { remaining_uses: newUses }
  if (newUses <= 0) {
    updates.is_burned = true
    updates.burned_at = new Date().toISOString()
    updates.is_listed = false
    updates.list_price_cents = null
  }
  const { data, error } = await supabaseAdmin
    .from("stamps")
    .update(updates)
    .eq("id", stamp.id)
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

const logStampSpend = async (stampId: string, userId: string, vehicleId: string, messageId: string, amountCents: number) => {
  await supabaseAdmin.from("stamp_spends").insert({
    stamp_id: stampId,
    user_id: userId,
    vehicle_id: vehicleId,
    message_id: messageId,
    amount_cents: amountCents || 0
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return json(200, { ok: true })
  }

  const url = new URL(req.url)
  const parts = url.pathname.split("/").filter(Boolean) // e.g., mailbox, vehicles, {id}, mailbox, messages

  // Expected patterns:
  // /mailbox/vehicles/:vehicle_id/mailbox
  // /mailbox/vehicles/:vehicle_id/mailbox/messages
  // /mailbox/vehicles/:vehicle_id/mailbox/messages/:message_id/read
  // /mailbox/vehicles/:vehicle_id/mailbox/messages/:message_id/resolve
  // /mailbox/vehicles/:vehicle_id/mailbox/messages/:message_id/duplicate-confirmation
  // /mailbox/vehicles/:vehicle_id/mailbox/access
  // /mailbox/vehicles/:vehicle_id/mailbox/access/:access_key_id
  // /mailbox/stamps (list), /mailbox/stamps/mint (simple mint)

  // Stamps routes (list, mint, purchase, wallet, market)
  if (parts.length >= 2 && parts[0] === "mailbox" && parts[1] === "stamps") {
    const token = parseAuth(req)
    const userId = await getUserId(token)
    if (!userId) return json(401, { status: "error", message: "Unauthorized" })

    // GET /mailbox/stamps
    if (req.method === "GET" && parts.length === 2) {
      const { data, error } = await supabaseAdmin
        .from("stamps")
        .select("*")
        .eq("user_id", userId)
        .eq("is_burned", false)
        .order("created_at", { ascending: false })
      if (error) return json(500, { status: "error", message: "Failed to load stamps" })
      return json(200, { status: "success", data })
    }

    // POST /mailbox/stamps/mint (simple mint for now)
    if (req.method === "POST" && parts[2] === "mint") {
      const body = await req.json().catch(() => ({}))
      const { sku, name, face_value_cents = 0, art_url, rarity } = body
      const insert = {
        user_id: userId,
        sku: sku || "stamp",
        name: name || "Stamp",
        face_value_cents,
        remaining_uses: 1,
        art_url: art_url || null,
        rarity: rarity || null
      }
      const { data, error } = await supabaseAdmin
        .from("stamps")
        .insert(insert)
        .select()
        .maybeSingle()
      if (error) return json(500, { status: "error", message: "Failed to mint stamp" })
      return json(200, { status: "success", data })
    }

    // POST /mailbox/stamps/purchase {count, cost_cents_per_stamp}
    if (req.method === "POST" && parts[2] === "purchase") {
      const body = await req.json().catch(() => ({}))
      const countRaw = Number(body.count) || 1
      const count = Math.min(50, Math.max(1, countRaw)) // cap at 50 per request
      const costPer = Math.max(0, Number(body.cost_cents_per_stamp) || 1) // default $0.01
      const total = count * costPer
      try {
        // debit wallet
        await updateWallet(userId, -total)
      } catch (err: any) {
        if (err?.message === "insufficient_funds") {
          return json(402, { status: "error", message: "Insufficient funds", code: "INSUFFICIENT_FUNDS" })
        }
        return json(500, { status: "error", message: "Wallet error" })
      }

      const inserts = Array.from({ length: count }).map(() => ({
        user_id: userId,
        sku: body.sku || "stamp",
        name: body.name || "Stamp",
        face_value_cents: costPer,
        remaining_uses: 1,
        art_url: body.art_url || null,
        rarity: body.rarity || null
      }))

      const { data, error } = await supabaseAdmin
        .from("stamps")
        .insert(inserts)
        .select()
      if (error) return json(500, { status: "error", message: "Failed to mint stamp" })

      const balance = await getWallet(userId)
      return json(200, { status: "success", data, balance })
    }

    // POST /mailbox/stamps/list { stamp_id, list_price_cents }
    if (req.method === "POST" && parts[2] === "list") {
      const body = await req.json().catch(() => ({}))
      const stampId = body.stamp_id || body.stampId
      const price = Number(body.list_price_cents) || 0
      if (!stampId || price <= 0) return json(400, { status: "error", message: "Invalid stamp or price" })
      const owned = await getOwnedStamp(stampId, userId)
      if (!owned) return json(409, { status: "error", message: "Stamp not available", code: "STAMP_INVALID" })
      const { error } = await supabaseAdmin
        .from("stamps")
        .update({ is_listed: true, list_price_cents: price })
        .eq("id", stampId)
      if (error) return json(500, { status: "error", message: "Failed to list" })
      return json(200, { status: "success" })
    }

    // POST /mailbox/stamps/unlist { stamp_id }
    if (req.method === "POST" && parts[2] === "unlist") {
      const body = await req.json().catch(() => ({}))
      const stampId = body.stamp_id || body.stampId
      if (!stampId) return json(400, { status: "error", message: "Invalid stamp" })
      const owned = await getOwnedStamp(stampId, userId)
      if (!owned) return json(409, { status: "error", message: "Stamp not available", code: "STAMP_INVALID" })
      const { error } = await supabaseAdmin
        .from("stamps")
        .update({ is_listed: false, list_price_cents: null })
        .eq("id", stampId)
      if (error) return json(500, { status: "error", message: "Failed to unlist" })
      return json(200, { status: "success" })
    }

    // GET /mailbox/stamps/market
    if (req.method === "GET" && parts[2] === "market") {
      const { data, error } = await supabaseAdmin
        .from("stamps")
        .select("*")
        .eq("is_listed", true)
        .eq("is_burned", false)
        .gt("remaining_uses", 0)
        .order("list_price_cents", { ascending: true })
        .limit(100)
      if (error) return json(500, { status: "error", message: "Failed to load market" })
      return json(200, { status: "success", data })
    }

    // POST /mailbox/stamps/buy { stamp_id }
    if (req.method === "POST" && parts[2] === "buy") {
      const body = await req.json().catch(() => ({}))
      const stampId = body.stamp_id || body.stampId
      if (!stampId) return json(400, { status: "error", message: "Invalid stamp" })
      const { data: stamp, error } = await supabaseAdmin
        .from("stamps")
        .select("*")
        .eq("id", stampId)
        .eq("is_listed", true)
        .eq("is_burned", false)
        .gt("remaining_uses", 0)
        .maybeSingle()
      if (error || !stamp) return json(409, { status: "error", message: "Stamp not listed or unavailable", code: "STAMP_UNAVAILABLE" })
      if (stamp.user_id === userId) return json(400, { status: "error", message: "Cannot buy your own stamp" })
      const price = Number(stamp.list_price_cents) || 0
      if (price <= 0) return json(400, { status: "error", message: "Invalid price" })

      // Simple settlement: debit buyer, credit seller, transfer ownership
      try {
        await updateWallet(userId, -price)
      } catch (err: any) {
        if (err?.message === "insufficient_funds") {
          return json(402, { status: "error", message: "Insufficient funds", code: "INSUFFICIENT_FUNDS" })
        }
        return json(500, { status: "error", message: "Wallet error" })
      }
      await updateWallet(stamp.user_id, price)

      const { error: updErr } = await supabaseAdmin
        .from("stamps")
        .update({
          user_id: userId,
          is_listed: false,
          list_price_cents: null
        })
        .eq("id", stampId)
      if (updErr) return json(500, { status: "error", message: "Transfer failed" })

      await supabaseAdmin.from("stamp_trades").insert({
        stamp_id: stampId,
        seller_id: stamp.user_id,
        buyer_id: userId,
        price_cents: price
      })

      const balance = await getWallet(userId)
      return json(200, { status: "success", data: { balance } })
    }

    return json(404, { status: "error", message: "Not found" })
  }

  // Wallet route
  if (parts.length === 2 && parts[0] === "mailbox" && parts[1] === "wallet") {
    const token = parseAuth(req)
    const userId = await getUserId(token)
    if (!userId) return json(401, { status: "error", message: "Unauthorized" })
    const balance = await getWallet(userId)
    return json(200, { status: "success", data: balance })
  }

  // Basic routing
  if (parts.length >= 4 && parts[0] === "mailbox" && parts[1] === "vehicles" && parts[3] === "mailbox") {
    const vehicleId = parts[2]
    const action = parts[4] || "" // could be messages
    const subId = parts[5] || ""

    const token = parseAuth(req)
    const userId = await getUserId(token)

    try {
      // GET /mailbox/vehicles/:vehicle_id/mailbox
      if (req.method === "GET" && !action) {
        const mailbox = await getMailboxWithAccess(vehicleId, userId)
        if (!mailbox) return json(404, { status: "error", message: "Mailbox not found" })
        return json(200, { status: "success", data: { mailbox, access_level: mailbox.user_access_level, message_count: mailbox.message_count } })
      }

      // GET messages
      if (req.method === "GET" && action === "messages") {
        const mailbox = await getMailboxWithAccess(vehicleId, userId)
        if (!mailbox) return json(404, { status: "error", message: "Mailbox not found" })
        const page = Number(url.searchParams.get("page") || 1)
        const limit = Number(url.searchParams.get("limit") || 20)
        const type = url.searchParams.get("type") || undefined
        const messages = await getMessages(mailbox.id, page, limit, type)
        return json(200, { status: "success", data: messages, pagination: { page, limit, total_count: messages.length } })
      }

      // PATCH read
      if (req.method === "PATCH" && action === "messages" && parts[5] && parts[6] === "read") {
        const mailbox = await getMailboxWithAccess(vehicleId, userId)
        if (!mailbox) return json(404, { status: "error", message: "Mailbox not found" })
        await markRead(mailbox.id, parts[5], userId)
        return json(200, { status: "success" })
      }

      // PATCH resolve
      if (req.method === "PATCH" && action === "messages" && parts[5] && parts[6] === "resolve") {
        const mailbox = await getMailboxWithAccess(vehicleId, userId)
        if (!mailbox) return json(404, { status: "error", message: "Mailbox not found" })
        const body = await req.json().catch(() => ({}))
        const updated = await resolveMessage(mailbox.id, parts[5], userId, body?.resolution_data || {})
        return json(200, { status: "success", data: updated })
      }

      // POST duplicate-confirmation
      if (req.method === "POST" && action === "messages" && parts[5] && parts[6] === "duplicate-confirmation") {
        const mailbox = await getMailboxWithAccess(vehicleId, userId)
        if (!mailbox) return json(404, { status: "error", message: "Mailbox not found" })
        // Placeholder: mark as resolved with action
        const body = await req.json().catch(() => ({}))
        const updated = await resolveMessage(mailbox.id, parts[5], userId, { action: body?.action || "confirm" })
        return json(200, { status: "success", data: updated })
      }

      // POST messages (create) with stamps or comment fallback
      if (req.method === "POST" && action === "messages" && !subId) {
        const mailbox = await getMailboxWithAccess(vehicleId, userId)
        if (!mailbox) return json(404, { status: "error", message: "Mailbox not found" })
        if (!userId) return json(403, { status: "error", message: "Unauthorized" })
        const body = await req.json().catch(() => ({}))
        const mode = body.mode || "paid" // "paid" | "comment"
        const stampId: string | undefined = body.stamp_id || body.stampId

        if (mode !== "comment") {
          if (!stampId) {
            return json(402, { status: "error", message: "Stamp required", code: "STAMP_REQUIRED" })
          }
          const stamp = await getOwnedStamp(stampId, userId)
          if (!stamp) {
            return json(402, { status: "error", message: "Invalid or burned stamp", code: "STAMP_INVALID" })
          }
          await burnStamp(stamp)
        }

        const payload = {
          mailbox_id: mailbox.id,
          vehicle_id: vehicleId,
          message_type: mode === "comment" ? "comment" : (body.message_type || "user_message"),
          title: body.title || "Message",
          content: body.content || "",
          priority: body.priority || "medium",
          sender_type: "user",
          metadata: body.metadata || {},
          read_by: [],
          resolved_at: null,
          resolved_by: null
        }
        const { data, error } = await supabaseAdmin
          .from("mailbox_messages")
          .insert(payload)
          .select()
          .maybeSingle()
        if (error) throw error
        if (mode !== "comment" && stampId) {
          const amount = body.cost_cents ?? 0
          await logStampSpend(stampId, userId, vehicleId, data.id, amount)
        }
        return json(200, { status: "success", data })
      }

      // GET access keys
      if (req.method === "GET" && action === "access") {
        // Placeholder: return empty list (implement access control when schema confirmed)
        return json(200, { status: "success", data: [] })
      }

      // POST access (grant)
      if (req.method === "POST" && action === "access") {
        return json(200, { status: "success", message: "Access granted (placeholder)", data: {} })
      }

      // DELETE access (revoke)
      if (req.method === "DELETE" && action === "access" && subId) {
        return json(200, { status: "success", message: "Access revoked (placeholder)" })
      }

      return json(404, { status: "error", message: "Not found" })
    } catch (err: any) {
      console.error("mailbox error", err?.message || err)
      if (err?.message === "unauthorized") return json(403, { status: "error", message: "Unauthorized" })
      if (err?.message === "not_found") return json(404, { status: "error", message: "Not found" })
      return json(500, { status: "error", message: "Server error", detail: err?.message || String(err) })
    }
  }

  return json(404, { status: "error", message: "Not found" })
})

