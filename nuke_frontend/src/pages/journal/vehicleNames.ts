import { supabase } from "../../lib/supabase";

/** Names of the public vehicles among the given ids, as "year make model". A vehicle the visitor cannot read stays unnamed. */
export async function readVehicleNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0 || typeof (supabase as any)?.from !== "function") return {};
  const { data, error } = await supabase.from("vehicles").select("id, year, make, model").in("id", ids);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const v of data as { id: string; year: number | null; make: string | null; model: string | null }[]) {
    const name = [v.year, v.make, v.model].filter(Boolean).join(" ");
    if (name) out[v.id] = name;
  }
  return out;
}
