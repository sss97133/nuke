// Conceptcarz archive rows bound to a Barrett-Jackson vehicle by year + make + price (orphan-backfill-v1) are checked
// against the vehicle with the shared identity rule (supabase/functions/_shared/identityMatch.ts). A row whose title
// names a different car is raised as a revision item (identity_match / different_car / relink); nothing on the vehicle
// or the event is written. Default is a dry run that prints one JSON line per checked row.
//
//   dotenvx run -q -- deno run -A scripts/discovery/conceptcarz-binding-audit.ts [--apply] [--limit N]
import { identityConflict, REVISION_DIFFERENT_CAR } from "../../supabase/functions/_shared/identityMatch.ts";

export interface TitleIdentity { year: number | null; make: string | null; model: string | null; vin: string | null }

/** "1956 FORD F-100 CUSTOM PICKUPChassis#: F10D6R35426" -> year, make (the vehicle's make when the title starts with it), model, chassis. */
export function parseConceptcarzTitle(title: string, vehicleMake?: string | null): TitleIdentity {
  const chassis = title.match(/chassis\s*#\s*:?\s*([A-Z0-9-]+)/i)?.[1]?.replace(/-/g, "") ?? null;
  const body = title.replace(/chassis\s*#.*$/i, "").trim();
  const m = body.match(/^(\d{4})\s+(.*)$/);
  if (!m) return { year: null, make: null, model: body || null, vin: null };
  const rest = m[2].trim();
  const mk = (vehicleMake ?? "").trim();
  let make: string | null;
  let model: string;
  if (mk && rest.toLowerCase().startsWith(mk.toLowerCase() + " ")) {
    make = mk;
    model = rest.slice(mk.length).trim();
  } else if (mk) {
    // Some titles omit the make ("1959 Corvette Convertible Painting"): the make is unknown, the rest is the model.
    make = null;
    model = rest;
  } else {
    const [first, ...tail] = rest.split(/\s+/);
    make = first ?? null;
    model = tail.join(" ");
  }
  // A short chassis fragment ("1Q8") is not a VIN; only a full-length one may disagree with the vehicle's VIN.
  return { year: Number(m[1]), make, model: model || null, vin: chassis && chassis.length >= 10 ? chassis : null };
}

export function checkBinding(vehicle: { year: number | null; make: string | null; model: string | null; vin: string | null }, title: string) {
  const incoming = parseConceptcarzTitle(title, vehicle.make);
  return { incoming, conflict: identityConflict(vehicle, incoming) };
}

async function main() {
  const apply = Deno.args.includes("--apply");
  const li = Deno.args.indexOf("--limit");
  const limit = li >= 0 ? Number(Deno.args[li + 1]) : Infinity;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const totals = { checked: 0, conflict: 0, same_car: 0, filed: 0, file_errors: 0 };
  let after = "00000000-0000-0000-0000-000000000000";
  while (totals.checked < limit) {
    const q = `${url}/rest/v1/vehicle_events?select=id,vehicle_id,source_url,final_price,vehicles(year,make,model,vin)` +
      `&source_platform=eq.barrettjackson&source_url=like.conceptcarz*&id=gt.${after}&order=id&limit=500`;
    const res = await fetch(q, { headers });
    if (!res.ok) throw new Error(`read ${res.status}: ${await res.text()}`);
    const rows = await res.json() as Array<{ id: string; vehicle_id: string; source_url: string; final_price: number | null; vehicles: { year: number | null; make: string | null; model: string | null; vin: string | null } | null }>;
    if (!rows.length) break;
    for (const r of rows) {
      if (totals.checked >= limit) break;
      after = r.id;
      if (!r.vehicles) continue;
      totals.checked++;
      const title = decodeURIComponent(r.source_url.replace(/^conceptcarz:\/\/event\/\d+\//, ""));
      const { incoming, conflict } = checkBinding(r.vehicles, title);
      if (!conflict) { totals.same_car++; continue; }
      totals.conflict++;
      console.log(JSON.stringify({ event_id: r.id, vehicle_id: r.vehicle_id, title, vehicle: r.vehicles, incoming, conflict }));
      if (!apply) continue;
      const rpc = await fetch(`${url}/rest/v1/rpc/record_revision_item`, {
        method: "POST", headers,
        body: JSON.stringify({
          p_url: r.source_url, p_missing: [REVISION_DIFFERENT_CAR.missing], p_reason: REVISION_DIFFERENT_CAR.reason,
          p_next_action: REVISION_DIFFERENT_CAR.next_action, p_raised_by: "conceptcarz-binding-audit", p_snapshot_id: null,
          p_detail: { different_car: true, event_id: r.id, vehicle_id: r.vehicle_id, detail: conflict, title, matched_by: "orphan-backfill-v1 year+make+price" },
          p_vehicle_id: r.vehicle_id,
        }),
      });
      if (rpc.ok) totals.filed++; else { totals.file_errors++; console.error(`revision item ${r.id}: ${rpc.status} ${await rpc.text()}`); }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(JSON.stringify({ apply, ...totals, at: new Date().toISOString() }));
}

if (import.meta.main) await main();
