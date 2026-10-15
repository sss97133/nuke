/**
 * Craigslist photo galleries: what a vehicle's image rows should be, given the page's gallery.
 *
 * Until 2026-10-15 every stored Craigslist image was the 600x450 size. extract-craigslist now returns the page's whole
 * gallery at _1200x900. For a vehicle that already has rows, the same photo at the new size is added as a row, and the
 * smaller row is marked a duplicate of it (is_duplicate, duplicate_of): superseded, never deleted. A photo with no row
 * is added. A row that is not on the gallery any more is left alone.
 */

/** The image id without its size suffix: two sizes of one photo share it. */
export function imageKey(url: string): string {
  return (url.split("/").pop() ?? url).replace(/_\d+x\d+c?\.jpg(\?.*)?$/i, "");
}

const FULL = /_1200x900\.jpg(\?.*)?$/i;

export interface ExistingImage { id: string; image_url: string; is_primary?: boolean | null; is_duplicate?: boolean | null; vision_gate_status?: string | null }
export interface ImagePlan {
  /** Gallery photos to insert, with their gallery index. */
  insert: { url: string; position: number; replaces: string[]; primary: boolean; gate?: string }[];
  /** Existing rows to mark as duplicates once the row that replaces them exists. */
  supersede: { id: string; key: string }[];
}

export function planCraigslistImages(existing: ExistingImage[], gallery: string[]): ImagePlan {
  const live = existing.filter((r) => !r.is_duplicate);
  const byKey = new Map<string, ExistingImage[]>();
  for (const r of live) {
    const k = imageKey(r.image_url);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const plan: ImagePlan = { insert: [], supersede: [] };
  gallery.forEach((url, position) => {
    const rows = byKey.get(imageKey(url)) ?? [];
    if (rows.some((r) => FULL.test(r.image_url))) return; // already holds this photo at full size
    // The same photo at a larger size keeps the gate verdict of the row it replaces: a gallery that was cleared must not
    // go blank while the larger copies wait for the classifier. A photo with no earlier row starts at the column default.
    const gate = rows.length > 0 && rows.every((r) => r.vision_gate_status === "approved") ? "approved" : undefined;
    plan.insert.push({ url, position, replaces: rows.map((r) => r.id), primary: rows.some((r) => !!r.is_primary), ...(gate ? { gate } : {}) });
    for (const r of rows) plan.supersede.push({ id: r.id, key: imageKey(url) });
  });
  return plan;
}

/** Apply a plan with the service client: insert first, then mark the smaller rows. Returns counts; never throws. */
export async function applyCraigslistImagePlan(
  supabase: any,
  args: { vehicleId: string; sourceUrl: string | null; source: string; plan: ImagePlan; maxInsert?: number },
): Promise<{ inserted: number; superseded: number; errors: string[] }> {
  const out = { inserted: 0, superseded: 0, errors: [] as string[] };
  try {
    const batch = args.plan.insert.slice(0, args.maxInsert ?? 60);
    for (const item of batch) {
      // The primary flag moves with the photo: clear the smaller row's first, so there is one primary at every step.
      if (item.primary && item.replaces.length) await supabase.from("vehicle_images").update({ is_primary: false }).in("id", item.replaces);
      const { data, error } = await supabase.from("vehicle_images").insert({
        vehicle_id: args.vehicleId, image_url: item.url, is_primary: item.primary, position: item.position, display_order: item.position,
        source: args.source, is_external: true, source_url: args.sourceUrl, ...(item.gate ? { vision_gate_status: item.gate } : {}),
      }).select("id").maybeSingle();
      if (error || !data?.id) { out.errors.push(error?.message ?? "no id"); continue; }
      out.inserted++;
      if (item.primary) await supabase.from("vehicles").update({ primary_image_url: item.url }).eq("id", args.vehicleId);
      if (item.replaces.length) {
        const { error: upErr } = await supabase.from("vehicle_images").update({ is_duplicate: true, duplicate_of: data.id })
          .in("id", item.replaces);
        if (upErr) out.errors.push(upErr.message); else out.superseded += item.replaces.length;
      }
    }
  } catch (e) {
    out.errors.push(e instanceof Error ? e.message : String(e));
  }
  return out;
}
