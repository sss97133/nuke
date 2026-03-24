# User Adoption & Data Contribution — Design Brief

## The Problem

We have 668K vehicle profiles, 11,855 with validated VINs extracted today, millions of images. But 6 registered users and 1 with linked vehicles. The data is deep but the product has no intake funnel for humans.

The thesis: **create the starting point, make it findable, users contribute the rest.** A 1995 McLaren F1 (VIN `1A9MC99L9SA398062`, sold $13.2M at Gooding) exists in the system at 25% completion. The owner, insurer, historian, or next buyer finds it and enriches it.

## What Exists Today

### Infrastructure (built, unused)
- **Identity claiming**: 512K external identities (BaT usernames, auction house profiles). `request_external_identity_claim()` + `approve_external_identity_claim()` RPCs exist. 2 of 512K claimed.
- **Vehicle linking**: `user_vehicle_links` table. 11 links, 1 user.
- **Photo intake**: `image-intake` edge function, `ingest-photo-library` for iPhoto, presigned upload architecture. Mostly used by us, not users.
- **MCP connector**: Claude Code can interact with vehicles via MCP tools.
- **Observation system**: `ingest-observation` handles any data from any source with provenance tracking.

### What's Missing
- No public vehicle profile page (SEO/findability)
- No "claim this vehicle" flow on a profile page
- No data contribution UX (add a photo, correct a field, add maintenance record)
- No trust model for user-submitted data vs machine-extracted data
- No notification when someone enriches your vehicle
- No reason for a non-owner to contribute (community, reputation, access)

## User Types & Their Intake Methods

### 1. The Owner
**Who**: Owns the car. Found it by googling VIN or year/make/model.
**What they want**: See what's known about their car. Correct wrong data. Add their photos. Get a valuation. Prepare for sale.
**Contribution**: Photos (phone camera), maintenance records, purchase history, modifications, ownership chain.
**Intake method**: Web — mobile-friendly "claim & enrich" flow. Photo upload from camera roll. Maybe email-in (forward a receipt, get it parsed).

### 2. The Enthusiast / Historian
**Who**: Doesn't own the car but knows about it. Forum member. Registry participant. Spotted it at a show.
**What they want**: Contribute knowledge. See their contributions credited. Access deeper data.
**Contribution**: Sighting reports, historical context, factory spec corrections, period photos.
**Intake method**: Web form on vehicle profile. "Add a note" or "I know something about this car."

### 3. The Shop / Builder
**Who**: Works on the car professionally. Has invoices, work orders, photos of the build.
**What they want**: Document their work. Link to their shop profile. Use as portfolio.
**Contribution**: Work session photos, parts receipts, invoices, before/after documentation.
**Intake method**: Photo drop (bulk upload tagged to vehicle). Invoice email forwarding. Claude extension for structured intake during work sessions.

### 4. The Dealer / Auction House
**Who**: Selling the car. Needs listing package. Has professional photography.
**What they want**: Pre-built listing content. Valuation comps. Buyer qualification.
**Contribution**: Professional photos, condition reports, provenance documentation.
**Intake method**: API integration. Bulk CSV/JSON upload. Auction Readiness system (already designed, see `auction-readiness-strategy.md`).

### 5. The Passive Discovery
**Who**: Never heard of Nuke. Googled a VIN to check a car they're considering buying.
**What they want**: Quick answer — is this car legit? What's it worth? Any red flags?
**Contribution**: None initially. But they might create an account if the data is useful.
**Intake method**: SEO landing page per vehicle. No login required to view. Soft prompt to contribute after consuming value.

## The Core Funnel

```
FIND → VIEW → TRUST → CLAIM/CONTRIBUTE → RETURN
```

1. **FIND**: Google VIN, year/make/model. Social share. Forum link. Direct URL.
2. **VIEW**: Public vehicle profile with what we know. Sparse is fine — show confidence levels honestly.
3. **TRUST**: Show provenance (where each data point came from). Show what's verified vs unverified. Don't fake completeness.
4. **CLAIM/CONTRIBUTE**: "Is this your car?" or "Know something about this car?" Low-friction first action.
5. **RETURN**: Notification when someone else enriches the vehicle. Weekly digest of new data on watched vehicles.

## The Claude Extension Question

Claude extension as intake method works for Type 3 (shops) and maybe Type 1 (owners) who are already technical. It does NOT work for:
- Type 5 (passive discovery) — too high friction
- Type 2 (enthusiasts) — web form is faster
- Type 4 (dealers) — need API/bulk, not conversational

The extension is a power-user tool, not the primary funnel. The primary funnel is **the vehicle profile page itself** — public, SEO-indexed, with inline contribution actions.

## Trust Model for User-Submitted Data

Every user submission is an **observation** with:
- `source_type = 'user_contribution'`
- `trust_score` based on: account age, verification status, contribution history, claim status
- `verification_status`: unverified → community_verified → owner_verified → expert_verified

User data NEVER overwrites machine-extracted data directly. It creates a competing observation. The system shows both with provenance. Over time, consensus emerges.

An owner-verified claim has higher trust than a machine extraction. But a brand-new account claiming a $13M McLaren gets flagged for review.

## Key Design Decisions Needed

1. **Public profiles or login-gated?** Recommendation: public view, login to contribute. SEO requires public.
2. **What's the minimum viable profile page?** VIN + year/make/model + sale history + "claim this car" CTA.
3. **Photo contribution UX**: Camera upload? Email-in? Drag-and-drop? All three?
4. **Do we show data quality honestly?** "This vehicle is 25% documented" — does that help or hurt?
5. **Gamification**: Contribution leaderboards? Completion badges? Or keep it utilitarian?
6. **Mobile-first or desktop-first?** Owners take photos on phones. Historians research on desktops.
7. **Email intake**: Forward a receipt/document to `intake@nuke.ag`, it gets parsed and linked. Worth building?

## What To Build First

The minimum loop that proves the thesis:

1. **Public vehicle profile page** at `nuke.ag/vin/{VIN}` — shows what we know, links to sources
2. **"This is my car" button** — creates account + claim in one flow
3. **Photo upload on profile** — drag and drop, tagged to vehicle
4. **Email notification** — "Someone added data to your vehicle"

That's it. Four things. If an owner finds their McLaren F1, claims it, uploads 10 photos, and comes back when someone adds auction history — the loop works.

## Data We Have That's Immediately Findable

- 11,855 vehicles with validated VINs (extracted today from conceptcarz chassis numbers)
- ~120K vehicles with VINs from BaT, Mecum, C&B extractions
- 134K BaT vehicles with deep data (descriptions, comments, sale prices, images)
- 27K Facebook Marketplace vehicles (active listings, current asking prices)

Total VIN-findable vehicles: ~130K. That's 130K potential SEO landing pages.
