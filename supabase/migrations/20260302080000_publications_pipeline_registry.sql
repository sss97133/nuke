-- =============================================================================
-- PIPELINE REGISTRY: Field ownership for publications + publication_pages
-- =============================================================================

INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, valid_values, do_not_write_directly, write_via) VALUES
-- publications table
('publications', NULL, 'issuu-publication-seeder', 'Issuu publication catalog. Seed via scripts/stbarth/seed-publications.mjs.', NULL, false, NULL),
('publications', 'cdn_hash', 'issuu-hash-extractor', 'CDN hash for image URLs: image.isu.pub/{cdn_hash}/jpg/page_{n}.jpg. Extracted via Playwright.', NULL, false, NULL),
('publications', 'extraction_status', 'process-publication-pages', 'Pipeline state machine.', ARRAY['pending','pending_hash','hash_extracted','pages_indexed','analyzing','complete','failed'], false, NULL),
('publications', 'organization_id', 'issuu-publication-seeder', 'FK to organizations. Set during seed from publisher_slug mapping.', NULL, false, NULL),
('publications', 'cover_image_url', 'issuu-publication-seeder', 'CDN URL for page 1. Auto-generated from cdn_hash.', NULL, false, NULL),
('publications', 'search_vector', 'system', 'Auto-populated by trigger from title, slug, publisher_slug, issue_number, publication_type.', NULL, true, NULL),

-- publication_pages table
('publication_pages', NULL, 'process-publication-pages', 'Individual pages. Created by page indexer, analyzed by vision pipeline.', NULL, false, NULL),
('publication_pages', 'ai_processing_status', 'analyze-publication-pages', 'Vision analysis state.', ARRAY['pending','processing','completed','failed','skipped'], false, NULL),
('publication_pages', 'spatial_tags', 'analyze-publication-pages', 'Vision-extracted entity tags (JSONB). ~25 entity types including brands, artworks, people, locations, businesses.', NULL, true, 'analyze-publication-pages'),
('publication_pages', 'ai_scan_metadata', 'analyze-publication-pages', 'Raw vision model output metadata (model, tokens, cost, duration).', NULL, true, 'analyze-publication-pages'),
('publication_pages', 'extracted_text', 'analyze-publication-pages', 'OCR/extracted text from vision analysis.', NULL, true, 'analyze-publication-pages'),
('publication_pages', 'locked_by', 'analyze-publication-pages', 'Worker ID claiming this page. Stale after 30min.', NULL, true, NULL),
('publication_pages', 'locked_at', 'analyze-publication-pages', 'Lock timestamp. Stale after 30min.', NULL, true, NULL),
('publication_pages', 'analysis_cost', 'analyze-publication-pages', 'Cost in USD for this page analysis.', NULL, true, 'analyze-publication-pages'),
('publication_pages', 'analysis_model', 'analyze-publication-pages', 'Which model tier was used (haiku/sonnet).', NULL, true, 'analyze-publication-pages')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  valid_values = EXCLUDED.valid_values,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();
