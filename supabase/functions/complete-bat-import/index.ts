import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    // ignore non-JSON
  }
  return { ok: resp.ok, status: resp.status, text, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const batUrl = String(body?.bat_url || body?.batUrl || body?.url || '').trim();
    const organizationId = String(body?.organization_id || body?.organizationId || body?.organization_id || '').trim();

    if (!batUrl || !batUrl.includes('bringatrailer.com/listing/')) {
      return json(400, { success: false, error: 'bat_url must be a Bring a Trailer listing URL' });
    }

    // ✅ Approved BaT workflow:
    // 1) extract-premium-auction (core: VIN/specs/images/auction_events)
    // 2) extract-auction-comments (comments/bids) (non-critical)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return json(500, { success: false, error: 'Server not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)' });
    }

    const fnBase = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;
    const invokeHeaders = { Authorization: `Bearer ${serviceKey}` };
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Step 1: core extraction
    const step1 = await postJson(
      `${fnBase}/extract-premium-auction`,
      invokeHeaders,
      { url: batUrl, max_vehicles: 1 },
      120_000,
    );

    if (!step1.ok) {
      return json(step1.status, {
        success: false,
        error: 'extract-premium-auction HTTP error',
        status: step1.status,
        details: step1.data ?? step1.text.slice(0, 500),
      });
    }
    if (!step1.data?.success) {
      return json(500, {
        success: false,
        error: 'extract-premium-auction failed',
        details: step1.data ?? null,
      });
    }

    const vehicleId =
      step1.data?.created_vehicle_ids?.[0] ||
      step1.data?.updated_vehicle_ids?.[0] ||
      step1.data?.vehicle_id ||
      null;

    // Best-effort org link (seller relationship)
    let orgLink: { attempted: boolean; ok?: boolean; error?: string } = { attempted: false };
    if (vehicleId && organizationId) {
      orgLink.attempted = true;
      try {
        const { error: linkErr } = await admin.from('organization_vehicles').upsert(
          {
            organization_id: organizationId,
            vehicle_id: vehicleId,
            relationship_type: 'seller',
            status: 'active',
            auto_tagged: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,vehicle_id,relationship_type' },
        );
        if (linkErr) throw linkErr;
        orgLink.ok = true;
      } catch (e: any) {
        orgLink.ok = false;
        orgLink.error = e?.message || String(e);
      }
    }

    // Pull a tiny listing summary for UI display
    let listing: any = null;
    if (vehicleId) {
      try {
        const { data: vrow, error: vErr } = await admin
          .from('vehicles')
          .select('id,title,year,make,model,sale_price,sale_status,bat_auction_url,listing_url,discovery_url')
          .eq('id', vehicleId)
          .maybeSingle();
        if (!vErr && vrow) {
          listing = {
            id: vrow.id,
            title: vrow.title,
            year: vrow.year,
            make: vrow.make,
            model: vrow.model,
            salePrice: vrow.sale_price,
            saleStatus: vrow.sale_status,
            url: vrow.bat_auction_url || vrow.listing_url || vrow.discovery_url || batUrl,
          };
        }
      } catch {
        // non-blocking
      }
    }

    // Step 2: comments/bids (best-effort)
    let step2: { ok: boolean; status: number; data: any } | null = null;
    if (vehicleId) {
      try {
        const res2 = await postJson(
          `${fnBase}/extract-auction-comments`,
          invokeHeaders,
          { auction_url: batUrl, vehicle_id: vehicleId },
          45_000,
        );
        step2 = { ok: res2.ok, status: res2.status, data: res2.data ?? null };
      } catch (e: any) {
        step2 = { ok: false, status: 0, data: { error: e?.message || String(e) } };
      }
    }

    return json(200, {
      success: true,
      url: batUrl,
      vehicle_id: vehicleId,
      vehicleId: vehicleId,
      listing,
      organization_link: orgLink,
      core: {
        success: true,
        created_vehicle_ids: step1.data?.created_vehicle_ids ?? [],
        updated_vehicle_ids: step1.data?.updated_vehicle_ids ?? [],
      },
      comments: step2
        ? {
            attempted: true,
            ok: step2.ok,
            status: step2.status,
            result: step2.data,
          }
        : { attempted: false },
    });
  } catch (e: any) {
    return json(500, { success: false, error: e?.message || String(e) });
  }
});


