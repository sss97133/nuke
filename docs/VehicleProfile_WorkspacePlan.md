## Vehicle Profile Workspace Overhaul

### Objectives
1. **Guided data entry:** contributors can upload photos, tag facts, and answer guardrail questions without hunting through modals.
2. **Live intelligence:** once data hits VIFF, the UI refreshes instantly with context-aware insights (timeline, valuations, commerce).
3. **Search-first navigation:** everything in a profile—facts, documents, events, people—should be one command away.
4. **Parity across desktop & mobile** so session debugging doesn’t regress again.

---

### Workspace Layout

```
┌─────────────────────────────┬──────────────────────────────┐
│ Left Rail (Command)         │ Center Stage (Evidence)      │
│ - Vehicle summary chip      │ - Evidence Intake Drawer     │
│ - Presence & activity       │   · Upload queue             │
│ - Quick actions (/ palette) │   · Guardrail questions      │
│ - AI status indicators      │   · Timeline preview         │
├─────────────────────────────┤                              │
│ Bottom rail (mobile tabs)   │ - Fact Runs (secondary)      │
└─────────────────────────────┴──────────────────────────────┘
│ Right Column (Live Intel)                                   │
│ - Fact Explorer (filters, heatmap, cards)                   │
│ - Visual timeline of uploads                               │
│ - Intelligent search + results                             │
│ - Financial snapshot (truth-based)                         │
└─────────────────────────────────────────────────────────────┘
```

---

### Key Modules

1. **Command Rail**
   - Replaces ad-hoc buttons in `VehicleHeader`.
   - Shows current state (uploads pending, facts awaiting review, valuation stale hours).
   - Hosts command palette (`Cmd+K` / `/`), using a shared `ActionRegistry` (JS map loaded from server).
   - Provides access to admin tools (merge proposals, presence list) in collapsible sections.

2. **Evidence Intake Drawer**
   - Consolidates `VehicleImageGallery`, `EnhancedImageTagger`, `AddEventWizard`, `VehicleDataEditor`.
   - Steps:
     1. **Upload** (drag/drop, mobile camera). Immediately shows thumbnails with status chips (queued, processing, completed).
     2. **Categorize** (document / component / damage / receipt). Each selection pre-loads guardrail question templates.
     3. **Guardrail Q&A** (render JSON-driven forms inline). Answers saved locally until submission; on submit we create the batch + timeline.
     4. **Review & Submit** (shows timeline event summary, auto-suggested tags, ability to link to existing work orders).
   - Drawer persists on mobile as bottom sheet (matching `MobileVehicleProfileV2`).

3. **Fact Explorer (Right Column)**
   - Data source: `vehicle_image_facts` + `image_fact_confidence`.
   - UI elements:
     - **Filters:** component, area, confidence, reviewer state, linked timeline event.
     - **Heatmap timeline:** horizontal scrollable strip of days with counts + colors (pending red, approved green).
     - **Fact cards:** show photo, summary sentence, confidence tags, quick actions (link to timeline, mark reviewed, open commerce flow).
     - **Inspector drawer:** clicking a fact opens detail with bounding boxes overlay, raw AI answer, guardrail question metadata, linked events, ability to escalate.

4. **Intelligent Search**
   - Search bar pinned at top of right column; typing opens results overlay (similar to Linear).
   - Federated results:
     - Facts (component/damage queries).
     - Timeline events.
     - Documents/receipts.
     - People/organizations linked to the vehicle.
   - Implementation: new backend RPC `vehicle_profile_search(vehicle_id uuid, query text)` that queries `vehicle_field_sources`, `vehicle_image_facts`, `vehicle_documents`, `timeline_events` via `tsvector`.

5. **Financial Snapshot**
   - Pulls from `vehicle_valuations` joined with `vehicle_valuations_components` (which now link to facts).
   - Shows:
     - Estimated value card with confidence badge.
     - Documented components list (pulls fact cards directly).
     - Required evidence checklist (VIN confirmed, odometer recent, receipts uploaded).
   - Embed `VisualValuationBreakdown` inside this module but slim down UI to match workspace style.

6. **Commerce Hooks**
   - Each fact card exposes CTA: “List part”, “Generate quote”, “Share with buyer”.
   - Tapping CTA opens Commerce Drawer referencing `commerce_opportunities`.
   - Financial section shows “ready for market” signals when components exceed threshold confidence.

7. **Mobile Parity**
   - `MobileVehicleProfileV2` adopts the same modules stacked vertically.
   - Upload button floats as FAB; fact explorer becomes horizontal scroll with quick filters.
   - All command palette actions exposed via bottom sheet (no hidden dev-only toggles).

---

### State & Data Strategy

- **Single source for vehicle data:** reorganize `VehicleProfile.tsx` into hooks:
  - `useVehicleSummary(vehicleId)` (basic vehicle, sale settings).
  - `useEvidenceWorkspace(vehicleId)` (assets, batches, pending questions).
  - `useFactExplorer(vehicleId)` (facts, filters).
  - `useValuationIntel(vehicleId)` (valuations + requirements).
- **Context Providers**
  - `VehicleWorkspaceProvider` holding `vehicle`, `permissions`, `viffSummary`, `commandRegistry`.
  - `FactFilterContext` for right column.
- **Event Bus**
  - Continue to fire `vehicle_images_updated` but expand with `vehicle_facts_updated` and `vehicle_workspace_command`.
  - Use `useEventListener` hook to keep modules decoupled.

---

### Interaction Principles

1. **Everything clickable should drill to facts** – hero image click opens fact explorer pre-filtered to that asset.
2. **No dead ends** – if financials can’t compute, show “Need odometer photo” with button to open intake drawer pre-filled.
3. **Microcopy** – remove emojis per style guide; use short, high-contrast labels consistent with Cursor design tokens.
4. **Animation restraint** – 0.12s transitions already defined in `design-system.css`; reuse for drawer slide and card hover.

---

### Implementation Phasing

1. **Scaffold workspace shell**
   - Create `VehicleWorkspaceLayout` component.
   - Move existing content into left/center/right placeholders without new functionality—ensures regression-free deployment.

2. **Evidence Intake consolidation**
   - Build `EvidenceDrawer` bridging uploader + question forms.
   - Deprecate standalone `AddEventWizard` & `VehicleDataEditor` modals once parity achieved.

3. **Fact Explorer & Search**
   - Ship read-only view first (fact cards from RPC), then add review actions.
   - Integrate VIFF data as soon as schema + pipeline land.

4. **Financial snapshot rewrite**
   - Connect to new `ValuationEvidenceBuilder` (Task 4) before removing `VisualValuationBreakdown`.
   - Gate FinancialProducts display until valuations have enough evidence.

5. **Mobile parity + polish**
   - Mirror workspace modules in mobile layout; ensure session/performance instrumentation stays intact.
   - Add end-to-end tests (Playwright) to confirm upload → fact → valuation loop works on production URL.

With this plan, the vehicle profile stops being a static dashboard and becomes an intelligent workspace where data entry, AI processing, and commerce actions live in one flow.

