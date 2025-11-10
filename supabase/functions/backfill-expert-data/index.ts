import { serve } from 'https://deno.land/std@0.223.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0';
import OpenAI from 'https://esm.sh/openai@4.47.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const openAiKey = Deno.env.get('OPENAI_API_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Supabase credentials are not configured');
}

if (!openAiKey) {
  throw new Error('OPENAI_API_KEY not configured');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

const openai = new OpenAI({ apiKey: openAiKey });

type FieldSpec = {
  label: string;
  type: 'string' | 'number' | 'boolean';
  minConfidence?: number;
  allowedValues?: string[];
  normalise?: (value: unknown) => string | number | boolean | null;
};

const FIELD_SPECS: Record<string, FieldSpec> = {
  drivetrain: {
    label: 'Drivetrain',
    type: 'string',
    minConfidence: 0.75,
    allowedValues: ['4WD', '4X4', 'AWD', 'FWD', 'RWD', '2WD', '4WD (HI/LO)'],
    normalise: (value) => {
      if (!value) return null;
      const text = String(value).toUpperCase();
      if (text.includes('4X4')) return '4WD';
      if (text.includes('4WD') || text.includes('FOUR WHEEL')) return '4WD';
      if (text.includes('HI/LO')) return '4WD (HI/LO)';
      if (text.includes('AWD') || text.includes('ALL WHEEL')) return 'AWD';
      if (text.includes('FWD') || text.includes('FRONT WHEEL')) return 'FWD';
      if (text.includes('RWD') || text.includes('REAR WHEEL')) return 'RWD';
      if (text.includes('2WD') || text.includes('TWO WHEEL')) return '2WD';
      return text.trim() || null;
    }
  },
  fuel_type: {
    label: 'Fuel Type',
    type: 'string',
    minConfidence: 0.75,
    allowedValues: ['GASOLINE', 'PETROL', 'DIESEL', 'E85', 'ELECTRIC', 'HYBRID', 'PROPANE'],
    normalise: (value) => {
      if (!value) return null;
      const text = String(value).toUpperCase();
      if (text.includes('GAS') || text.includes('PETROL')) return 'GASOLINE';
      if (text.includes('DIESEL')) return 'DIESEL';
      if (text.includes('E85') || text.includes('ETHANOL')) return 'E85';
      if (text.includes('ELECTRIC')) return 'ELECTRIC';
      if (text.includes('HYBRID')) return 'HYBRID';
      if (text.includes('PROPANE') || text.includes('LPG')) return 'PROPANE';
      return text.trim() || null;
    }
  },
  body_style: {
    label: 'Body Style',
    type: 'string',
    minConfidence: 0.7,
    normalise: (value) => (value ? String(value).trim() : null)
  },
  engine_size: {
    label: 'Engine Size',
    type: 'string',
    minConfidence: 0.8,
    normalise: (value) => {
      if (!value) return null;
      const text = String(value).toUpperCase();
      if (/[0-9]+\.?[0-9]*L/.test(text)) return text.replace(/\s+/g, '');
      if (/[0-9]{3}\s*CI/.test(text)) return text.replace(/\s+/g, '');
      return text.trim() || null;
    }
  },
  displacement: {
    label: 'Displacement',
    type: 'string',
    minConfidence: 0.8,
    normalise: (value) => {
      if (!value) return null;
      const text = String(value).toUpperCase();
      if (/[0-9]+\.?[0-9]*L/.test(text)) return text.replace(/\s+/g, '');
      if (/[0-9]{3}\s*CI/.test(text)) return text.replace(/\s+/g, '');
      if (/^[0-9.]+$/.test(text)) return `${text}L`;
      return text.trim() || null;
    }
  },
  horsepower: {
    label: 'Horsepower',
    type: 'number',
    minConfidence: 0.8,
    normalise: (value) => {
      const num = Number(String(value).replace(/[^0-9.]/g, ''));
      return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
    }
  },
  torque: {
    label: 'Torque',
    type: 'number',
    minConfidence: 0.8,
    normalise: (value) => {
      const num = Number(String(value).replace(/[^0-9.]/g, ''));
      return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
    }
  },
  title_status: {
    label: 'Title Status',
    type: 'string',
    minConfidence: 0.75,
    allowedValues: ['CLEAN', 'SALVAGE', 'REBUILT', 'BILL OF SALE', 'MISSING', 'LIEN', 'RECONSTRUCTED'],
    normalise: (value) => {
      if (!value) return null;
      const text = String(value).toUpperCase();
      if (text.includes('CLEAN')) return 'CLEAN';
      if (text.includes('SALVAGE')) return 'SALVAGE';
      if (text.includes('REBUILT')) return 'REBUILT';
      if (text.includes('BILL OF SALE')) return 'BILL OF SALE';
      if (text.includes('LIEN')) return 'LIEN';
      if (text.includes('MISSING')) return 'MISSING';
      if (text.includes('RECONSTRUCT')) return 'RECONSTRUCTED';
      return text.trim() || null;
    }
  },
  asking_price: {
    label: 'Asking Price',
    type: 'number',
    minConfidence: 0.7,
    normalise: (value) => {
      const num = Number(String(value).replace(/[^0-9.]/g, ''));
      return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
    }
  },
  location: {
    label: 'Listing Location',
    type: 'string',
    minConfidence: 0.7,
    normalise: (value) => (value ? String(value).trim() : null)
  }
};

type BackfillRequest = {
  vehicleId?: string;
  limit?: number;
  dryRun?: boolean;
  forceFields?: string[];
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request = await parseRequest(req);
    const vehicles = await fetchTargetVehicles(request);

    const results: Array<Record<string, unknown>> = [];

    for (const vehicle of vehicles) {
      const missingFields = determineMissingFields(vehicle, request.forceFields ?? []);
      if (missingFields.length === 0) {
        results.push({ vehicleId: vehicle.id, status: 'skipped', reason: 'No missing fields detected' });
        continue;
      }

      const context = await buildContext(vehicle);
      const aiResult = await queryFactFinder(vehicle, missingFields, context);
      const processed = await processAiResult(vehicle, aiResult, request.dryRun ?? false);

      results.push({
        vehicleId: vehicle.id,
        missingFields,
        ...processed
      });

      await delay(400);
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[backfill-expert-data] error', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});

async function parseRequest(req: Request): Promise<BackfillRequest> {
  try {
    const body = await req.json();
    return {
      vehicleId: typeof body.vehicleId === 'string' ? body.vehicleId : undefined,
      limit: typeof body.limit === 'number' ? Math.max(1, Math.min(25, Math.floor(body.limit))) : undefined,
      dryRun: typeof body.dryRun === 'boolean' ? body.dryRun : false,
      forceFields: Array.isArray(body.forceFields) ? body.forceFields.filter((f: unknown) => typeof f === 'string') : undefined
    };
  } catch {
    return {};
  }
}

async function fetchTargetVehicles(request: BackfillRequest) {
  const selectColumns = `
    id, year, make, model, vin,
    drivetrain, fuel_type, body_style, engine_size, displacement,
    horsepower, torque, title_status, asking_price, location,
    notes, description, listing_source, listing_url, listing_posted_at, listing_updated_at,
    discovery_url, discovery_source, import_source, import_metadata,
    created_at, updated_at
  `;

  if (request.vehicleId) {
    const { data, error } = await supabaseAdmin
      .from('vehicles')
      .select(selectColumns)
      .eq('id', request.vehicleId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load vehicle ${request.vehicleId}: ${error.message}`);
    return data ? [data] : [];
  }

  const { data, error } = await supabaseAdmin
    .from('vehicles')
    .select(selectColumns)
    .or([
      'drivetrain.is.null',
      'fuel_type.is.null',
      'body_style.is.null',
      'engine_size.is.null',
      'displacement.is.null',
      'title_status.is.null',
      'asking_price.is.null',
      'location.is.null'
    ].join(','))
    .order('updated_at', { ascending: true })
    .limit(request.limit ?? 5);

  if (error) throw new Error(`Failed to query vehicles: ${error.message}`);
  return data ?? [];
}

function determineMissingFields(vehicle: Record<string, unknown>, forced: string[]): string[] {
  const missing: string[] = [];

  for (const [field, spec] of Object.entries(FIELD_SPECS)) {
    if (forced.includes(field)) {
      missing.push(field);
      continue;
    }

    const current = vehicle[field];

    if (current === null || current === undefined || current === '') {
      missing.push(field);
      continue;
    }

    if (spec.type === 'number' && typeof current !== 'number') {
      missing.push(field);
      continue;
    }

    if (spec.type === 'boolean' && typeof current !== 'boolean') {
      missing.push(field);
      continue;
    }
  }

  return missing;
}

async function buildContext(vehicle: Record<string, unknown>): Promise<string> {
  const parts: string[] = [];

  parts.push(`VEHICLE SUMMARY: ${(vehicle.year ?? 'Unknown').toString()} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim());
  if (vehicle.vin) parts.push(`VIN: ${vehicle.vin}`);

  const knownValues: string[] = [];
  for (const [field, spec] of Object.entries(FIELD_SPECS)) {
    const value = vehicle[field];
    if (value !== null && value !== undefined && value !== '') {
      knownValues.push(`${spec.label}: ${value}`);
    }
  }
  if (knownValues.length > 0) {
    parts.push(`CURRENT DATA:\n${knownValues.join('\n')}`);
  }

  if (vehicle.listing_source || vehicle.listing_url) {
    parts.push(`LISTING SOURCE: ${vehicle.listing_source ?? 'Unknown'} | URL: ${vehicle.listing_url ?? 'n/a'}`);
  }
  if (vehicle.listing_posted_at) parts.push(`LISTING POSTED AT: ${vehicle.listing_posted_at}`);
  if (vehicle.listing_updated_at) parts.push(`LISTING UPDATED AT: ${vehicle.listing_updated_at}`);

  if (vehicle.notes) {
    parts.push(`NOTES:\n${truncate(String(vehicle.notes), 4000)}`);
  }

  if (vehicle.description) {
    parts.push(`DESCRIPTION:\n${truncate(String(vehicle.description), 3000)}`);
  }

  const timelineLines = await loadRecentTimeline(vehicle.id as string);
  if (timelineLines.length > 0) {
    parts.push(`TIMELINE EVENTS:\n${timelineLines.join('\n')}`);
  }

  return parts.join('\n\n');
}

async function loadRecentTimeline(vehicleId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('timeline_events')
    .select('event_type, title, description, event_date, metadata, source')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false })
    .limit(8);

  if (error || !data) return [];

  return data.map((event) => {
    const date = event.event_date ?? 'unknown date';
    const type = event.event_type ?? 'event';
    const title = event.title ? ` - ${event.title}` : '';
    const description = event.description ? ` :: ${truncate(event.description, 200)}` : '';
    let metadataSnippet = '';
    if (event.metadata && typeof event.metadata === 'object') {
      try {
        metadataSnippet = ` [metadata: ${truncate(JSON.stringify(event.metadata), 200)}]`;
      } catch {
        metadataSnippet = '';
      }
    }
    return `${date} | ${type}${title}${description}${metadataSnippet}`;
  });
}

async function queryFactFinder(
  vehicle: Record<string, unknown>,
  missingFields: string[],
  context: string
) {
  const allowedFieldsList = Object.keys(FIELD_SPECS).join(', ');

  const systemPrompt = `You are FactFinder, an automotive research analyst.\n` +
    `You must ONLY use evidence that appears in the provided CONTEXT.\n` +
    `If data is missing or unclear, respond with value=null and confidence=0.\n` +
    `Do not rely on typical specs or outside knowledge.\n` +
    `Return JSON only. Allowed fields: ${allowedFieldsList}.`;

  const userPrompt = `VEHICLE: ${(vehicle.year ?? 'Unknown').toString()} ${vehicle.make ?? ''} ${vehicle.model ?? ''}\n` +
    `VIN: ${vehicle.vin ?? 'n/a'}\n` +
    `REQUESTED_FIELDS: ${missingFields.join(', ')}\n\n` +
    `CONTEXT START\n${context}\nCONTEXT END\n\n` +
    `Return JSON in shape {"fields": {"field_name": {"value": <value|null>, "confidence": <0-1>, "evidence": "", "source": "", "reason": ""}}, "warnings": [], "guardrail_flags": []}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 1200
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned empty response');
  }

  try {
    return JSON.parse(content);
  } catch (err) {
    console.error('Failed to parse AI response', content);
    throw new Error('Unable to parse AI response JSON');
  }
}

async function processAiResult(
  vehicle: Record<string, unknown>,
  aiResult: any,
  dryRun: boolean
) {
  const updates: Record<string, unknown> = {};
  const provenanceRecords: Array<Record<string, unknown>> = [];
  const skipped: Record<string, string> = {};

  const fields = aiResult?.fields || {};
  const warnings = Array.isArray(aiResult?.warnings) ? aiResult.warnings : [];
  const guardrailFlags = Array.isArray(aiResult?.guardrail_flags) ? aiResult.guardrail_flags : [];

  for (const [field, spec] of Object.entries(FIELD_SPECS)) {
    const result = fields[field];
    if (!result) continue;

    const confidence = typeof result.confidence === 'number' ? result.confidence : Number(result.confidence ?? 0);
    const minConfidence = spec.minConfidence ?? 0.7;

    if (confidence < minConfidence) {
      skipped[field] = `confidence ${confidence} below threshold ${minConfidence}`;
      continue;
    }

    if ((vehicle[field] !== null && vehicle[field] !== undefined && vehicle[field] !== '') && !result.override) {
      skipped[field] = 'existing value present';
      continue;
    }

    const normalised = spec.normalise ? spec.normalise(result.value) : result.value;
    if (normalised === null || normalised === '' || normalised === undefined) {
      skipped[field] = 'normalised value empty';
      continue;
    }

    if (spec.type === 'number' && typeof normalised !== 'number') {
      skipped[field] = 'expected number';
      continue;
    }

    if (spec.type === 'boolean' && typeof normalised !== 'boolean') {
      skipped[field] = 'expected boolean';
      continue;
    }

    if (spec.allowedValues && typeof normalised === 'string') {
      const match = spec.allowedValues.find((val) => val === normalised || val === normalised.toUpperCase());
      if (!match) {
        skipped[field] = `value "${normalised}" not in allowed set`;
        continue;
      }
      updates[field] = match;
    } else {
      updates[field] = normalised;
    }

    provenanceRecords.push({
      vehicle_id: vehicle.id,
      field_name: field,
      source_type: 'ai_backfill',
      confidence_score: Math.round(confidence * 100) / 100,
      source_url: vehicle.listing_url ?? vehicle.discovery_url ?? null,
      extraction_method: 'ai_fact_finder_v1',
      raw_extracted_text: truncate(result.evidence ?? '', 1000) || null,
      ai_reasoning: truncate(result.reason ?? '', 1000) || null,
      metadata: {
        source_label: result.source ?? null,
        guardrail_flags: guardrailFlags,
        warnings,
        model: 'gpt-4o-mini'
      }
    });
  }

  if (!dryRun && Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from('vehicles')
      .update(updates)
      .eq('id', vehicle.id as string);

    if (updateError) {
      throw new Error(`Failed to update vehicle ${vehicle.id}: ${updateError.message}`);
    }

    if (provenanceRecords.length > 0) {
      const { error: provenanceError } = await supabaseAdmin
        .from('vehicle_field_sources')
        .insert(provenanceRecords.map((record) => ({
          ...record,
          metadata: record.metadata as Record<string, unknown>
        })));

      if (provenanceError) {
        throw new Error(`Failed to record field sources for ${vehicle.id}: ${provenanceError.message}`);
      }
    }
  }

  return {
    status: Object.keys(updates).length > 0 ? (dryRun ? 'dry_run' : 'updated') : 'no_changes',
    updates,
    skipped,
    warnings,
    guardrailFlags
  };
}

function truncate(text: string, max: number) {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

