-- Register the organizations counter columns with their one writer.
--
-- write_receipts showed organizations with 93,187 "undeclared" UPDATE statements in 30 days (v_schema_atlas,
-- 2026-10-06). Every one is the AFTER ROW trigger update_organization_stats(): an insert or delete on
-- organization_vehicles, organization_images or business_timeline_events recounts all three children and
-- rewrites the parent row through the businesses view. The top-level callers (ingest, sync-live-auctions,
-- extract-bat-core) now declare themselves with X-Nuke-Writer; these rows record who owns the columns.
-- refresh_org_total_vehicles() is the bulk recompute of total_vehicles. Registry metadata only: no schema,
-- trigger or data change.
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES
('organizations','total_vehicles','update_organization_stats',
 'Count of organization_vehicles rows for the organization. Recounted on every organization_vehicles, organization_images or business_timeline_events insert/delete for that organization (triggers trg_update_org_stats_on_vehicle/_image/_event); bulk recompute refresh_org_total_vehicles(). Derived, never testimony.',
 true,'trigger update_organization_stats (organization_vehicles, organization_images, business_timeline_events)'),
('organizations','total_images','update_organization_stats',
 'Count of organization_images rows for the organization. Recounted by the same trigger on any child insert/delete. Derived, never testimony.',
 true,'trigger update_organization_stats (organization_vehicles, organization_images, business_timeline_events)'),
('organizations','total_events','update_organization_stats',
 'Count of business_timeline_events rows whose business_id is the organization. Recounted by the same trigger on any child insert/delete. Derived, never testimony.',
 true,'trigger update_organization_stats (organization_vehicles, organization_images, business_timeline_events)')
ON CONFLICT (table_name, column_name) DO NOTHING;
