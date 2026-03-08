## Deprecated BaT scripts (archived)

These scripts were moved here because they invoke **deprecated BaT Edge Functions** (`import-bat-listing`, `comprehensive-bat-extraction`) and were repeatedly causing “wrong tool” runs.

### Use these instead

- **Canonical index**: `docs/EXTRACTION_TOOLKIT_INDEX.md`
- **BaT workflow (canonical)**: `docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md`
- **Single listing (two-step)**: `scripts/extract-bat-vehicle.sh`
- **Batch via queue**: `supabase/functions/process-bat-extraction-queue/index.ts`
- **Bulk entrypoint**: `supabase/functions/complete-bat-import/index.ts`
- **Live auctions ingest**: `npm run ingest:bat-live-auctions`
- **Results import**: `npm run import:bat-results`
- **Local partners import**: `npm run import:bat-local-partner-vehicles`

