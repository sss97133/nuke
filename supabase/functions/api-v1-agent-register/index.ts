/**
 * API v1 - Agent Registration & Discovery
 *
 * GET  → Discovery manifest (no auth required)
 * POST → Self-register agent, get Tier 1 API key
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
import { checkRateLimit, getClientIp, rateLimitResponse } from "../_shared/rateLimit.ts";
import { hashApiKey } from "../_shared/apiKeyAuth.ts";

/** Generate a secure random API key (same pattern as api-keys-manage) */
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

/** Generate a short nanoid-style ID */
function nanoid(size = 12): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const array = new Uint8Array(size);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

const VALID_KINDS = [
  'listing', 'sale_result', 'comment', 'bid', 'sighting', 'work_record',
  'ownership', 'specification', 'provenance', 'valuation', 'condition',
  'media', 'social_mention', 'expert_opinion',
];

const DISCOVERY_MANIFEST = {
  platform: {
    name: 'Nuke',
    version: 'v1',
    description: 'Vehicle data platform — collector vehicle intelligence',
  },
  trust_tiers: {
    1: {
      name: 'Sandbox',
      rate_limit_per_hour: 100,
      scopes: ['read', 'stage_write'],
      write_target: 'agent_submissions_staging',
      batch_cap: 10,
      promotion: 'Auto: 50+ accepted submissions at 80%+ acceptance rate',
    },
    2: {
      name: 'Contributor',
      rate_limit_per_hour: 1000,
      scopes: ['read', 'write', 'batch'],
      write_target: 'vehicle_observations (direct)',
      batch_cap: 100,
      promotion: 'Manual review: 500+ accepted at 95%+ rate',
    },
    3: {
      name: 'Trusted',
      rate_limit_per_hour: 5000,
      scopes: ['read', 'write', 'batch'],
      write_target: 'vehicle_observations (direct)',
      batch_cap: 1000,
      promotion: null,
    },
  },
  endpoints: [
    { method: 'GET', path: '/api-v1-agent-register', auth: false, description: 'Discovery manifest' },
    { method: 'POST', path: '/api-v1-agent-register', auth: false, description: 'Self-register agent' },
    { method: 'GET', path: '/api-v1-observations', auth: true, description: 'List observations for a vehicle' },
    { method: 'POST', path: '/api-v1-observations', auth: true, description: 'Submit an observation' },
    { method: 'POST', path: '/api-v1-batch', auth: true, description: 'Batch import vehicles + observations' },
    { method: 'GET', path: '/api-v1-agent-metrics', auth: true, description: 'Agent quality dashboard' },
    { method: 'POST', path: '/api-v1-agent-metrics', auth: true, description: 'Heartbeat' },
  ],
  observation_kinds: VALID_KINDS,
  vehicle_hints_schema: {
    description: 'Hints for resolving vehicle identity when vehicle_id is unknown',
    fields: {
      vin: { type: 'string', description: 'VIN (preferred, highest confidence)' },
      year: { type: 'number', description: 'Model year' },
      make: { type: 'string', description: 'Manufacturer' },
      model: { type: 'string', description: 'Model name' },
      url: { type: 'string', description: 'Source listing URL' },
    },
  },
  observation_schema: {
    required: ['source_id', 'kind', 'structured_data'],
    optional: ['vehicle_id', 'vehicle_hints', 'observed_at', 'content_text', 'confidence_score', 'source_url', 'source_identifier'],
  },
  registration: {
    url: '/api-v1-agent-register',
    method: 'POST',
    required_fields: ['name', 'capabilities'],
    optional_fields: ['description', 'platform', 'model_identifier', 'version', 'makes_covered', 'regions_covered', 'contact_url', 'webhook_url'],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // GET — Discovery manifest (no auth)
    if (req.method === "GET") {
      return new Response(
        JSON.stringify(DISCOVERY_MANIFEST),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
          },
        }
      );
    }

    // POST — Agent self-registration
    if (req.method === "POST") {
      // IP rate limit: 5 registrations per hour
      const clientIp = getClientIp(req);
      const rl = await checkRateLimit(supabase, clientIp, {
        namespace: 'agent-register',
        windowSeconds: 3600,
        maxRequests: 5,
      });
      if (!rl.allowed) {
        return rateLimitResponse(rl, corsHeaders, 5);
      }

      let body: {
        name?: string;
        description?: string;
        platform?: string;
        model_identifier?: string;
        version?: string;
        capabilities?: string[];
        makes_covered?: string[];
        regions_covered?: string[];
        contact_url?: string;
        webhook_url?: string;
      };

      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid JSON body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate name
      if (!body.name || body.name.length < 3 || body.name.length > 100) {
        return new Response(
          JSON.stringify({ error: "name is required (3-100 characters)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate capabilities
      if (!body.capabilities || !Array.isArray(body.capabilities) || body.capabilities.length === 0) {
        return new Response(
          JSON.stringify({ error: "capabilities must be a non-empty array of observation kinds", valid_kinds: VALID_KINDS }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const invalidCaps = body.capabilities.filter(c => !VALID_KINDS.includes(c));
      if (invalidCaps.length > 0) {
        return new Response(
          JSON.stringify({ error: `Invalid capabilities: ${invalidCaps.join(', ')}`, valid_kinds: VALID_KINDS }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check name uniqueness
      const { data: existing } = await supabase
        .from("agent_registrations")
        .select("id")
        .eq("name", body.name)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: `Agent name '${body.name}' is already registered` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Generate IDs
      const agentId = `ag_${nanoid()}`;
      const slug = `agent-${nanoid(8)}`;

      // Transaction: create observation_source → agent_registration → api_key → quality_metrics → audit_log
      // Step 1: Create observation source
      const { data: obsSource, error: osError } = await supabase
        .from("observation_sources")
        .insert({
          slug,
          display_name: `Agent: ${body.name}`,
          category: 'agent',
          base_trust_score: 0.30,
          supported_observations: body.capabilities,
          makes_covered: body.makes_covered || null,
          regions_covered: body.regions_covered || null,
          notes: body.description || null,
        })
        .select("id")
        .single();

      if (osError) {
        console.error('[agent-register] Failed to create observation_source:', osError);
        throw osError;
      }

      // Step 2: Generate + hash API key
      const rawKey = generateApiKey();
      const keyPrefix = rawKey.substring(0, 8);
      const keyHash = await hashApiKey(rawKey);

      // Step 3: Create agent registration (without api_key_id for now)
      const { error: arError } = await supabase
        .from("agent_registrations")
        .insert({
          id: agentId,
          name: body.name,
          description: body.description || null,
          platform: body.platform || null,
          model_identifier: body.model_identifier || null,
          version: body.version || null,
          capabilities: body.capabilities,
          makes_covered: body.makes_covered || null,
          regions_covered: body.regions_covered || null,
          contact_url: body.contact_url || null,
          webhook_url: body.webhook_url || null,
          trust_tier: 1,
          status: 'active',
          observation_source_id: obsSource.id,
          registered_from_ip: clientIp,
        });

      if (arError) {
        console.error('[agent-register] Failed to create agent_registration:', arError);
        throw arError;
      }

      // Step 4: Create API key linked to agent
      const { data: apiKey, error: akError } = await supabase
        .from("api_keys")
        .insert({
          user_id: null, // agents don't have auth users
          name: `Agent: ${body.name}`,
          key_hash: keyHash,
          key_prefix: keyPrefix,
          scopes: ['read', 'stage_write'],
          is_active: true,
          rate_limit_per_hour: 100,
          rate_limit_remaining: 100,
          agent_registration_id: agentId,
        })
        .select("id")
        .single();

      if (akError) {
        console.error('[agent-register] Failed to create api_key:', akError);
        throw akError;
      }

      // Step 5: Link api_key_id back to agent
      await supabase
        .from("agent_registrations")
        .update({ api_key_id: apiKey.id })
        .eq("id", agentId);

      // Step 6: Create quality metrics row
      await supabase
        .from("agent_quality_metrics")
        .insert({ agent_id: agentId });

      // Step 7: Audit log
      await supabase
        .from("agent_audit_log")
        .insert({
          agent_id: agentId,
          action: 'register',
          detail: {
            name: body.name,
            capabilities: body.capabilities,
            platform: body.platform,
            ip: clientIp,
          },
          endpoint: '/api-v1-agent-register',
          ip_address: clientIp,
        });

      return new Response(
        JSON.stringify({
          agent_id: agentId,
          api_key: `nk_live_${rawKey}`,
          source_id: obsSource.id,
          trust_tier: 1,
          scopes: ['read', 'stage_write'],
          rate_limit_per_hour: 100,
          message: "Agent registered successfully. Save your API key — it will not be shown again.",
          next_steps: [
            "Set X-API-Key header with your key for all requests",
            "POST observations to /api-v1-observations (writes to staging for review)",
            "Check your metrics at GET /api-v1-agent-metrics",
            "After 50 accepted observations at 80%+ rate, you'll auto-promote to Tier 2 (direct writes)",
          ],
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[agent-register] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
