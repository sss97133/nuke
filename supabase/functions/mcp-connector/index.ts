import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================================
// NUKE MCP CONNECTOR — Full-Resolution Vehicle Digital Twin Access
// =============================================================================
// Remote MCP server (Streamable HTTP transport) exposing the Nuke vehicle data
// platform. 22 tools across 7 layers: schema discovery, search, deep graph,
// market intelligence, reference library, vision, actors, and ingestion.
//
// Protocol: MCP Streamable HTTP (2025-03-26)
// Auth: X-API-Key (nk_live_...) or Authorization: Bearer (service role)
// Deploy: supabase functions deploy mcp-connector --no-verify-jwt
// =============================================================================

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getSupabase() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── CORS ────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-api-key, x-client-info, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

// ── JWT Helpers (Stateless OAuth) ────────────────────────────────────────────

const BASE_URL = `${SUPABASE_URL}/functions/v1/mcp-connector`;

let _jwtKey: CryptoKey | null = null;
async function getJwtKey(): Promise<CryptoKey> {
  if (!_jwtKey) {
    _jwtKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SERVICE_ROLE_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return _jwtKey;
}

function b64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return new Uint8Array([...atob(str)].map((c) => c.charCodeAt(0)));
}

async function signJwt(payload: Record<string, unknown>, expiresInSec: number): Promise<string> {
  const key = await getJwtKey();
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64UrlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const pay = b64UrlEncode(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec })));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${hdr}.${pay}`));
  return `${hdr}.${pay}.${b64UrlEncode(new Uint8Array(sig))}`;
}

async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const key = await getJwtKey();
    const enc = new TextEncoder();
    const valid = await crypto.subtle.verify("HMAC", key, b64UrlDecode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── OAuth Endpoints ─────────────────────────────────────────────────────────

function oauthResourceMetadata(): Response {
  return new Response(JSON.stringify({
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
    bearer_methods_supported: ["header"],
  }), { headers: { ...CORS, "Content-Type": "application/json" } });
}

function oauthServerMetadata(): Response {
  return new Response(JSON.stringify({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
  }), { headers: { ...CORS, "Content-Type": "application/json" } });
}

async function oauthAuthorize(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  const clientId = url.searchParams.get("client_id");

  if (!redirectUri) {
    return new Response("Missing redirect_uri", { status: 400, headers: CORS });
  }

  // Generate auth code as signed JWT (stateless, 5-min expiry)
  const code = await signJwt({
    type: "auth_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
  }, 300);

  // Auto-approve (single-owner system) — redirect back with code
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: { ...CORS, Location: redirect.toString() },
  });
}

async function oauthToken(req: Request): Promise<Response> {
  let params: URLSearchParams;
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await req.text());
  } else if (ct.includes("application/json")) {
    const json = await req.json();
    params = new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v)]));
  } else {
    params = new URLSearchParams(await req.text());
  }

  const grantType = params.get("grant_type");
  const code = params.get("code");
  const codeVerifier = params.get("code_verifier");

  if (grantType === "authorization_code" && code) {
    const payload = await verifyJwt(code);
    if (!payload || payload.type !== "auth_code") {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // PKCE verification
    if (payload.code_challenge && codeVerifier) {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(codeVerifier)));
      const computed = b64UrlEncode(new Uint8Array(hash));
      if (computed !== payload.code_challenge) {
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "PKCE failed" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    // Issue access token (90-day JWT)
    const accessToken = await signJwt({
      type: "access_token",
      sub: payload.client_id || "claude-ai",
      scope: "mcp:tools",
    }, 90 * 24 * 3600);

    return new Response(JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 90 * 24 * 3600,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "unsupported_grant_type" }), {
    status: 400, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function oauthRegister(req: Request): Promise<Response> {
  // Dynamic Client Registration (RFC 7591) — auto-register any client
  const body = await req.json().catch(() => ({}));
  const clientId = `nuke-${crypto.randomUUID().slice(0, 8)}`;
  // Client secret = signed JWT so we can verify it statelessly later
  const clientSecret = await signJwt({ type: "client_secret", client_id: clientId }, 365 * 24 * 3600);

  return new Response(JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris: body.redirect_uris || [],
    token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    client_name: body.client_name || "Nuke MCP Client",
  }), { status: 201, headers: { ...CORS, "Content-Type": "application/json" } });
}

// ── Auth ────────────────────────────────────────────────────────────────────

async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return "sha256_" + [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface AuthResult {
  ok: boolean;
  userId?: string;
  error?: string;
  status?: number;
}

async function authenticate(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  // 1. Service role key
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token === SERVICE_ROLE_KEY) {
      return { ok: true, userId: "service-role" };
    }
    const alt = Deno.env.get("SERVICE_ROLE_KEY");
    if (alt && token === alt) {
      return { ok: true, userId: "service-role" };
    }

    // 1b. OAuth JWT access token
    const jwt = await verifyJwt(token);
    if (jwt && jwt.type === "access_token") {
      return { ok: true, userId: String(jwt.sub || "oauth-user") };
    }
  }

  // 2. API key (nk_live_...)
  if (apiKey) {
    const rawKey = apiKey.startsWith("nk_live_") ? apiKey.slice(8) : apiKey;
    const keyHash = await hashApiKey(rawKey);
    const sb = getSupabase();
    const { data, error } = await sb.rpc("check_api_key_rate_limit", {
      p_key_hash: keyHash,
      p_endpoint: "mcp-connector",
    });
    if (error) {
      return { ok: false, error: "Auth service unavailable", status: 503 };
    }
    if (!data?.allowed) {
      const msg =
        data?.error === "rate_limit_exceeded"
          ? "Rate limit exceeded"
          : "Invalid API key";
      return { ok: false, error: msg, status: data?.error === "rate_limit_exceeded" ? 429 : 401 };
    }
    return { ok: true, userId: data.user_id || `agent:${data.agent_registration_id || "anon"}` };
  }

  // 3. No auth — reject
  return { ok: false, error: "Missing authentication. Provide X-API-Key or Authorization header.", status: 401 };
}

// ── Edge Function Proxy ─────────────────────────────────────────────────────

async function callEdgeFn(name: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${name} failed (${res.status}): ${txt.slice(0, 500)}`);
  }
  return res.json();
}

async function callEdgeApi(
  endpoint: string,
  path = "",
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = `${SUPABASE_URL}/functions/v1/api-v1-${endpoint}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`api-v1-${endpoint} failed (${res.status}): ${txt.slice(0, 500)}`);
  }
  return res.json();
}

// ── JSON-RPC Types ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function rpcResult(id: string | number | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(
  id: string | number | undefined,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

// ── MCP Tool Content Type ───────────────────────────────────────────────────

interface ToolContent {
  type: "text";
  text: string;
}

interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

function toolOk(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function toolErr(msg: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  // ── Schema Discovery ──────────────────────────────────────────────────
  {
    name: "describe_platform",
    description:
      "Get a high-level overview of the Nuke vehicle data platform: total vehicles, images, observations, sources, organizations, and a description of the 6 architecture layers. Call this first to understand what's available.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "describe_schema",
    description:
      "Describe database tables. Pass a table_name to get columns, types, and pipeline ownership. Pass a layer name (identity, factory_spec, vehicle_state, market, observations, actors) to get all tables in that architecture layer.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Specific table name (e.g. 'vehicles')" },
        layer: {
          type: "string",
          enum: ["identity", "factory_spec", "vehicle_state", "market", "observations", "actors"],
          description: "Architecture layer to describe",
        },
      },
    },
  },
  {
    name: "get_pipeline_registry",
    description:
      "Show which edge functions own which database fields. Returns pipeline_registry entries showing field ownership, whether direct writes are prohibited, and what function to use instead. Query by table name or get all entries.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Filter by table name" },
      },
    },
  },

  // ── Search ────────────────────────────────────────────────────────────
  {
    name: "search_vehicles",
    description:
      "Quick search across 1.25M+ vehicles. Accepts VIN (17 chars), listing URL, year, make/model text, or free-text query. Returns matching vehicles with thumbnails. " +
      "Results contain only confirmed data. Never fabricate missing fields — null means 'not recorded'. For location/price/body_style filtering, use browse_inventory instead.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — VIN, URL, year, 'Porsche 911', or free text" },
        limit: { type: "number", description: "Max results (1-100, default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_vehicles_advanced",
    description:
      "Full-text search with filters, pagination, and inline valuations. Filter by make, model, year range. Results include VIN, price, mileage, Nuke Estimate when available. " +
      "Returns paginated results — tell the user the total count and whether more exist. For location/body_style filtering, use browse_inventory instead.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search text" },
        make: { type: "string" },
        model: { type: "string" },
        year_from: { type: "number" },
        year_to: { type: "number" },
        sort: { type: "string", enum: ["relevance", "price_desc", "price_asc", "year_desc", "year_asc"] },
        limit: { type: "number", description: "Results per page (1-200, default 50)" },
        page: { type: "number", description: "Page number (default 1)" },
      },
      required: ["q"],
    },
  },

  {
    name: "browse_inventory",
    description:
      "Browse vehicles with location, body style, status, and price filters. Use this for queries like 'find me a truck in Las Vegas' or 'show Porsches under $80K in California'. " +
      "Queries the database directly with WHERE clauses. Results contain only confirmed data — never fabricate missing fields. Null values mean 'not recorded'.",
    inputSchema: {
      type: "object",
      properties: {
        body_style: { type: "string", description: "Body style filter (ilike match): Pickup, Coupe, Sedan, SUV, Convertible, Wagon, Van, Hatchback, etc." },
        location: { type: "string", description: "Text match on city, state, or location fields (e.g. 'Las Vegas', 'California', 'TX')" },
        status: { type: "string", enum: ["active", "sold", "pending", "inactive", "discovered"], description: "Vehicle status filter (default: all)" },
        price_min: { type: "number", description: "Minimum price (sale_price or asking_price)" },
        price_max: { type: "number", description: "Maximum price (sale_price or asking_price)" },
        make: { type: "string", description: "Make filter (e.g. 'Chevrolet', 'Porsche')" },
        model: { type: "string", description: "Model filter (e.g. 'K10', '911')" },
        year_from: { type: "number", description: "Minimum year" },
        year_to: { type: "number", description: "Maximum year" },
        sort: { type: "string", enum: ["price_asc", "price_desc", "year_asc", "year_desc", "newest"], description: "Sort order (default: newest)" },
        limit: { type: "number", description: "Max results (1-100, default 25)" },
      },
    },
  },

  // ── Vehicle Deep Graph ────────────────────────────────────────────────
  {
    name: "get_vehicle",
    description:
      "Get a vehicle profile by ID. Returns identity (year/make/model/VIN), pricing, location, images, and summary counts for observations, events, and images.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
      },
      required: ["vehicle_id"],
    },
  },
  {
    name: "query_vehicle_deep",
    description:
      "Full-resolution digital twin for one vehicle. Returns the complete entity across all 6 architecture layers: identity, market events, observations with sources, image summary, analysis signals, and valuations. " +
      "Also returns description, highlights, equipment, modifications, known_flaws, comment/description discoveries, and a _data_guidance section showing completeness. " +
      "This is the key tool for deep vehicle investigation. IMPORTANT: Present all returned data faithfully. Never fabricate details for null fields — say 'not recorded'.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
        include_observations: { type: "boolean", description: "Include recent observations (default true)" },
        include_events: { type: "boolean", description: "Include auction/listing events (default true)" },
        include_images: { type: "boolean", description: "Include image summary (default true)" },
        include_signals: { type: "boolean", description: "Include analysis signals (default true)" },
      },
      required: ["vehicle_id"],
    },
  },
  {
    name: "query_field_evidence",
    description:
      "Get the provenance chain for a specific field on a vehicle. Shows every source that contributed to the field's value, with confidence scores, timestamps, and source material references. This is how you answer 'how do you know that?'",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
        field_name: { type: "string", description: "Field to trace (e.g. 'engine_type', 'exterior_color')" },
      },
      required: ["vehicle_id", "field_name"],
    },
  },

  // ── Observations ──────────────────────────────────────────────────────
  {
    name: "query_observations",
    description:
      "Get observations for a vehicle with full provenance. Each observation includes source name, trust score, confidence, timestamp, and content. Filter by source or observation kind. " +
      "Observations are verified data from registered sources — present them faithfully with source attribution.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
        source: { type: "string", description: "Filter by source slug (e.g. 'bat', 'owner-input')" },
        kind: { type: "string", description: "Filter by kind (listing, comment, bid, specification, media, condition)" },
        min_confidence: { type: "number", description: "Minimum confidence score 0-1" },
        limit: { type: "number", description: "Max results (default 50, max 200)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: ["vehicle_id"],
    },
  },

  // ── Market Intelligence ───────────────────────────────────────────────
  {
    name: "get_valuation",
    description:
      "Look up a cached Nuke Estimate (valuation) by vehicle_id or VIN. Returns estimated value, confidence, range, deal score, heat score, and price tier. " +
      "Quote all price figures exactly as returned. Do not round or approximate.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
        vin: { type: "string", description: "Vehicle VIN (if no vehicle_id)" },
      },
    },
  },
  {
    name: "compute_valuation",
    description:
      "Force-recompute 'The Nuke Estimate' — a confidence-weighted 8-signal valuation. More expensive than get_valuation but always fresh. Returns value, confidence, deal score, heat score, price tier.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
        force: { type: "boolean", description: "Force recompute even if cached (default false)" },
      },
      required: ["vehicle_id"],
    },
  },
  {
    name: "get_comps",
    description:
      "Find comparable vehicle sales. Query by make/model, vehicle_id, or VIN. Returns actual auction results from BaT, Mecum, Barrett-Jackson, RM Sotheby's, Cars & Bids, and more. Includes price statistics.",
    inputSchema: {
      type: "object",
      properties: {
        make: { type: "string" },
        model: { type: "string" },
        year: { type: "number", description: "Target year — comps within +/- year_range" },
        year_range: { type: "number", description: "Year range (default +/- 2)" },
        vehicle_id: { type: "string", description: "Auto-resolves make/model/year" },
        vin: { type: "string", description: "Auto-resolves make/model/year" },
        limit: { type: "number", description: "Max results (1-100, default 20)" },
      },
    },
  },
  {
    name: "query_market_history",
    description:
      "Get all auction and listing events for a vehicle or model cohort. Returns chronological event history including final prices, bid counts, platforms, and outcomes.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID for single-vehicle history" },
        make: { type: "string", description: "Make for cohort query" },
        model: { type: "string", description: "Model for cohort query" },
        year_from: { type: "number" },
        year_to: { type: "number" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
  },

  // ── Reference Library ─────────────────────────────────────────────────
  {
    name: "query_library",
    description:
      "Search the vehicle reference library. Types: paint_codes (76 GM colors), condition_knowledge (1,084 entries from service manuals), condition_taxonomy (descriptors), vehicle_nomenclature (naming standards). Returns factory reference data.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["paint_codes", "condition_knowledge", "condition_taxonomy", "vehicle_nomenclature"],
          description: "Reference data type",
        },
        query: { type: "string", description: "Search text" },
        make: { type: "string", description: "Filter by make" },
        year: { type: "number", description: "Filter by year" },
        limit: { type: "number", description: "Max results (default 25)" },
      },
      required: ["type"],
    },
  },
  {
    name: "search_service_manuals",
    description:
      "Search ingested GM service manuals (1,111 chunks). Find torque specs, procedures, part numbers, service intervals. Returns matching text chunks with page references.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text (e.g. 'intake manifold torque spec')" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },

  // ── Vision ────────────────────────────────────────────────────────────
  {
    name: "analyze_image",
    description:
      "YONO vision analysis: make classification, condition (1-5), zone (41 zones), damage flags, modification flags, photo quality. $0/image — local inference, zero cloud API calls.",
    inputSchema: {
      type: "object",
      properties: {
        image_url: { type: "string", description: "URL of vehicle image" },
        include_comps: { type: "boolean", description: "Include comparable sales (default false)" },
      },
      required: ["image_url"],
    },
  },
  {
    name: "identify_vehicle_image",
    description:
      "AI identification of year/make/model/trim from a vehicle photo. Tiered approach: Gemini Flash → GPT-4o-mini → GPT-4o. Returns identification with confidence score and reasoning.",
    inputSchema: {
      type: "object",
      properties: {
        image_url: { type: "string", description: "URL of vehicle image" },
        context: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
          },
          description: "Optional context to help narrow identification",
        },
      },
      required: ["image_url"],
    },
  },
  {
    name: "query_vehicle_images",
    description:
      "Get images for a vehicle with zone classification, condition scores, and AI analysis metadata. Filter by zone (ext_front, ext_rear, interior, engine_bay, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
        zone: { type: "string", description: "Filter by zone/angle classification" },
        limit: { type: "number", description: "Max results (default 20, max 100)" },
      },
      required: ["vehicle_id"],
    },
  },

  // ── Actors & Organizations ────────────────────────────────────────────
  {
    name: "search_organizations",
    description:
      "Search 4,975 organizations — dealers, auction houses, restoration shops, builders, collectors. " +
      "Filter by business type and/or location. Results contain only confirmed data. Null values mean 'not recorded'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text (name match)" },
        type: {
          type: "string",
          enum: ["dealer", "garage", "auction_house", "builder", "restoration_shop", "performance_shop", "collection", "club", "registry", "marketplace"],
          description: "Filter by business_type",
        },
        location: { type: "string", description: "Text match on city or state (e.g. 'Las Vegas', 'Nevada', 'CA')" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_organization",
    description:
      "Get full organization profile by ID. Includes inventory summary, reputation, location, and linked vehicles.",
    inputSchema: {
      type: "object",
      properties: {
        org_id: { type: "string", description: "Organization UUID" },
      },
      required: ["org_id"],
    },
  },

  // ── Ingestion ─────────────────────────────────────────────────────────
  {
    name: "extract_listing",
    description:
      "Extract structured vehicle data from any listing URL. Works on BaT, Cars & Bids, Craigslist, eBay Motors, FB Marketplace, Hagerty, and thousands more. Returns year, make, model, VIN, price, images.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Listing URL to extract" },
        source: { type: "string", description: "Optional source hint (e.g. 'bat', 'craigslist')" },
      },
      required: ["url"],
    },
  },
  {
    name: "submit_observation",
    description:
      "Submit an observation about a vehicle through the governed pipeline. All writes go through ingest-observation, respecting pipeline_registry. Returns observation_id and dedup status.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
        source_slug: { type: "string", description: "Source slug (must match observation_sources)" },
        kind: { type: "string", description: "Observation kind (listing, comment, bid, specification, media, condition)" },
        content_text: { type: "string", description: "Raw observation text" },
        structured_data: { type: "object", description: "Structured fields extracted from the observation" },
        confidence_score: { type: "number", description: "Confidence 0-1" },
        source_url: { type: "string", description: "URL where this was observed" },
      },
      required: ["vehicle_id", "source_slug", "kind"],
    },
  },

  // ── Auction Readiness ───────────────────────────────────────────────
  {
    name: "get_auction_readiness",
    description:
      "Get the Auction Readiness Score for a vehicle. Returns a 6-dimension score (0-100) indicating how ready the vehicle is for auction submission, with specific coaching prompts for closing gaps.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
        vin: { type: "string", description: "Vehicle VIN (if no vehicle_id)" },
      },
    },
  },
  {
    name: "get_coaching_plan",
    description:
      "Get a prioritized coaching plan for improving a vehicle's auction readiness. Returns ordered actions (photo uploads, data entry, narrative writing) with specific prompts and point values.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
      },
      required: ["vehicle_id"],
    },
  },
  {
    name: "prepare_listing",
    description:
      "Generate a listing package preview for a vehicle. Pulls identity, ordered photos, structured fields, and valuation data into a submission-ready bundle. Vehicle should be TIER 1 or TIER 2.",
    inputSchema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string", description: "Vehicle UUID" },
        platform: { type: "string", description: "Target platform (default: 'bat')" },
      },
      required: ["vehicle_id"],
    },
  },

  // ── Photo Ingest ────────────────────────────────────────────────────
  {
    name: "ingest_photos",
    description:
      "Ingest vehicle photos into Nuke. Accepts base64-encoded images or URLs. " +
      "Use this when a user wants to upload, catalog, or document their vehicle with photos. " +
      "Each image is uploaded to storage, AI-classified (make/model/zone), and linked to a vehicle record. " +
      "If vehicle_id is not provided, AI will attempt to match based on image content and any hints (year/make/model). " +
      "Returns upload results with vehicle match and classification details.",
    inputSchema: {
      type: "object",
      properties: {
        images: {
          type: "array",
          description: "Array of images to ingest. Each must have either 'url' (public URL) or 'base64' (base64-encoded image data).",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "Public URL of the image" },
              base64: { type: "string", description: "Base64-encoded image data (JPEG or PNG)" },
              filename: { type: "string", description: "Original filename (e.g. 'IMG_2453.jpg')" },
              taken_at: { type: "string", description: "ISO timestamp when photo was taken" },
              latitude: { type: "number", description: "GPS latitude" },
              longitude: { type: "number", description: "GPS longitude" },
              caption: { type: "string", description: "User description or caption for the photo" },
            },
          },
        },
        vehicle_id: { type: "string", description: "Vehicle UUID if known. If omitted, AI will match from image content." },
        vehicle_hint: {
          type: "object",
          description: "Hints to help match the vehicle if vehicle_id is not known.",
          properties: {
            year: { type: "number" },
            make: { type: "string" },
            model: { type: "string" },
            vin: { type: "string" },
            color: { type: "string" },
          },
        },
        user_id: { type: "string", description: "User UUID (for attribution). Optional." },
        source: { type: "string", description: "Where photos came from (e.g. 'claude_upload', 'user_folder', 'phone'). Default: 'ai_ingest'." },
      },
      required: ["images"],
    },
  },
];

// =============================================================================
// TOOL HANDLERS
// =============================================================================

const sb = () => getSupabase();

// ── Schema Discovery ────────────────────────────────────────────────────────

async function handleDescribePlatform(): Promise<ToolResult> {
  const supabase = sb();
  const [vehicles, images, observations, sources, orgs, events] = await Promise.all([
    supabase.from("vehicles").select("id", { count: "exact", head: true }),
    supabase.from("vehicle_images").select("id", { count: "exact", head: true }),
    supabase.from("vehicle_observations").select("id", { count: "exact", head: true }),
    supabase.from("observation_sources").select("id", { count: "exact", head: true }),
    supabase.from("organizations").select("id", { count: "exact", head: true }),
    supabase.from("vehicle_events").select("id", { count: "exact", head: true }),
  ]);

  return toolOk({
    platform: "Nuke Vehicle Data Platform",
    description:
      "Full-resolution digital twin database for collector vehicles. " +
      "The database doesn't describe the vehicle — the database IS the vehicle. " +
      "Every data point is source-attributed, confidence-scored, and traceable.",
    stats: {
      vehicles: vehicles.count ?? 0,
      images: images.count ?? 0,
      observations: observations.count ?? 0,
      observation_sources: sources.count ?? 0,
      organizations: orgs.count ?? 0,
      market_events: events.count ?? 0,
    },
    architecture_layers: {
      "1_identity": "VIN, year, make, model, platform — the vehicle's immutable identity",
      "2_factory_spec": "What the factory said it IS — production data, SPID, RPO codes, paint codes",
      "3_vehicle_state": "What THIS car is NOW — condition, modifications, known issues, documents",
      "4_market": "Auction events, valuations, comparable sales, bid curves, sentiment analysis",
      "5_observations": "Every fact from every source with provenance. 117 registered sources with calibrated trust scores.",
      "6_actors": "Organizations, sellers, buyers, builders — everyone who touched the vehicle, with evidence chains",
    },
    capabilities: [
      "Search 1.25M+ vehicles by VIN, URL, text, or filters",
      "Full digital twin query — all 6 layers for any vehicle",
      "Field-level provenance — trace any fact to its sources",
      "Valuations at 6.3% MAPE across 773K estimates",
      "YONO vision analysis at $0/image",
      "117 data sources with calibrated trust scores",
      "Comparable sales from BaT, Mecum, RM Sotheby's, and 100+ platforms",
      "Reference library: paint codes, condition knowledge, service manuals",
    ],
  });
}

async function handleDescribeSchema(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();

  if (args.table_name) {
    const { data: cols } = await supabase
      .from("information_schema.columns" as any)
      .select("column_name, data_type, is_nullable, column_default")
      .eq("table_schema", "public")
      .eq("table_name", args.table_name)
      .order("ordinal_position");

    // Get pipeline_registry entries for this table
    const { data: pipeline } = await supabase
      .from("pipeline_registry")
      .select("column_name, owned_by, do_not_write_directly, write_via, description")
      .eq("table_name", args.table_name);

    return toolOk({
      table: args.table_name,
      columns: cols || [],
      pipeline_ownership: pipeline || [],
    });
  }

  if (args.layer) {
    const layerTables: Record<string, string[]> = {
      identity: ["vehicles", "canonical_makes", "canonical_models", "canonical_body_styles", "canonical_vehicle_types"],
      factory_spec: ["paint_codes", "condition_knowledge", "vehicle_nomenclature", "service_manual_chunks"],
      vehicle_state: ["vehicle_images", "import_queue", "document_ocr_queue"],
      market: ["vehicle_events", "analysis_signals", "analysis_widgets", "comment_discoveries", "description_discoveries"],
      observations: ["vehicle_observations", "observation_sources", "observation_extractors", "vehicle_field_evidence", "vehicle_field_sources"],
      actors: ["organizations", "organization_locations", "bat_user_profiles"],
    };

    const tables = layerTables[args.layer as string] || [];
    const results = [];
    for (const t of tables) {
      const { count } = await supabase.from(t as any).select("id", { count: "exact", head: true });
      results.push({ table: t, row_count: count ?? "unknown" });
    }
    return toolOk({ layer: args.layer, tables: results });
  }

  return toolErr("Provide table_name or layer parameter");
}

async function handleGetPipelineRegistry(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  let query = supabase
    .from("pipeline_registry")
    .select("table_name, column_name, owned_by, do_not_write_directly, write_via, description")
    .order("table_name")
    .order("column_name");

  if (args.table_name) {
    query = query.eq("table_name", args.table_name);
  }

  const { data, error } = await query.limit(100);
  if (error) return toolErr(error.message);
  return toolOk({ entries: data, count: data?.length ?? 0 });
}

// ── Search ──────────────────────────────────────────────────────────────────

async function handleSearchVehicles(args: Record<string, unknown>): Promise<ToolResult> {
  const data = await callEdgeFn("universal-search", {
    query: args.query,
    limit: args.limit ?? 10,
  });
  return toolOk(data);
}

async function handleSearchVehiclesAdvanced(args: Record<string, unknown>): Promise<ToolResult> {
  const params = new URLSearchParams();
  params.set("q", String(args.q));
  if (args.make) params.set("make", String(args.make));
  if (args.model) params.set("model", String(args.model));
  if (args.year_from) params.set("year_from", String(args.year_from));
  if (args.year_to) params.set("year_to", String(args.year_to));
  if (args.sort) params.set("sort", String(args.sort));
  if (args.limit) params.set("limit", String(args.limit));
  if (args.page) params.set("page", String(args.page));

  const data = await callEdgeApi("search", `?${params}`);
  return toolOk(data);
}

async function handleBrowseInventory(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const limit = Math.min(Number(args.limit) || 25, 100);

  let query = supabase
    .from("vehicles")
    .select(
      "id, vin, year, make, model, trim, body_style, " +
      "sale_price, asking_price, nuke_estimate, deal_score, " +
      "mileage, exterior_color:color, transmission, engine_type, " +
      "status, city, state, location, country, " +
      "primary_image_url, listing_url, " +
      "created_at"
    );

  // Location filter — match on city, state, or location
  if (args.location) {
    const loc = String(args.location);
    query = query.or(`city.ilike.%${loc}%,state.ilike.%${loc}%,location.ilike.%${loc}%`);
  }

  // Body style
  if (args.body_style) {
    query = query.ilike("body_style", `%${args.body_style}%`);
  }

  // Status
  if (args.status) {
    query = query.eq("status", String(args.status));
  }

  // Make / model
  if (args.make) {
    query = query.ilike("make", String(args.make));
  }
  if (args.model) {
    query = query.ilike("model", `%${args.model}%`);
  }

  // Year range
  if (args.year_from) {
    query = query.gte("year", Number(args.year_from));
  }
  if (args.year_to) {
    query = query.lte("year", Number(args.year_to));
  }

  // Price range — check both sale_price and asking_price
  if (args.price_min) {
    const min = Number(args.price_min);
    query = query.or(`sale_price.gte.${min},asking_price.gte.${min}`);
  }
  if (args.price_max) {
    const max = Number(args.price_max);
    query = query.or(`sale_price.lte.${max},asking_price.lte.${max}`);
  }

  // Sort
  const sortMap: Record<string, [string, boolean]> = {
    price_asc: ["sale_price", true],
    price_desc: ["sale_price", false],
    year_asc: ["year", true],
    year_desc: ["year", false],
    newest: ["created_at", false],
  };
  const [sortCol, sortAsc] = sortMap[String(args.sort)] || sortMap.newest;
  query = query.order(sortCol, { ascending: sortAsc, nullsFirst: false });

  const { data, error, count } = await query.limit(limit);
  if (error) return toolErr(error.message);

  return toolOk({
    count: data?.length ?? 0,
    filters_applied: {
      location: args.location || null,
      body_style: args.body_style || null,
      status: args.status || null,
      make: args.make || null,
      model: args.model || null,
      year_range: args.year_from || args.year_to ? `${args.year_from || "any"}-${args.year_to || "any"}` : null,
      price_range: args.price_min || args.price_max ? `$${args.price_min || 0}-$${args.price_max || "any"}` : null,
    },
    vehicles: data || [],
    _note: "Results contain only confirmed data. Null fields mean 'not recorded'. Location data may be sparse — not all vehicles have city/state populated.",
  });
}

// ── Vehicle Deep Graph ──────────────────────────────────────────────────────

async function handleGetVehicle(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const vid = String(args.vehicle_id);

  const { data: vehicle, error } = await supabase
    .from("vehicles")
    .select(
      "id, vin, year, make, model, trim, series, body_style, engine_type, engine_displacement, " +
      "transmission, drivetrain, exterior_color:color, interior_color, mileage, " +
      "sale_price, asking_price, canonical_sold_price, canonical_outcome, canonical_platform, " +
      "status, auction_status, reserve_status, " +
      "nuke_estimate, nuke_estimate_confidence, deal_score, heat_score, " +
      "primary_image_url, image_count, observation_count, " +
      "description, location, city, state, country, " +
      "data_quality_score, listing_url, bat_auction_url, " +
      "created_at, updated_at"
    )
    .eq("id", vid)
    .single();

  if (error) return toolErr(error.message);
  if (!vehicle) return toolErr("Vehicle not found");

  // Get event count
  const { count: eventCount } = await supabase
    .from("vehicle_events")
    .select("id", { count: "exact", head: true })
    .eq("vehicle_id", vid);

  return toolOk({ ...vehicle, event_count: eventCount ?? 0 });
}

async function handleQueryVehicleDeep(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const vid = String(args.vehicle_id);
  const includeObs = args.include_observations !== false;
  const includeEvents = args.include_events !== false;
  const includeImages = args.include_images !== false;
  const includeSignals = args.include_signals !== false;

  // Parallel fetches across all layers
  const promises: Promise<any>[] = [
    // Layer 1: Identity + core fields
    supabase
      .from("vehicles")
      .select("*")
      .eq("id", vid)
      .single(),
  ];

  // Layer 4: Market events
  if (includeEvents) {
    promises.push(
      supabase
        .from("vehicle_events")
        .select("id, source_platform, source_url, event_type, event_status, started_at, ended_at, sold_at, final_price, starting_price, bid_count, comment_count, view_count, seller_identifier, buyer_identifier, metadata")
        .eq("vehicle_id", vid)
        .order("ended_at", { ascending: false, nullsFirst: false })
        .limit(20),
    );
  }

  // Layer 5: Observations
  if (includeObs) {
    promises.push(
      supabase
        .from("vehicle_observations")
        .select("id, kind, content_text, structured_data, confidence_score, observed_at, source_url, source_id, is_superseded")
        .eq("vehicle_id", vid)
        .eq("is_superseded", false)
        .order("observed_at", { ascending: false })
        .limit(30),
    );
    promises.push(
      supabase
        .from("observation_sources")
        .select("id, slug, display_name, category, base_trust_score"),
    );
  }

  // Images summary
  if (includeImages) {
    promises.push(
      supabase
        .from("vehicle_images")
        .select("id, url, angle, condition_score, photo_quality_score, ai_processing_status, damage_flags, modification_flags")
        .eq("vehicle_id", vid)
        .order("created_at", { ascending: false })
        .limit(50),
    );
  }

  // Analysis signals
  if (includeSignals) {
    promises.push(
      supabase
        .from("analysis_signals")
        .select("widget_slug, score, severity, recommendations, updated_at")
        .eq("vehicle_id", vid),
    );
  }

  // Comment discoveries (AI-extracted auction commentary insights)
  promises.push(
    supabase
      .from("comment_discoveries")
      .select("overall_sentiment, sentiment_score, total_fields, raw_extraction, comment_count, data_quality_score, model_used")
      .eq("vehicle_id", vid)
      .order("discovered_at", { ascending: false })
      .limit(5),
  );

  // Description discoveries (AI-extracted structured fields from descriptions)
  promises.push(
    supabase
      .from("description_discoveries")
      .select("total_fields, raw_extraction, keys_found, model_used, description_length")
      .eq("vehicle_id", vid)
      .order("discovered_at", { ascending: false })
      .limit(3),
  );

  const results = await Promise.all(promises);
  let idx = 0;

  const vehicle = results[idx++]?.data;
  if (!vehicle) return toolErr("Vehicle not found");

  const response: Record<string, unknown> = {
    identity: {
      id: vehicle.id,
      vin: vehicle.vin,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      series: vehicle.series,
      body_style: vehicle.body_style,
      platform: vehicle.canonical_platform,
    },
    specs: {
      engine_type: vehicle.engine_type,
      engine_displacement: vehicle.engine_displacement,
      horsepower: vehicle.horsepower,
      torque: vehicle.torque,
      transmission: vehicle.transmission,
      drivetrain: vehicle.drivetrain,
      exterior_color: vehicle.color,
      interior_color: vehicle.interior_color,
      mileage: vehicle.mileage,
    },
    description: vehicle.description || null,
    highlights: vehicle.highlights || null,
    equipment: vehicle.equipment || null,
    modifications: vehicle.modifications || null,
    known_flaws: vehicle.known_flaws || null,
    recent_service_history: vehicle.recent_service_history || null,
    title_status: vehicle.title_status || null,
    documents_on_hand: vehicle.documents_on_hand || null,
    valuation: {
      nuke_estimate: vehicle.nuke_estimate,
      confidence: vehicle.nuke_estimate_confidence,
      deal_score: vehicle.deal_score,
      heat_score: vehicle.heat_score,
      canonical_sold_price: vehicle.canonical_sold_price,
      canonical_outcome: vehicle.canonical_outcome,
      asking_price: vehicle.asking_price,
      sale_price: vehicle.sale_price,
    },
    status: {
      status: vehicle.status,
      auction_status: vehicle.auction_status,
      reserve_status: vehicle.reserve_status,
      data_quality_score: vehicle.data_quality_score,
      image_count: vehicle.image_count,
      observation_count: vehicle.observation_count,
    },
    location: {
      location: vehicle.location,
      city: vehicle.city,
      state: vehicle.state,
      country: vehicle.country,
    },
    links: {
      listing_url: vehicle.listing_url,
      bat_auction_url: vehicle.bat_auction_url,
      primary_image_url: vehicle.primary_image_url,
    },
  };

  if (includeEvents) {
    response.events = results[idx++]?.data || [];
  }

  if (includeObs) {
    const obs = results[idx++]?.data || [];
    const sourcesData = results[idx++]?.data || [];
    const sourceMap = new Map(sourcesData.map((s: any) => [s.id, s]));

    // Enrich observations with source info and flatten structured_data
    const enrichedObs = obs.map((o: any) => {
      const src = sourceMap.get(o.source_id);
      const base: Record<string, unknown> = {
        id: o.id,
        kind: o.kind,
        content_text: o.content_text,
        confidence_score: o.confidence_score,
        observed_at: o.observed_at,
        source_url: o.source_url,
        source_slug: src?.slug,
        source_name: src?.display_name,
        source_trust: src?.base_trust_score,
        source_category: src?.category,
      };

      // Flatten structured_data based on observation kind
      const sd = o.structured_data;
      if (sd && typeof sd === "object") {
        if (o.kind === "condition") {
          base.condition_details = {
            body_condition: sd.body_condition ?? sd.body ?? null,
            frame_condition: sd.frame_condition ?? sd.frame ?? null,
            engine_condition: sd.engine_condition ?? sd.engine ?? null,
            interior_condition: sd.interior_condition ?? sd.interior ?? null,
            paint_condition: sd.paint_condition ?? sd.paint ?? null,
            overall_score: sd.overall_score ?? sd.condition_score ?? null,
            notes: sd.notes ?? sd.condition_notes ?? null,
          };
        } else if (o.kind === "work_record") {
          base.work_details = {
            phases: sd.phases ?? null,
            labor_hours: sd.labor_hours ?? null,
            total_investment: sd.total_investment ?? sd.total_cost ?? null,
            shop: sd.shop ?? sd.performed_by ?? null,
            date_range: sd.date_range ?? null,
            description: sd.description ?? null,
          };
        } else if (o.kind === "valuation") {
          base.valuation_details = {
            estimated_value_low: sd.estimated_value_low ?? sd.low ?? null,
            estimated_value_mid: sd.estimated_value_mid ?? sd.mid ?? sd.estimated_value ?? null,
            estimated_value_high: sd.estimated_value_high ?? sd.high ?? null,
            basis: sd.basis ?? sd.methodology ?? null,
            comparables_used: sd.comparables_used ?? null,
          };
        } else {
          // For other kinds, pass structured_data through as-is
          base.structured_data = sd;
        }
      }

      return base;
    });

    // Summary by source
    const bySource: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const o of enrichedObs) {
      const srcKey = o.source_slug as string || "unknown";
      bySource[srcKey] = (bySource[srcKey] || 0) + 1;
      const kindKey = o.kind as string || "unknown";
      byKind[kindKey] = (byKind[kindKey] || 0) + 1;
    }

    response.observations = {
      total: vehicle.observation_count,
      by_source: bySource,
      by_kind: byKind,
      recent: enrichedObs,
    };
  }

  if (includeImages) {
    const imgs = results[idx++]?.data || [];
    const byZone: Record<string, number> = {};
    for (const img of imgs) {
      const zone = img.angle || "unclassified";
      byZone[zone] = (byZone[zone] || 0) + 1;
    }
    response.images = {
      total: vehicle.image_count,
      fetched: imgs.length,
      by_zone: byZone,
      samples: imgs.slice(0, 10).map((i: any) => ({
        url: i.url,
        angle: i.angle,
        condition_score: i.condition_score,
        quality_score: i.photo_quality_score,
        damage: i.damage_flags,
        modifications: i.modification_flags,
      })),
    };
  }

  if (includeSignals) {
    response.analysis_signals = results[idx++]?.data || [];
  }

  // Comment discoveries
  const commentDisc = results[idx++]?.data || [];
  if (commentDisc.length > 0) {
    response.comment_discoveries = commentDisc.map((cd: any) => ({
      overall_sentiment: cd.overall_sentiment,
      sentiment_score: cd.sentiment_score,
      total_fields: cd.total_fields,
      comment_count: cd.comment_count,
      data_quality_score: cd.data_quality_score,
      model_used: cd.model_used,
      extraction: cd.raw_extraction,
    }));
  }

  // Description discoveries
  const descDisc = results[idx++]?.data || [];
  if (descDisc.length > 0) {
    response.description_discoveries = descDisc.map((dd: any) => ({
      total_fields: dd.total_fields,
      keys_found: dd.keys_found,
      description_length: dd.description_length,
      model_used: dd.model_used,
      extraction: dd.raw_extraction,
    }));
  }

  // Data guidance — helps the AI understand completeness
  const nullFields = ["description", "highlights", "equipment", "modifications", "known_flaws",
    "recent_service_history", "title_status", "documents_on_hand", "mileage", "vin",
    "engine_type", "transmission", "drivetrain"].filter((f) => !vehicle[f]);
  const totalCheckFields = 13;
  const populatedPct = Math.round(((totalCheckFields - nullFields.length) / totalCheckFields) * 100);

  // Determine observation sources
  const obsSources = includeObs
    ? [...new Set((results[1]?.data || []).map((o: any) => {
        const src = sourceMap?.get?.(o.source_id);
        return src?.slug || "unknown";
      }))]
    : [];

  // Count AI-analyzed images
  const analyzedImgCount = includeImages
    ? (results[includeEvents ? (includeObs ? 4 : 2) : (includeObs ? 3 : 1)]?.data || [])
        .filter((i: any) => i.ai_processing_status === "completed").length
    : 0;

  response._data_guidance = {
    null_means: "Data not recorded — do not guess or infer",
    observation_sources: obsSources.length > 0
      ? `Observations from: ${obsSources.join(", ")}`
      : "No observations recorded",
    images_note: `${vehicle.image_count ?? 0} images uploaded, ${analyzedImgCount} AI-analyzed`,
    completeness: `${populatedPct}% of key fields populated — gaps: ${nullFields.length > 0 ? nullFields.join(", ") : "none"}`,
    has_comment_discoveries: commentDisc.length > 0,
    has_description_discoveries: descDisc.length > 0,
  };

  return toolOk(response);
}

async function handleQueryFieldEvidence(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const vid = String(args.vehicle_id);
  const field = String(args.field_name);

  const { data: evidence, error } = await supabase
    .from("vehicle_field_evidence")
    .select("*")
    .eq("vehicle_id", vid)
    .eq("field_name", field)
    .order("confidence_score", { ascending: false });

  if (error) return toolErr(error.message);
  if (!evidence?.length) {
    // Fall back to checking the vehicle record directly
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select(`${field}, ${field}_source, ${field}_confidence`)
      .eq("id", vid)
      .single();

    if (!vehicle) return toolErr("Vehicle not found");
    return toolOk({
      field: field,
      vehicle_id: vid,
      current_value: (vehicle as any)[field],
      source: (vehicle as any)[`${field}_source`] || null,
      confidence: (vehicle as any)[`${field}_confidence`] || null,
      evidence_records: [],
      note: "No detailed evidence records found. Source metadata shown from vehicle record.",
    });
  }

  return toolOk({
    field: field,
    vehicle_id: vid,
    evidence_count: evidence.length,
    evidence: evidence,
  });
}

// ── Observations ────────────────────────────────────────────────────────────

async function handleQueryObservations(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const vid = String(args.vehicle_id);
  const limit = Math.min(Number(args.limit) || 50, 200);
  const offset = Number(args.offset) || 0;

  let query = supabase
    .from("vehicle_observations")
    .select("id, kind, content_text, structured_data, confidence_score, observed_at, source_url, source_id, is_superseded, ingested_at")
    .eq("vehicle_id", vid)
    .eq("is_superseded", false)
    .order("observed_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (args.kind) query = query.eq("kind", args.kind);
  if (args.min_confidence) query = query.gte("confidence_score", args.min_confidence);

  const { data: obs, error } = await query;
  if (error) return toolErr(error.message);

  // Enrich with source info
  const sourceIds = [...new Set((obs || []).map((o: any) => o.source_id).filter(Boolean))];
  let sourceMap = new Map();
  if (sourceIds.length > 0) {
    const { data: sources } = await supabase
      .from("observation_sources")
      .select("id, slug, display_name, category, base_trust_score")
      .in("id", sourceIds);
    sourceMap = new Map((sources || []).map((s: any) => [s.id, s]));
  }

  // If filtering by source slug, we need to resolve the slug to ID
  let filteredObs = obs || [];
  if (args.source) {
    const { data: srcData } = await supabase
      .from("observation_sources")
      .select("id")
      .eq("slug", args.source)
      .single();
    if (srcData) {
      filteredObs = filteredObs.filter((o: any) => o.source_id === srcData.id);
    }
  }

  const enriched = filteredObs.map((o: any) => {
    const src = sourceMap.get(o.source_id);
    return {
      ...o,
      source_slug: src?.slug,
      source_name: src?.display_name,
      source_trust: src?.base_trust_score,
      source_category: src?.category,
    };
  });

  return toolOk({
    vehicle_id: vid,
    count: enriched.length,
    observations: enriched,
  });
}

// ── Market Intelligence ─────────────────────────────────────────────────────

async function handleGetValuation(args: Record<string, unknown>): Promise<ToolResult> {
  const params = new URLSearchParams();
  if (args.vehicle_id) params.set("vehicle_id", String(args.vehicle_id));
  if (args.vin) params.set("vin", String(args.vin));
  const data = await callEdgeApi("valuations", `?${params}`);
  return toolOk(data);
}

async function handleComputeValuation(args: Record<string, unknown>): Promise<ToolResult> {
  const data = await callEdgeFn("compute-vehicle-valuation", {
    vehicle_id: args.vehicle_id,
    force: args.force ?? false,
  });
  return toolOk(data);
}

async function handleGetComps(args: Record<string, unknown>): Promise<ToolResult> {
  const body: Record<string, unknown> = {};
  for (const k of ["make", "model", "year", "year_range", "vehicle_id", "vin", "limit"]) {
    if (args[k] !== undefined) body[k] = args[k];
  }
  const data = await callEdgeApi("comps", "", "POST", body);
  return toolOk(data);
}

async function handleQueryMarketHistory(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const limit = Number(args.limit) || 50;

  let query = supabase
    .from("vehicle_events")
    .select("id, vehicle_id, source_platform, source_url, event_type, event_status, started_at, ended_at, sold_at, final_price, starting_price, bid_count, comment_count, view_count, seller_identifier, buyer_identifier")
    .order("ended_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (args.vehicle_id) {
    query = query.eq("vehicle_id", args.vehicle_id);
  } else {
    // Cohort query: join through vehicles table
    if (args.make || args.model || args.year_from || args.year_to) {
      // For cohort, we need to get vehicle IDs first
      let vQuery = supabase.from("vehicles").select("id");
      if (args.make) vQuery = vQuery.ilike("make", String(args.make));
      if (args.model) vQuery = vQuery.ilike("model", `%${args.model}%`);
      if (args.year_from) vQuery = vQuery.gte("year", args.year_from);
      if (args.year_to) vQuery = vQuery.lte("year", args.year_to);
      const { data: vehicleIds } = await vQuery.limit(500);
      if (vehicleIds?.length) {
        query = query.in("vehicle_id", vehicleIds.map((v: any) => v.id));
      } else {
        return toolOk({ events: [], count: 0 });
      }
    }
  }

  const { data, error } = await query;
  if (error) return toolErr(error.message);
  return toolOk({ events: data || [], count: data?.length ?? 0 });
}

// ── Reference Library ───────────────────────────────────────────────────────

async function handleQueryLibrary(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const type = String(args.type);
  const limit = Number(args.limit) || 25;

  let query = supabase.from(type as any).select("*").limit(limit);

  if (args.query) {
    // Text search depends on table structure
    // Multi-column text search per table type
    const searchCols: Record<string, string[]> = {
      paint_codes: ["name", "code", "color_family"],
      condition_knowledge: ["spec_name", "component", "sub_component", "symptom"],
      condition_taxonomy: ["name"],
      vehicle_nomenclature: ["term"],
    };
    const cols = searchCols[type] || [];
    if (cols.length === 1) {
      query = query.ilike(cols[0], `%${args.query}%`);
    } else if (cols.length > 1) {
      // Use or filter across multiple columns
      const orFilter = cols.map((c) => `${c}.ilike.%${args.query}%`).join(",");
      query = query.or(orFilter);
    }
  }

  if (args.make) {
    query = query.ilike("make", String(args.make));
  }

  const { data, error } = await query;
  if (error) return toolErr(error.message);
  return toolOk({ type, count: data?.length ?? 0, results: data || [] });
}

async function handleSearchServiceManuals(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const limit = Number(args.limit) || 10;
  const q = String(args.query);

  // Use text search on service_manual_chunks
  const { data, error } = await supabase
    .from("service_manual_chunks")
    .select("*")
    .textSearch("content", q, { type: "websearch" })
    .limit(limit);

  if (error) {
    // Fallback to ilike if text search not configured
    const { data: fallback, error: e2 } = await supabase
      .from("service_manual_chunks")
      .select("*")
      .ilike("content", `%${q}%`)
      .limit(limit);
    if (e2) return toolErr(e2.message);
    return toolOk({ query: q, count: fallback?.length ?? 0, chunks: fallback || [] });
  }

  return toolOk({ query: q, count: data?.length ?? 0, chunks: data || [] });
}

// ── Vision ──────────────────────────────────────────────────────────────────

async function handleAnalyzeImage(args: Record<string, unknown>): Promise<ToolResult> {
  const data = await callEdgeApi("vision", "/analyze", "POST", {
    image_url: args.image_url,
    include_comps: args.include_comps ?? false,
  });
  return toolOk(data);
}

async function handleIdentifyVehicleImage(args: Record<string, unknown>): Promise<ToolResult> {
  const data = await callEdgeFn("identify-vehicle-from-image", {
    image_url: args.image_url,
    ...(args.context ? { context: args.context } : {}),
  });
  return toolOk(data);
}

async function handleQueryVehicleImages(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const vid = String(args.vehicle_id);
  const limit = Math.min(Number(args.limit) || 20, 100);

  let query = supabase
    .from("vehicle_images")
    .select("id, url, angle, condition_score, photo_quality_score, ai_processing_status, damage_flags, modification_flags, fabrication_stage, vision_analyzed_at, created_at")
    .eq("vehicle_id", vid)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (args.zone) {
    query = query.eq("angle", args.zone);
  }

  const { data, error } = await query;
  if (error) return toolErr(error.message);
  return toolOk({ vehicle_id: vid, count: data?.length ?? 0, images: data || [] });
}

// ── Actors & Organizations ──────────────────────────────────────────────────

async function handleSearchOrganizations(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const limit = Number(args.limit) || 20;

  let query = supabase
    .from("organizations")
    .select("id, name, slug, business_type, website, city, state, country, description, created_at")
    .limit(limit);

  if (args.query) {
    query = query.ilike("name", `%${args.query}%`);
  }
  if (args.type) {
    query = query.eq("business_type", String(args.type));
  }
  if (args.location) {
    const loc = String(args.location);
    query = query.or(`city.ilike.%${loc}%,state.ilike.%${loc}%`);
  }

  const { data, error } = await query;
  if (error) return toolErr(error.message);
  return toolOk({ count: data?.length ?? 0, organizations: data || [] });
}

async function handleGetOrganization(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const oid = String(args.org_id);

  const [org, vehicleCount, locations] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", oid).single(),
    supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("selling_organization_id", oid),
    supabase.from("organization_locations").select("*").eq("organization_id", oid),
  ]);

  if (org.error) return toolErr(org.error.message);
  return toolOk({
    ...org.data,
    vehicle_count: vehicleCount.count ?? 0,
    locations: locations.data || [],
  });
}

// ── Ingestion ───────────────────────────────────────────────────────────────

async function handleExtractListing(args: Record<string, unknown>): Promise<ToolResult> {
  const data = await callEdgeFn("extract-vehicle-data-ai", {
    url: args.url,
    source: args.source,
  });
  return toolOk(data);
}

async function handleSubmitObservation(args: Record<string, unknown>): Promise<ToolResult> {
  const data = await callEdgeFn("ingest-observation", {
    vehicle_id: args.vehicle_id,
    source_slug: args.source_slug,
    kind: args.kind,
    content_text: args.content_text || null,
    structured_data: args.structured_data || {},
    confidence_score: args.confidence_score || 0.5,
    source_url: args.source_url || null,
  });
  return toolOk(data);
}

// ── Auction Readiness ────────────────────────────────────────────────────────

async function handleGetAuctionReadiness(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const supabase = sb();
  let vehicleId = args.vehicle_id as string | undefined;

  if (!vehicleId && args.vin) {
    const { data } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", String(args.vin))
      .eq("status", "active")
      .limit(1)
      .single();
    if (!data) return toolErr(`No active vehicle found for VIN: ${args.vin}`);
    vehicleId = data.id;
  }
  if (!vehicleId) return toolErr("Provide vehicle_id or vin");

  const { data: cached } = await supabase
    .from("auction_readiness")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .single();

  if (cached && !cached.is_stale) {
    const { data: v } = await supabase
      .from("vehicles")
      .select("year, make, model, vin, trim")
      .eq("id", vehicleId)
      .single();
    return toolOk({ ...cached, vehicle: v });
  }

  const { data: result, error } = await supabase.rpc(
    "persist_auction_readiness",
    { p_vehicle_id: vehicleId },
  );
  if (error) return toolErr(error.message);

  const { data: v } = await supabase
    .from("vehicles")
    .select("year, make, model, vin, trim")
    .eq("id", vehicleId)
    .single();

  return toolOk({ ...result, vehicle: v });
}

async function handleGetCoachingPlan(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const supabase = sb();
  const vehicleId = args.vehicle_id as string;
  if (!vehicleId) return toolErr("vehicle_id required");

  let { data: ars } = await supabase
    .from("auction_readiness")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .single();

  if (!ars) {
    await supabase.rpc("persist_auction_readiness", {
      p_vehicle_id: vehicleId,
    });
    const res = await supabase
      .from("auction_readiness")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .single();
    ars = res.data;
  }
  if (!ars) return toolErr("Could not compute ARS for this vehicle");

  const { data: v } = await supabase
    .from("vehicles")
    .select("year, make, model, vin, trim")
    .eq("id", vehicleId)
    .single();

  const { data: zones } = await supabase
    .from("photo_coverage_requirements")
    .select("*")
    .eq("platform", "universal")
    .order("sort_position");

  const missingZones = (ars.photo_zones_missing || []).map((z: string) => {
    const req = zones?.find((r: Record<string, unknown>) => r.zone === z);
    return {
      zone: z,
      requirement: req?.requirement || "unknown",
      points: req?.points || 0,
      coaching: req?.coaching_prompt || null,
    };
  });

  return toolOk({
    vehicle: v,
    current_score: ars.composite_score,
    current_tier: ars.tier,
    dimensions: {
      identity: ars.identity_score,
      photos: ars.photo_score,
      documentation: ars.doc_score,
      description: ars.desc_score,
      market: ars.market_score,
      condition: ars.condition_score,
    },
    coaching_plan: ars.coaching_plan,
    missing_photo_zones: missingZones,
    mvps_complete: ars.mvps_complete,
    _note:
      "Actions are sorted by impact (points gained). Focus on the top items first.",
  });
}

async function handlePrepareListing(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const supabase = sb();
  const vehicleId = args.vehicle_id as string;
  const platform = (args.platform as string) || "bat";
  if (!vehicleId) return toolErr("vehicle_id required");

  let { data: ars } = await supabase
    .from("auction_readiness")
    .select("composite_score, tier")
    .eq("vehicle_id", vehicleId)
    .single();

  if (!ars) {
    await supabase.rpc("persist_auction_readiness", {
      p_vehicle_id: vehicleId,
    });
    const res = await supabase
      .from("auction_readiness")
      .select("composite_score, tier")
      .eq("vehicle_id", vehicleId)
      .single();
    ars = res.data;
  }

  const tierWarning =
    ars?.tier === "AUCTION_READY"
      ? null
      : ars?.tier === "NEARLY_READY"
        ? "Vehicle is NEARLY_READY — listing may have gaps. Review coaching plan."
        : `Vehicle is ${ars?.tier || "UNKNOWN"} — not recommended for submission yet. Run get_coaching_plan first.`;

  const { data: v, error: vErr } = await supabase
    .from("vehicles")
    .select(
      "id, year, make, model, trim, vin, engine_type, engine_code, transmission, " +
        "drivetrain, body_style, mileage, condition_rating, title_status, " +
        "description, highlights, equipment, modifications, known_flaws, recent_service_history, " +
        "documents_on_hand, city, state, location, " +
        "nuke_estimate, nuke_estimate_confidence, deal_score, heat_score, " +
        "sale_price, asking_price, primary_image_url, listing_url",
    )
    .eq("id", vehicleId)
    .single();
  if (vErr || !v) return toolErr(vErr?.message || "Vehicle not found");

  const { data: photos } = await supabase
    .from("vehicle_images")
    .select(
      "id, image_url, vehicle_zone, photo_quality_score, caption, display_order",
    )
    .eq("vehicle_id", vehicleId)
    .or("is_duplicate.is.null,is_duplicate.eq.false")
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("photo_quality_score", { ascending: false, nullsFirst: true })
    .limit(100);

  const { data: valuation } = await supabase
    .from("nuke_estimates")
    .select(
      "estimated_value, value_low, value_high, confidence_score, deal_score, heat_score, price_tier",
    )
    .eq("vehicle_id", vehicleId)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .single();

  return toolOk({
    platform,
    tier_warning: tierWarning,
    ars_score: ars?.composite_score,
    vehicle: {
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim,
      vin: v.vin,
      engine: v.engine_type,
      engine_code: v.engine_code,
      transmission: v.transmission,
      drivetrain: v.drivetrain,
      body_style: v.body_style,
      mileage: v.mileage,
      condition_rating: v.condition_rating,
      title_status: v.title_status,
      location:
        [v.city, v.state].filter(Boolean).join(", ") || v.location,
    },
    listing_content: {
      title: `${v.year} ${v.make} ${v.model}${v.trim ? " " + v.trim : ""}`,
      description: v.description,
      highlights: v.highlights,
      equipment: v.equipment,
      modifications: v.modifications,
      known_flaws: v.known_flaws,
      recent_service_history: v.recent_service_history,
      documents_on_hand: v.documents_on_hand,
    },
    photos: {
      count: photos?.length || 0,
      hero_image: v.primary_image_url,
      ordered: photos?.map((p: Record<string, unknown>) => ({
        url: p.image_url,
        zone: p.vehicle_zone,
        quality: p.photo_quality_score,
        caption: p.caption,
      })),
    },
    valuation: valuation || null,
    _note:
      "This is a preview package. Full AI description generation and platform-specific formatting available in prepare_listing v2.",
  });
}

// ── Photo Ingest Handler ────────────────────────────────────────────────────

async function handleIngestPhotos(args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = sb();
  const images = args.images as Array<{
    url?: string; base64?: string; filename?: string;
    taken_at?: string; latitude?: number; longitude?: number; caption?: string;
  }>;
  const vehicleId = args.vehicle_id as string | undefined;
  const vehicleHint = args.vehicle_hint as { year?: number; make?: string; model?: string; vin?: string; color?: string } | undefined;
  const userId = args.user_id as string | undefined;
  const source = (args.source as string) || "ai_ingest";

  if (!images || !Array.isArray(images) || images.length === 0) {
    return toolErr("images array required with at least one image (url or base64)");
  }

  if (images.length > 100) {
    return toolErr(`Too many images in one call (${images.length}). Maximum 100. Split into multiple calls.`);
  }

  // If we have a vehicle hint but no ID, try to find/create the vehicle
  let resolvedVehicleId = vehicleId || null;
  if (!resolvedVehicleId && vehicleHint) {
    const { year, make, model, vin } = vehicleHint;
    // Try VIN match first
    if (vin) {
      const { data } = await supabase.from("vehicles").select("id").eq("vin", vin).limit(1).single();
      if (data) resolvedVehicleId = data.id;
    }
    // Then YMM match
    if (!resolvedVehicleId && year && make) {
      let q = supabase.from("vehicles").select("id").eq("year", year).ilike("make", make);
      if (model) q = q.ilike("model", `%${model}%`);
      const { data } = await q.limit(1).single();
      if (data) resolvedVehicleId = data.id;
    }
  }

  // Upload each image: base64 → storage, or pass URL directly
  const results: Array<{ filename: string; status: string; error?: string }> = [];
  let uploaded = 0, errors = 0;

  for (let i = 0; i < images.length; i += 10) {
    const batch = images.slice(i, i + 10);
    await Promise.all(batch.map(async (img, idx) => {
      const filename = img.filename || `photo_${i + idx + 1}.jpg`;
      try {
        let imageUrl: string;

        if (img.base64) {
          // Upload base64 to storage
          const raw = img.base64.replace(/^data:image\/\w+;base64,/, "");
          const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
          const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
          const mime = ext === "png" ? "image/png" : "image/jpeg";
          const vehicleDir = resolvedVehicleId || "unassigned";
          const storagePath = `${vehicleDir}/${source}/${filename}`;

          const { error: uploadErr } = await supabase.storage
            .from("vehicle-photos")
            .upload(storagePath, bytes, { contentType: mime, upsert: true });

          if (uploadErr) {
            results.push({ filename, status: "error", error: uploadErr.message });
            errors++;
            return;
          }
          const { data: { publicUrl } } = supabase.storage.from("vehicle-photos").getPublicUrl(storagePath);
          imageUrl = publicUrl;
        } else if (img.url) {
          imageUrl = img.url;
        } else {
          results.push({ filename, status: "error", error: "No url or base64 provided" });
          errors++;
          return;
        }

        // Insert into vehicle_images
        const row: Record<string, unknown> = {
          image_url: imageUrl,
          source,
          file_name: filename,
          is_external: !img.base64,
          ai_processing_status: "pending",
          ...(resolvedVehicleId && { vehicle_id: resolvedVehicleId }),
          ...(userId && { documented_by_user_id: userId }),
          ...(img.taken_at && { taken_at: img.taken_at }),
          ...(img.latitude != null && { latitude: img.latitude }),
          ...(img.longitude != null && { longitude: img.longitude }),
          ...(img.caption && { caption: img.caption }),
        };

        const { error: insertErr } = await supabase.from("vehicle_images").insert(row);
        if (insertErr && !insertErr.message.includes("duplicate")) {
          results.push({ filename, status: "error", error: insertErr.message });
          errors++;
        } else {
          results.push({ filename, status: "ok" });
          uploaded++;
        }
      } catch (e) {
        results.push({ filename, status: "error", error: e instanceof Error ? e.message : String(e) });
        errors++;
      }
    }));
  }

  // Get vehicle info for response
  let vehicleInfo = null;
  if (resolvedVehicleId) {
    const { data: v } = await supabase.from("vehicles")
      .select("year, make, model, vin")
      .eq("id", resolvedVehicleId).single();
    if (v) vehicleInfo = { id: resolvedVehicleId, ...v };
  }

  return toolOk({
    uploaded,
    errors,
    total: images.length,
    vehicle: vehicleInfo || (resolvedVehicleId ? { id: resolvedVehicleId } : null),
    vehicle_matched: !!resolvedVehicleId,
    vehicle_hint_used: !vehicleId && !!vehicleHint,
    results: results.length <= 20 ? results : results.filter(r => r.status === "error").slice(0, 10),
    _note: resolvedVehicleId
      ? `${uploaded} photos linked to vehicle. AI classification will run automatically.`
      : `${uploaded} photos uploaded as unassigned. Use search_vehicles to find the vehicle, then call ingest_photos again with vehicle_id.`,
  });
}

// =============================================================================
// TOOL DISPATCH
// =============================================================================

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  describe_platform: handleDescribePlatform,
  describe_schema: handleDescribeSchema,
  get_pipeline_registry: handleGetPipelineRegistry,
  search_vehicles: handleSearchVehicles,
  search_vehicles_advanced: handleSearchVehiclesAdvanced,
  browse_inventory: handleBrowseInventory,
  get_vehicle: handleGetVehicle,
  query_vehicle_deep: handleQueryVehicleDeep,
  query_field_evidence: handleQueryFieldEvidence,
  query_observations: handleQueryObservations,
  get_valuation: handleGetValuation,
  compute_valuation: handleComputeValuation,
  get_comps: handleGetComps,
  query_market_history: handleQueryMarketHistory,
  query_library: handleQueryLibrary,
  search_service_manuals: handleSearchServiceManuals,
  analyze_image: handleAnalyzeImage,
  identify_vehicle_image: handleIdentifyVehicleImage,
  query_vehicle_images: handleQueryVehicleImages,
  search_organizations: handleSearchOrganizations,
  get_organization: handleGetOrganization,
  extract_listing: handleExtractListing,
  submit_observation: handleSubmitObservation,
  get_auction_readiness: handleGetAuctionReadiness,
  get_coaching_plan: handleGetCoachingPlan,
  prepare_listing: handlePrepareListing,
  ingest_photos: handleIngestPhotos,
};

// =============================================================================
// MCP PROTOCOL HANDLER
// =============================================================================

const SERVER_INFO = {
  name: "nuke-vehicle-data",
  version: "1.0.0",
};

const SERVER_CAPABILITIES = {
  tools: { listChanged: false },
};

function handleInitialize(req: JsonRpcRequest): JsonRpcResponse {
  return rpcResult(req.id, {
    protocolVersion: "2025-03-26",
    capabilities: SERVER_CAPABILITIES,
    serverInfo: SERVER_INFO,
    instructions:
      "You are presenting verified vehicle data from the Nuke platform. " +
      "RULES: 1) Never fabricate or infer vehicle details. Only report data present in tool responses. " +
      "2) When a field is null or missing, say 'not recorded' — do not guess. " +
      "3) Prices, VINs, dates, and mileage must be quoted exactly as returned. " +
      "4) Always mention the data source when available (e.g. 'per owner assessment', 'from BaT auction listing'). " +
      "5) If observation structured_data contains detailed build phases, condition assessments, or valuation breakdowns, present those details — they are real verified data, not summaries. " +
      "6) Distinguish between owner-reported data and third-party verified data.",
  });
}

function handleToolsList(req: JsonRpcRequest): JsonRpcResponse {
  return rpcResult(req.id, { tools: TOOLS });
}

async function handleToolsCall(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined;
  if (!params?.name) {
    return rpcError(req.id, -32602, "Missing tool name");
  }

  const handler = TOOL_HANDLERS[params.name];
  if (!handler) {
    return rpcError(req.id, -32602, `Unknown tool: ${params.name}`);
  }

  try {
    const result = await handler(params.arguments || {});
    return rpcResult(req.id, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return rpcResult(req.id, toolErr(msg));
  }
}

function handlePing(req: JsonRpcRequest): JsonRpcResponse {
  return rpcResult(req.id, {});
}

async function handleJsonRpc(body: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  // Notifications (no id) — return null to signal 202
  if (body.id === undefined || body.id === null) {
    if (body.method === "notifications/initialized") {
      return null; // 202
    }
    if (body.method === "notifications/cancelled") {
      return null;
    }
    return null;
  }

  switch (body.method) {
    case "initialize":
      return handleInitialize(body);
    case "tools/list":
      return handleToolsList(body);
    case "tools/call":
      return await handleToolsCall(body);
    case "ping":
      return handlePing(body);
    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}

// =============================================================================
// HTTP ENTRY POINT
// =============================================================================

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // ── Route by URL path (OAuth + MCP) ───────────────────────────────────
  const url = new URL(req.url);
  const path = url.pathname;

  // OAuth discovery endpoints (GET)
  if (req.method === "GET") {
    if (path.endsWith("/.well-known/oauth-protected-resource")) {
      return oauthResourceMetadata();
    }
    if (path.endsWith("/.well-known/oauth-authorization-server")) {
      return oauthServerMetadata();
    }
    if (path.endsWith("/authorize")) {
      return await oauthAuthorize(req);
    }
    // GET on root = SSE stream (required by MCP Streamable HTTP spec)
    // Return an open SSE connection that sends a keepalive then closes
    return new Response(
      "event: message\ndata: {}\n\n",
      { status: 200, headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  // OAuth token + registration endpoints (POST)
  if (req.method === "POST") {
    if (path.endsWith("/token")) {
      return await oauthToken(req);
    }
    if (path.endsWith("/register")) {
      return await oauthRegister(req);
    }
  }

  // DELETE for session termination
  if (req.method === "DELETE") {
    return new Response(null, { status: 200, headers: CORS });
  }

  // Everything else below is MCP protocol (POST only)
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: CORS });
  }

  // Log incoming request details for debugging proxy issues
  const reqAccept = req.headers.get("Accept") || "";
  const reqUA = req.headers.get("User-Agent") || "";
  const reqMcpVer = req.headers.get("Mcp-Protocol-Version") || "";
  console.log(`[MCP] POST Accept="${reqAccept}" UA="${reqUA.slice(0,60)}" MCP-Ver="${reqMcpVer}"`);

  // Parse JSON-RPC request
  let body: JsonRpcRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify(rpcError(undefined, -32700, "Parse error")),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  // Auth — optional for now (permissive mode for testing).
  // When auth is present, it's verified. When absent, requests proceed anyway.
  // TODO: enforce auth for tools/call once OAuth flow through Vercel proxy is debugged.
  if (body.method === "tools/call") {
    const authHeader = req.headers.get("Authorization");
    const apiKey = req.headers.get("X-API-Key");
    if (authHeader || apiKey) {
      const auth = await authenticate(req);
      if (!auth.ok) {
        return new Response(
          JSON.stringify(rpcError(body.id, -32000, auth.error || "Unauthorized")),
          {
            status: auth.status || 401,
            headers: {
              ...CORS,
              "Content-Type": "application/json",
              "WWW-Authenticate": `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
            },
          },
        );
      }
    }
  }

  // Route to MCP handler
  const response = await handleJsonRpc(body);

  // Notifications get 202 (no body)
  if (response === null) {
    return new Response(null, { status: 202, headers: CORS });
  }

  // Generate session ID on initialize
  const baseHeaders: Record<string, string> = { ...CORS };
  if (body.method === "initialize") {
    baseHeaders["Mcp-Session-Id"] = crypto.randomUUID();
  }

  // MCP Streamable HTTP: check Accept header to decide response format.
  // If client prefers text/event-stream (SSE), wrap response in SSE format.
  // Anthropic's MCP proxy expects SSE for tool call responses.
  const accept = req.headers.get("Accept") || "";
  const wantSSE = accept.includes("text/event-stream");

  if (wantSSE) {
    const ssePayload = `event: message\ndata: ${JSON.stringify(response)}\n\n`;
    return new Response(ssePayload, {
      status: 200,
      headers: { ...baseHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...baseHeaders, "Content-Type": "application/json" },
  });
});
