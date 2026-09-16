-- =========================================================================
-- 20260522_reference_documents_substrate.sql
-- Date:   2026-05-22
-- Status: PROPOSED — apply after explicit review.
--
-- Lands the library as queryable substrate. The DB is facts; this migration
-- makes "what does the 1977 GM service manual say on page 412 about firewall
-- grommets" answerable via SQL.
--
-- Design intent (per 2026-05-22 conversation):
--
--   The library is the apprenticeship's entry barrier. Vanilla agents
--   arriving cold search → consult → cite. The substrate doesn't pre-extract
--   every fact from every page; it indexes pages and makes the text
--   searchable. Atom-extraction (the K5_dimensions_atoms.yaml pattern)
--   happens on top of this, citing back to specific pages.
--
--   Two tables: reference_documents (one row per file in the library),
--   document_pages (one row per page, with extracted text + tsvector for
--   full-text search). Topic tagging is free-text in v1 with future
--   canonicalization (see schema_proposal queued).
--
--   File hashes anchor provenance. If a PDF gets re-scanned with better
--   quality, the old hash supersedes (new row with same slug, new hash);
--   downstream citations migrate via supersession, never destroyed.
--
-- =========================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- reference_documents — one row per file in the library
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reference_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text NOT NULL UNIQUE,
  title                 text NOT NULL,
  category              text NOT NULL CHECK (category IN (
                          'service_manual',
                          'wiring_diagram_booklet',
                          'frame_dimensions',
                          'component_drawing',
                          'component_datasheet',
                          'brochure',
                          'rpo_codes',
                          'parts_catalog',
                          'vehicle_drawing',
                          'photo_archive',
                          'forum_thread',
                          'other'
                        )),
  file_path             text NOT NULL,
  file_hash             text NOT NULL,
  file_size_bytes       bigint,
  page_count            integer,
  year                  integer,
  vehicle_scope_class   text,
  vehicle_scope_specific jsonb,
  topics                text[],
  base_trust_score      numeric(3,2) DEFAULT 0.85,
  extraction_method     text CHECK (extraction_method IN (
                          'pdftotext','pdftotext_layout','vision_ocr','manual','pending'
                        )),
  extraction_quality    text CHECK (extraction_quality IN ('high','medium','low','pending')),
  added_at              timestamptz NOT NULL DEFAULT now(),
  extracted_at          timestamptz,
  superseded_by         uuid REFERENCES public.reference_documents(id),
  notes                 text
);

COMMENT ON TABLE public.reference_documents IS
  'Library index. One row per file in reference_documents/ on disk. The DB does not store the file bytes — just metadata + hash. Hash mismatches signal the file changed and the extraction is stale.';

COMMENT ON COLUMN public.reference_documents.vehicle_scope_class IS
  'Class envelope this document covers, e.g. "gmt_squarebody_73_91" or "ls3_engine_2008_2017". An observation citing a page of this document should check that the observation''s vehicle config is within the scope.';

COMMENT ON COLUMN public.reference_documents.topics IS
  'Free-text tags for v1 (e.g. wiring_diagram, frame_dimensions, harness_routing). Future schema_proposal will introduce a canonical_topic table for promoting high-frequency tags.';

CREATE INDEX IF NOT EXISTS idx_reference_documents_category ON public.reference_documents(category);
CREATE INDEX IF NOT EXISTS idx_reference_documents_year ON public.reference_documents(year);
CREATE INDEX IF NOT EXISTS idx_reference_documents_topics ON public.reference_documents USING GIN(topics);

-- ---------------------------------------------------------------------------
-- document_pages — one row per page, with extracted text and tsvector
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_pages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id        uuid NOT NULL REFERENCES public.reference_documents(id) ON DELETE CASCADE,
  page_number        integer NOT NULL,
  extracted_text     text,
  text_search        tsvector,
  has_diagrams       boolean DEFAULT false,
  extraction_method  text,
  extraction_notes   text,
  topics             text[],
  extracted_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, page_number)
);

COMMENT ON TABLE public.document_pages IS
  'One row per page of every indexed document. extracted_text is the pdftotext output (or OCR equivalent); text_search is the to_tsvector projection for fast queries via SELECT ... WHERE text_search @@ to_tsquery(...). Page-level granularity is the v1 cell of the library; future v2 may add document_sections for finer slicing.';

CREATE INDEX IF NOT EXISTS idx_document_pages_document ON public.document_pages(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_document_pages_text_search ON public.document_pages USING GIN(text_search);
CREATE INDEX IF NOT EXISTS idx_document_pages_topics ON public.document_pages USING GIN(topics) WHERE topics IS NOT NULL;

-- Trigger to maintain tsvector
CREATE OR REPLACE FUNCTION public.document_pages_tsvector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.text_search := to_tsvector('english', COALESCE(NEW.extracted_text, ''));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_document_pages_tsv ON public.document_pages;
CREATE TRIGGER trg_document_pages_tsv
  BEFORE INSERT OR UPDATE OF extracted_text
  ON public.document_pages
  FOR EACH ROW EXECUTE FUNCTION public.document_pages_tsvector_update();

-- ---------------------------------------------------------------------------
-- v_library_search — convenience search interface
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_library_search AS
SELECT
  dp.document_id,
  rd.slug,
  rd.title,
  rd.category,
  rd.year,
  dp.page_number,
  dp.extracted_text,
  dp.topics,
  rd.file_path,
  format('%s p.%s', rd.slug, dp.page_number) AS citation_short,
  format('%s (%s) page %s of %s', rd.title, rd.year, dp.page_number, rd.page_count) AS citation_long
FROM public.document_pages dp
JOIN public.reference_documents rd ON rd.id = dp.document_id
WHERE rd.superseded_by IS NULL;

COMMENT ON VIEW public.v_library_search IS
  'Searchable view of library pages. Filter via WHERE text_search @@ to_tsquery(''english'', ''your & query'') against document_pages, joined to document metadata.';

-- ---------------------------------------------------------------------------
-- Update vehicle_observations citation shape (dual-mode)
-- ---------------------------------------------------------------------------
-- Add a structured citation column. Existing structured_data.citation strings
-- stay valid (legacy); new observations populate citation_document + page.
-- Backfill is a separate, slower process that resolves legacy paths to
-- document_id where the slug matches.
ALTER TABLE public.vehicle_observations
  ADD COLUMN IF NOT EXISTS citation_document_id uuid REFERENCES public.reference_documents(id),
  ADD COLUMN IF NOT EXISTS citation_page_number integer,
  ADD COLUMN IF NOT EXISTS citation_excerpt text;

COMMENT ON COLUMN public.vehicle_observations.citation_document_id IS
  'Structured citation — the library document this observation cites. Optional during transition; legacy citations remain as strings in structured_data.citation. New writes SHOULD populate this when citing a library document.';

NOTIFY pgrst, 'reload schema';

COMMIT;
