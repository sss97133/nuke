import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type PartnerFacility = {
  partner_name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  website_origin: string | null;
  partner_referral_url: string | null;
  bat_username: string | null;
  bat_profile_url: string | null;
  discovered_via: 'bat_local_partners';
  source_url: string;
  geographic_key: string;
  detected_section_labels?: {
    group?: string | null;
    region?: string | null;
  };
};

function safeText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
}

function inferBusinessTypeHint(partnerName: string, website: string | null): { type: string; business_type: string } {
  const s = `${partnerName} ${website || ''}`.toLowerCase();

  if (/(restoration|coachwork|coachworks|body\s*shop|collision|paint|autowerks|autowerk)/i.test(s)) {
    return { type: 'restoration_shop', business_type: 'restoration_shop' };
  }
  if (/(performance|racing|dyno|tuning)/i.test(s)) {
    return { type: 'performance_shop', business_type: 'performance_shop' };
  }
  if (/(detail|detailing)/i.test(s)) {
    return { type: 'garage', business_type: 'detailing' };
  }

  return { type: 'garage', business_type: 'specialty_shop' };
}

async function upsertBusinesses(
  facilities: PartnerFacility[],
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{ created: number; updated: number; skipped: number }> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const f of facilities) {
    const partnerName = safeText(f.partner_name);
    const geographicKey = safeText(f.geographic_key);
    if (!partnerName || !geographicKey) {
      skipped++;
      continue;
    }

    const { data: existingRows, error: findErr } = await supabase
      .from('businesses')
      .select('id, business_name, website, city, state, country, metadata, type, business_type, source_url, discovered_via')
      .eq('geographic_key', geographicKey)
      .limit(2);

    if (findErr) {
      console.log(`Find failed for ${geographicKey}: ${findErr.message}`);
      skipped++;
      continue;
    }

    const existing = Array.isArray(existingRows) && existingRows.length ? existingRows[0] : null;

    const typeHints = inferBusinessTypeHint(partnerName, f.website_origin || null);
    const desiredType = typeHints.type;
    const desiredBusinessType = typeHints.business_type;

    const nextMetadata = {
      ...(existing?.metadata || {}),
      bat_local_partners: {
        partner_referral_url: f.partner_referral_url || null,
        bat_username: f.bat_username || null,
        bat_profile_url: f.bat_profile_url || null,
        source_url: f.source_url || null,
        imported_at: new Date().toISOString(),
        detected_labels: f.detected_section_labels || {},
      },
    };

    if (existing?.id) {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        metadata: nextMetadata,
      };

      // Only fill missing columns; do not overwrite existing quality data.
      if (!existing.business_name) updates.business_name = partnerName;
      if (!existing.website && f.website_origin) updates.website = f.website_origin;
      if (!existing.city && f.city) updates.city = f.city;
      if (!existing.state && f.state) updates.state = f.state;
      if (!existing.country && f.country) updates.country = f.country;
      if (!existing.source_url && f.source_url) updates.source_url = f.source_url;
      if (!existing.discovered_via && f.discovered_via) updates.discovered_via = f.discovered_via;
      if (!existing.type) updates.type = desiredType;
      if (!existing.business_type) updates.business_type = desiredBusinessType;

      const { error: updErr } = await supabase.from('businesses').update(updates).eq('id', existing.id);
      if (updErr) {
        console.log(`Update failed for ${partnerName}: ${updErr.message}`);
        skipped++;
        continue;
      }
      updated++;
      continue;
    }

    const insertRow: Record<string, unknown> = {
      business_name: partnerName,
      website: f.website_origin || null,
      city: f.city,
      state: f.state,
      country: f.country || null,
      is_public: true,
      status: 'active',
      discovered_via: f.discovered_via,
      source_url: f.source_url,
      geographic_key: geographicKey,
      type: desiredType,
      business_type: desiredBusinessType,
      metadata: nextMetadata,
    };

    const { error: insErr } = await supabase.from('businesses').insert(insertRow);
    if (insErr) {
      console.log(`Insert failed for ${partnerName}: ${insErr.message}`);
      skipped++;
      continue;
    }
    created++;
  }

  return { created, updated, skipped };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl) {
      return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL in function env' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY in function env' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.json().catch(() => ({}));
    const facilities = Array.isArray(payload?.facilities) ? payload.facilities : [];
    const dryRun = payload?.dry_run === true || payload?.dryRun === true;
    const limit = Number.isFinite(Number(payload?.limit)) ? Math.max(1, Math.floor(Number(payload.limit))) : null;

    const sliced = typeof limit === 'number' ? facilities.slice(0, limit) : facilities;
    if (dryRun) {
      return new Response(JSON.stringify({ success: true, dry_run: true, facilities: sliced.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stats = await upsertBusinesses(sliced, supabaseUrl, serviceRoleKey);
    return new Response(JSON.stringify({ success: true, facilities: sliced.length, ...stats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});


