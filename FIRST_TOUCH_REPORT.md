# First-Touch Engagement Overhaul — Report

## Date: 2026-02-27
## Files Modified:
1. `nuke_frontend/src/pages/HomePage.tsx` — Live vehicle showcase, inline search preview, "Take a Tour" button, OnboardingSlideshow integration
2. `nuke_frontend/src/components/onboarding/OnboardingSlideshow.tsx` — Trimmed from 5 slides to 3, replaced emoji placeholders with ASCII art, renamed header to "HOW IT WORKS"
3. `nuke_frontend/src/components/vehicles/VehicleCardDense.tsx` — Replaced generic "No Image" fallback with text-based vehicle identity card
4. `nuke_frontend/src/components/auth/Login.tsx` — Added "WHY SIGN UP" value proposition column for signup mode
5. `nuke_frontend/src/pages/CursorHomepage.tsx` — Added first-visit context banner (dismissible, localStorage-persisted)

## Files Created:
1. `FIRST_TOUCH_FIX_MAP.md` — Phase 2 audit document
2. `FIRST_TOUCH_REPORT.md` — This file

## Files Deleted:
- None

## Changes Summary:

### 1. Homepage Live Vehicle Showcase (Rule 1)
Added `useLiveShowcase()` hook that queries Supabase for 8 recent vehicles with `primary_image_url IS NOT NULL`, ordered by `created_at DESC`. Renders as a horizontal scrollable strip with dark cards (#1a1a1a), 1px #333 border, vehicle image thumbnail, name, and price. Auto-refreshes every 60 seconds. Has a green pulsing dot with "LIVE FEED — LATEST ARRIVALS" label. Falls back gracefully if Supabase returns an error (just doesn't show the section).

### 2. Homepage Inline Search Preview (Rule 2)
Added `useSearchPreview()` hook with 300ms debounce. As the user types in the homepage search bar, 1-5 results appear in a dropdown below the search bar with year/make/model and price. Clicking a result navigates to the vehicle page. Pressing Enter still navigates to /search. Dropdown has #1a1a1a background, #333 borders, #2a2a2a hover. Handles empty results with "No vehicles found for 'query'" message. Closes on outside click.

### 3. Replace No-Image Fallback (Rule 3)
Replaced the generic "No Image" grey dashed-border fallback in VehicleCardDense (line ~2203) with a text-based vehicle identity card:
- Dark background (#222)
- Year/make/model in 13px white bold uppercase
- "NO PHOTO YET" in 9px #666
- Data point count and source indicators in 9px #888

### 4. First-Visit Context Banner (Rule 4)
Added a dismissible inline banner at the top of CursorHomepage feed. Shows for users without `nuke_visited` localStorage key. Text: "YOU'RE LOOKING AT [count] VEHICLES FROM 50+ SOURCES. EVERY CARD IS A REAL VEHICLE WITH AUCTION DATA, PRICING, AND PROVENANCE. CLICK ANY CARD TO EXPLORE." Styled with #f5f5f5 background, 2px solid #ccc border, 10px ALL CAPS. Sets `nuke_visited=1` on dismiss.

### 5. About Page (Rule 5) — NO FIX NEEDED
The About page (`About.tsx`) is 1,607 lines of purely static content. It renders immediately with no loading spinners, no async operations, and no data dependencies. The reported "stuck on spinner" was either already fixed or a different issue. No changes made.

### 6. Signup Value Proposition (Rule 6)
Added a left column (flex: 0 0 280px) to the Login page that appears only in signup mode. Contains "WHY SIGN UP" header with four benefit items (Track Your Vehicles, Deal Scoring, Market Alerts, API Access), each with black square bullet, title in 10px uppercase bold, and description in 12px. Ends with "FREE FOREVER FOR COLLECTORS". The auth form stays in the right column at 320px width. In signin mode, the value prop column is hidden and the form centers normally.

### 7. Connected OnboardingSlideshow (Rule 7, Option A)
- Added "TAKE A TOUR" button to homepage hero area (third button alongside "Get Started Free" and "Browse the Feed")
- Trimmed from 5 slides to 3: "Drop a URL", "Explore the Database", "Track and Score"
- Replaced emoji placeholders with ASCII art diagrams showing real data flow
- Renamed header from "NUKE PLATFORM - FEATURE SHOWCASE" to "HOW IT WORKS"
- Existing navigation (previous/next), progress indicator, "SKIP TO SIGN UP", and "CREATE ACCOUNT" buttons preserved

## What Still Needs Work:
- **Image pipeline**: 1,671 vehicles had NULL `primary_image_url` (fix deployed same day — new vehicles now get it set automatically). Existing vehicles may still show the text fallback until backfilled.
- **Search preview**: Currently uses simple `ilike` matching. Could be improved with `universal-search` edge function for better fuzzy matching.
- **Showcase images**: Some vehicle images may be broken CDN URLs. The showcase relies on `primary_image_url` being valid — no broken-image fallback in the showcase strip itself.
- **Mobile responsive**: The signup value proposition two-column layout may need media query adjustment for mobile (currently flexbox wrapping handles it, but narrow screens may look cramped).

## Testing Notes:
- TypeScript compilation: PASS (0 errors)
- Vite production build: PASS (built in 9.17s)
- No dead imports introduced
- No console.log statements added
- OnboardingSlideshow import in ImageGallery.tsx left intact (it's used there independently)

## Before/After:
- **Homepage**: [static text, search bar, 2 buttons, stats, features] → [search bar with live preview dropdown, 3 buttons (+Tour), stats, live vehicle showcase strip with real images, features, tour modal]
- **Feed**: [raw data grid, no context for new users] → [first-visit context banner explaining the data + raw data grid]
- **About**: [already working, static content] → [no change needed]
- **Signup**: [bare centered auth form, no value prop] → [two-column layout with "WHY SIGN UP" benefits + auth form]
- **No-Image Cards**: [grey "No Image" text] → [dark text card with year/make/model, "NO PHOTO YET", data point count]
- **Onboarding**: [dead 5-slide component with emoji placeholders, never triggered] → [connected 3-slide "HOW IT WORKS" tour with ASCII art, triggered by homepage "TAKE A TOUR" button]
