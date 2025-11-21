# Frontend Cleanup Report

## Archive Action

The following "legacy" files were moved to `archive/frontend_legacy/` to declutter the workspace:

### Pages
- `DashboardNew.tsx` (Abandoned experiment)
- `OrganizationProfileNew.tsx` (Redundant)
- `ProfileSimple.tsx` (Redundant)
- `PublicVehicleProfile.tsx` (Deprecated/Legacy)
- `OrganizationProfile.tsx.bak` (Backup)
- `BusinessManagement.tsx` (Commented out in App.tsx)

### Components
- `_archive_document_uploaders/` (Explicit archive)
- `VehicleProfileWindows95.tsx` (Joke/Test component?)
- `VehicleIntelligenceDashboard.tsx` (Replaced)
- `VehicleDataEditorEnhanced.tsx` (Replaced)
- `VehicleProfileTrading.tsx` (Replaced)
- `RevolutionaryPricingDashboard.tsx` (Replaced)

### Hooks
- `useTimelineEvents.ts` (Seems to be replaced by direct service calls or newer hooks, grep showed low usage)
- `usePermissions.tsx` (Shadowed by `useVehiclePermissions` and `useCommonPermissions`)

## Recommendation
If the site runs stable for 2 weeks, delete `archive/frontend_legacy/`.

