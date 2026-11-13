/** A board locator is a presentation, not authority over an exact source VIN. */
export async function resolveBatVehicleIdentity(db: any, input: {
  vehicleId: string | null; vin: unknown; sourceUrl: string; comments: any[];
}): Promise<{ vehicleId: string | null; redirectedFrom: string | null }> {
  const unchanged = { vehicleId: input.vehicleId, redirectedFrom: null };
  const vin = String(input.vin ?? '').trim().toUpperCase();
  // Preserve existing chassis/no-VIN behavior. The caller has already rejected
  // modern VINs with a failing check digit before reaching this guard.
  if (!input.vehicleId || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return unchanged;
  const { data: selected, error } = await db.from('vehicles')
    .select('id,vin,listing_url,origin_metadata,deleted_at,status,merged_into_vehicle_id').eq('id', input.vehicleId).maybeSingle();
  if (error || !selected || selected.id !== input.vehicleId || selected.deleted_at || selected.merged_into_vehicle_id || selected.status === 'merged')
    throw Error('BaT selected vehicle identity unavailable');
  const selectedVin = String(selected.vin ?? '').trim().toUpperCase();
  if (selectedVin === vin) return unchanged;
  if (selectedVin) throw Error('BaT source VIN contradicts selected vehicle');
  // Exact equality uses the existing idx_vehicles_vin. Do not call the legacy
  // regexp-normalized uniqueness overload, which scans the vehicle inventory.
  const { data: owners, error: ownerError } = await db.from('vehicles')
    .select('id,vin,deleted_at,status,merged_into_vehicle_id').eq('vin', vin).not('vin', 'is', null)
    .is('deleted_at', null).is('merged_into_vehicle_id', null).or('status.is.null,status.neq.merged').limit(2);
  if (ownerError || !Array.isArray(owners)) throw Error('BaT exact VIN ownership unavailable');
  if (!owners.length) return unchanged;
  if (owners.length !== 1 || !/^[0-9a-f-]{36}$/i.test(String(owners[0].id ?? ''))
    || owners[0].vin !== vin || owners[0].deleted_at || owners[0].merged_into_vehicle_id || owners[0].status === 'merged')
    throw Error('BaT exact VIN ownership ambiguous');
  const canonical = (raw: unknown) => {
    try {
      const u = new URL(String(raw));
      if (u.protocol !== 'https:' || u.hostname !== 'bringatrailer.com' || u.username || u.password || u.port
        || u.search || u.hash || !/^\/listing\/[^/]+\/?$/.test(u.pathname)) return null;
      return u.origin + u.pathname.replace(/\/$/, '');
    } catch { return null; }
  };
  const sourceUrl = canonical(input.sourceUrl);
  const post = String(selected.origin_metadata?.external_id ?? '');
  if (!sourceUrl || canonical(selected.listing_url) !== sourceUrl
    || selected.origin_metadata?.source !== 'bat_auctions_page'
    || selected.origin_metadata?.platform !== 'bringatrailer'
    || !/^[1-9][0-9]{3,}$/.test(post) || !input.comments.length
    || input.comments.some(c => String(c?.post ?? '') !== post))
    throw Error('BaT VIN owner differs from unverified selected locator');
  return { vehicleId: String(owners[0].id), redirectedFrom: input.vehicleId };
}
