// Queue rows claimed from snapshot_extraction_queue whose vehicle no longer exists.
//
// claim_extraction_batch takes the lowest vehicle_ids with status 'pending'. The queue has no foreign key, so a vehicle
// deleted after it was queued leaves a row nothing ever finishes: the extraction loop visits vehicles, not claimed rows.
// The row sat in 'processing', went back to 'pending' after 5 minutes, and was claimed first again.
// Measured 2026-10-14: 865 of the first 2,000 pending Barrett-Jackson rows (43%) and all 127 Bonhams rows
// (77 pending, 50 processing) have no vehicle. They are ended with status 'no_vehicle'.

/** The vehicle ids of claimed queue rows that the vehicle fetch did not return. */
export function orphanVehicleIds(claimed: ReadonlyArray<{ vehicle_id: string }>, vehicles: ReadonlyArray<{ id: string }>): string[] {
  const found = new Set(vehicles.map((v) => v.id));
  return claimed.map((c) => c.vehicle_id).filter((id) => !found.has(id));
}
