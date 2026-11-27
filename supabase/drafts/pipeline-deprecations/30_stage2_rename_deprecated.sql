-- DRAFT. NOT APPLIED. Stage 2: rename each retired column to <col>_deprecated for one release.
-- Requires stage 1 shipped and a release with no 'deprecated vehicle_images column write' warnings.
-- Views keep working (a rename carries through); explicit selects by the old name fail loudly, which is the point.
-- The stage-1 warning trigger references the old names. Drop it here, because plpgsql would fail at runtime.
begin;
set local lock_timeout = '3s';
drop trigger if exists zz_warn_deprecated_vehicle_image_write on public.vehicle_images;
alter table public.vehicle_images rename column angle_confidence to angle_confidence_deprecated;
alter table public.vehicle_images rename column doc_flag to doc_flag_deprecated;
alter table public.vehicle_images rename column doc_confidence to doc_confidence_deprecated;
alter table public.vehicle_images rename column document_classification to document_classification_deprecated;
alter table public.vehicle_images rename column yaw_deg to yaw_deg_deprecated;
alter table public.vehicle_images rename column yaw_confidence to yaw_confidence_deprecated;
alter table public.vehicle_images rename column perspective to perspective_deprecated;
alter table public.vehicle_images rename column surface_coord_u to surface_coord_u_deprecated;
alter table public.vehicle_images rename column surface_coord_v to surface_coord_v_deprecated;
alter table public.vehicle_images rename column vehicle_make to vehicle_make_deprecated;
alter table public.vehicle_images rename column vehicle_model to vehicle_model_deprecated;
alter table public.vehicle_images rename column vehicle_year to vehicle_year_deprecated;
alter table public.vehicle_images rename column vehicle_confidence to vehicle_confidence_deprecated;
alter table public.vehicle_images rename column vehicle_source to vehicle_source_deprecated;
alter table public.vehicle_images rename column uploaded_at to uploaded_at_deprecated;
alter table public.vehicle_images rename column filename to filename_deprecated;
alter table public.vehicle_images rename column perceptual_hash to perceptual_hash_deprecated;
alter table public.vehicle_images rename column labels to labels_deprecated;
alter table public.vehicle_images rename column ai_last_scanned to ai_last_scanned_deprecated;
alter table public.vehicle_images rename column verification_status to verification_status_deprecated;
alter table public.vehicle_images rename column process_stage to process_stage_deprecated;
alter table public.vehicle_images rename column image_context to image_context_deprecated;
alter table public.vehicle_images rename column location_confidence to location_confidence_deprecated;
alter table public.vehicle_images rename column user_tags to user_tags_deprecated;
alter table public.vehicle_images rename column spatial_tags to spatial_tags_deprecated;
alter table public.vehicle_images rename column analysis_history to analysis_history_deprecated;
alter table public.vehicle_images rename column context_score to context_score_deprecated;
alter table public.vehicle_images rename column processing_models_used to processing_models_used_deprecated;
alter table public.vehicle_images rename column total_processing_cost to total_processing_cost_deprecated;
alter table public.vehicle_images rename column ai_suggestions to ai_suggestions_deprecated;
alter table public.vehicle_images rename column temp_session_id to temp_session_id_deprecated;
alter table public.vehicle_images rename column pending_submission_id to pending_submission_id_deprecated;
alter table public.vehicle_images rename column task_id to task_id_deprecated;
alter table public.vehicle_images rename column workflow_role to workflow_role_deprecated;
alter table public.vehicle_images rename column safe_preview_url to safe_preview_url_deprecated;
alter table public.vehicle_images rename column optimized_at to optimized_at_deprecated;
alter table public.vehicle_images rename column yono_queued_at to yono_queued_at_deprecated;
-- anon reads vehicle_images through column grants (captured 2026-11-23); authenticated holds a table-level SELECT,
-- so only the anon revoke has an effect. location_confidence was never granted to anon and is left out.
revoke select (angle_confidence_deprecated, doc_flag_deprecated, doc_confidence_deprecated, document_classification_deprecated, yaw_deg_deprecated, yaw_confidence_deprecated, perspective_deprecated, surface_coord_u_deprecated, surface_coord_v_deprecated, vehicle_make_deprecated, vehicle_model_deprecated, vehicle_year_deprecated, vehicle_confidence_deprecated, vehicle_source_deprecated, uploaded_at_deprecated, filename_deprecated, perceptual_hash_deprecated, labels_deprecated, ai_last_scanned_deprecated, verification_status_deprecated, process_stage_deprecated, image_context_deprecated, user_tags_deprecated, spatial_tags_deprecated, analysis_history_deprecated, context_score_deprecated, processing_models_used_deprecated, total_processing_cost_deprecated, ai_suggestions_deprecated, temp_session_id_deprecated, pending_submission_id_deprecated, task_id_deprecated, workflow_role_deprecated, safe_preview_url_deprecated, optimized_at_deprecated, yono_queued_at_deprecated) on public.vehicle_images from anon;
commit;
