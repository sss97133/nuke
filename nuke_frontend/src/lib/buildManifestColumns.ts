// vehicle_build_manifest columns that anon and signed-in readers may select (migration
// 20261014050000_build_manifest_money_owner_only). The owner's fields (price, price_source, invoice_ref,
// quoted_cost, actual_cost, cost_source, supplier_contact, evidence_sources, notes) are not granted:
// read them with the vehicle_build_manifest_owner_fields(p_vehicle_id) RPC, which returns no rows to
// anyone but the owner. A select('*') on the table now fails with a permission error.
export const BUILD_MANIFEST_PUBLIC_COLUMNS = [
  'id', 'vehicle_id', 'device_name', 'device_category', 'manufacturer', 'model_number', 'part_number',
  'catalog_part_id', 'supplier', 'purchased', 'pin_count', 'endpoint_description', 'power_draw_amps',
  'signal_type', 'requires_shielding', 'connector_type', 'wire_gauge_recommended', 'location_zone',
  'install_guide_url', 'wiring_diagram_url', 'datasheet_url', 'device_pin_map_id', 'pct_complete',
  'missing_fields', 'status', 'created_at', 'updated_at', 'sourcing_difficulty', 'lead_time_days',
  'supplier_type', 'layer', 'pos_x_pct', 'pos_y_pct', 'pdm_controlled', 'pdm_channel_group',
  'product_image_url', 'wire_status', 'integration_decision', 'open_questions', 'evidence_level',
  'harness_relevant', 'device_category_v2', 'device_family_v2', 'location_zone_v2', 'taxonomy_v2_notes',
  'tier', 'pos_x_m', 'pos_y_m', 'pos_z_m', 'pos_source', 'weight_lbs', 'length_in', 'width_in', 'height_in',
  'truck_runs_without_this', 'pdm_channel_id', 'interface_id', 'lifecycle_state', 'subsystem',
].join(', ');

export interface BuildManifestOwnerFields {
  id: string;
  price: number | null;
  price_source: string | null;
  invoice_ref: string | null;
  quoted_cost: number | null;
  actual_cost: number | null;
  cost_source: string | null;
  supplier_contact: string | null;
  evidence_sources: unknown;
  notes: string | null;
}
