# Handoff — Universal Input System (Phase 1 complete)

## What was done this session

### K10/K20 Data Fix
- Previous agent uploaded 419 K20 photos to K10's vehicle record (wrong --vehicle-id)
- Created K20 vehicle: `6ff6497c-784c-4cd7-adcf-28925f97d860` (VIN 1GCGK24M6EF375994)
- Moved photos + observations, uploaded correct K10 album (51 photos)
- Hardened `scripts/iphoto-intake.mjs` with `validateVehicleAlbumMatch()` — year/model check before upload

### Universal Input System — Phase 1 (COMPLETE)
Plan file: `.claude/plans/dreamy-imagining-yao.md`

All committed in `b66bf1a63`:
- `CommandLineLayout.tsx` — AIDataIngestionSearch replaces SearchBar in header
- `GlobalDropZone.tsx` (new) — window-level drag-drop → `nuke:global-drop` custom event
- `AppLayout.tsx` — wrapped with GlobalDropZone
- `AIDataIngestionSearch.tsx` — listens for `nuke:global-drop`, routes files to handlers
- `MobileBottomNav.tsx` — Inbox with badge (orphan vehicle_images count)
- `DomainRoutes.tsx` — `/inbox` → PersonalPhotoLibrary, `/photo-library` alias, `/team-inbox` for TeamInbox

## What's next (from the plan)

### Phase 1 remaining
- **Input type indicator** (task #7): badge below input showing detected type (URL/VIN/image/search) before Enter. Uses existing `contentDetector` service.

### Phase 2: Unified Inbox Page
- Enhance `PersonalPhotoLibrary.tsx` with tab bar: ALL | PHOTOS | URLS | DOCS | EMAILS
- Add URL inbox items (`url_inbox` table, 190 items) and email inbox (`contact_inbox`, 46 items)
- Add methods to `personalPhotoLibraryService.ts` for URL and document queries

### Phase 3: Onboarding Wizard
- Replace `OnboardingSlideshow.tsx` with 4-screen wizard (Welcome → Permissions → First Input → Done)
- First Input screen uses full-size AIDataIngestionSearch — completing it creates first vehicle

### Phase 4: Background Processing (deferred)
- `process-inbox-items` edge function — cron to auto-classify orphan photos via YONO

## Key files to know
- `AIDataIngestionSearch.tsx` — 1780-line universal input (URLs, VINs, images, text, paste, drag-drop)
- `PersonalPhotoLibrary.tsx` — photo inbox with AI suggestions and vehicle linking
- `personalPhotoLibraryService.ts` — service layer with `getUnorganizedPhotos()`, `VehicleSuggestion`
- Inbox tables: `user_photo_inbox` (2,942), `url_inbox` (190), `contact_inbox` (46)

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file
4. Register in `.claude/ACTIVE_AGENTS.md`
