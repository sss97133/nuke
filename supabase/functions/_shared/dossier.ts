/**
 * _shared/dossier.ts — canonical Build-History + Proof-of-Ownership dossier builder.
 *
 * Single source of truth for the `nuke.dossier/v1` product output. Consumed by:
 *   - api-v1-vehicle-history?view=dossier   (external callers, nk_live_ keys, MCP)
 *   - scripts/daily-receipt/build-dossier.mjs (local CLI — fetches this via the endpoint, renders HTML)
 *
 * It renders, with provenance, what the pipeline already recorded. It does NOT compute
 * anything new about the vehicle. Every number carries {amount, source, method}.
 *
 * Publish gate (post 2026-05-30 incident): only approved, non-superseded, non-sensitive,
 * non-iMessage-artifact photos ever reach the artifact.
 */

const IMSG_ARTIFACT = /__kIM|kIMFileTransfer|NSKeyedArchiver|attributedBody/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
type SB = any;

const num = (amount: unknown, source: string, method: string) => ({ amount, source, method });

/** Resolve a path identifier (UUID or VIN) to a vehicle row, or null. */
export async function resolveVehicle(supabase: SB, identifier: string) {
  const sel = "id,year,make,model,trim,vin,nuke_estimate,user_id,mileage,color,engine_type,transmission";
  if (UUID_RE.test(identifier)) {
    const { data } = await supabase.from("vehicles").select(sel).eq("id", identifier).limit(1).maybeSingle();
    return data || null;
  }
  const { data } = await supabase.from("vehicles").select(sel).ilike("vin", identifier).limit(1).maybeSingle();
  return data || null;
}

async function fetchAll(supabase: SB, table: string, columns: string, vehicleId: string, orderCol: string) {
  const pageSize = 1000;
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("vehicle_id", vehicleId)
      .order(orderCol, { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export interface DossierOptions {
  laborRate?: number;
  generatedAt?: string; // injectable for determinism in tests
}

/** Build the dossier JSON for an already-resolved vehicle row. */
export async function buildDossier(supabase: SB, vehicle: Record<string, any>, opts: DossierOptions = {}) {
  const laborRate = opts.laborRate ?? 85;
  const vid = vehicle.id;

  const sessionsRaw = await fetchAll(
    supabase, "work_sessions",
    "session_date,title,work_type,work_description,duration_minutes,image_count,total_labor_cost,total_parts_cost,total_job_cost,confidence_score,session_type,metadata,status",
    vid, "session_date",
  );
  const sessions = sessionsRaw.filter((s) => s.status !== "cancelled" && s.status !== "draft");

  const imagesRaw = await fetchAll(
    supabase, "vehicle_images",
    "id,image_url,medium_url,image_type,vision_gate_status,source,is_primary,is_sensitive,is_superseded,taken_at,caption",
    vid, "taken_at",
  );
  const photos = imagesRaw.filter((p) =>
    p.vision_gate_status === "approved" &&
    p.is_superseded !== true &&
    p.is_sensitive !== true &&
    p.source !== "imessage" &&
    !(p.caption && IMSG_ARTIFACT.test(String(p.caption)))
  );

  const exteriorRe = /ext|front|side|rear|profile|three.?quarter/i;
  const lead =
    photos.find((p) => p.is_primary && (p.medium_url || p.image_url)) ||
    photos.find((p) => exteriorRe.test(String(p.image_type || "")) && (p.medium_url || p.image_url)) ||
    photos.find((p) => p.medium_url || p.image_url) || null;
  const leadUrl = lead ? (lead.medium_url || lead.image_url) : null;

  const dates = sessions.map((s) => s.session_date).filter(Boolean).sort();
  const totalMinutes = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
  const recordedLabor = sessions.reduce((a, s) => a + (Number(s.total_job_cost) || 0), 0);
  const estimatedLabor = Math.round((totalMinutes / 60) * laborRate);

  const workTypeBreakdown: Record<string, number> = {};
  for (const s of sessions) { const k = s.work_type || "general"; workTypeBreakdown[k] = (workTypeBreakdown[k] || 0) + 1; }
  const photoSources: Record<string, number> = {};
  for (const p of photos) { const k = p.source || "unknown"; photoSources[k] = (photoSources[k] || 0) + 1; }

  const trimPart = (vehicle.trim && !String(vehicle.model || "").toLowerCase().includes(String(vehicle.trim).toLowerCase())) ? vehicle.trim : null;
  const vehicleName = [vehicle.year, vehicle.make, vehicle.model, trimPart].filter(Boolean).join(" ");

  return {
    schema: "nuke.dossier/v1",
    generated_at: opts.generatedAt ?? new Date().toISOString(),
    generator: "_shared/dossier.ts",
    vehicle: {
      id: vehicle.id, name: vehicleName,
      year: vehicle.year, make: vehicle.make, model: vehicle.model, trim: vehicle.trim,
      vin: vehicle.vin, mileage: vehicle.mileage, color: vehicle.color,
      engine: vehicle.engine_type, transmission: vehicle.transmission,
      lead_image_url: leadUrl,
    },
    proof_of_ownership: {
      vin: vehicle.vin
        ? num(vehicle.vin, "vehicles.vin", "recorded")
        : { amount: null, source: "vehicles.vin", method: "absent", needs: "capture VIN plate / door-jamb photo" },
      owner_user_id: vehicle.user_id || null,
      photo_attribution: {
        total_publishable_photos: photos.length,
        by_source: photoSources,
        note: "Photo density by a single documenter is the strongest available ownership/possession signal absent a title scan.",
      },
      title_document: { present: false, needs: "upload title scan to attach a registry-grade ownership proof" },
    },
    build_summary: {
      work_days: num(dates.length, "work_sessions", "distinct session_date count"),
      span: dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null,
      documented_hours: num(totalHours, "work_sessions.duration_minutes", "sum/60"),
      recorded_labor_value_usd: num(Math.round(recordedLabor), "work_sessions.total_job_cost", "sum of recorded session cost"),
      estimated_labor_value_usd: num(estimatedLabor, `documented_hours × $${laborRate}/hr`, "estimate — not invoiced"),
      publishable_photos: num(photos.length, "vehicle_images", "approved & non-superseded & non-sensitive"),
      work_type_breakdown: workTypeBreakdown,
    },
    valuation: vehicle.nuke_estimate != null
      ? num(Number(vehicle.nuke_estimate), "vehicles.nuke_estimate", "nuke multi-signal estimate")
      : null,
    timeline: sessions.map((s) => ({
      date: s.session_date,
      title: s.title,
      work_type: s.work_type,
      description: s.work_description,
      hours: s.duration_minutes != null ? Math.round((s.duration_minutes / 60) * 10) / 10 : null,
      photos: s.image_count || 0,
      recorded_value_usd: Number(s.total_job_cost) || 0,
      confidence: s.confidence_score,
      provenance: {
        method: s.session_type || "unknown",
        created_by: s.metadata?.created_by || null,
        sources: s.metadata?.sources || null,
      },
    })),
    disclosure: "Build history derived from timestamped photo evidence and recorded work sessions. Labor values marked \"estimated\" are computed from documented hours at the stated rate and were not necessarily invoiced. Provenance is attached to every claim; nothing here is inferred without a cited source.",
  };
}
