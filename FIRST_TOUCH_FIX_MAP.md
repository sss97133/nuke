# First-Touch Fix Map

## Problem 1: Homepage has no interactive hook
- File: nuke_frontend/src/pages/HomePage.tsx
- Lines: 52-337 (LandingHero component)
- Current state: Static hero with text, search bar, two buttons ("Get Started Free", "Browse the Feed"), stat counter, feature grid, bottom links
- What's missing: No vehicle showcase, no "try it now" moment, no reason to scroll or click. No proof that real data exists.
- Severity: CRITICAL — this is the entire first impression

## Problem 2: OnboardingSlideshow is orphaned
- File: nuke_frontend/src/components/onboarding/OnboardingSlideshow.tsx
- Current state: 351-line component with 5 slides, emoji placeholders (AI, 📊, 📝, 💰, 🏢), never triggered from the homepage
- Only imported in: nuke_frontend/src/components/images/ImageGallery.tsx (not homepage)
- What's missing: Not connected to any first-touch user flow. Dead code from the homepage perspective.
- Severity: HIGH — dead code that was supposed to be the onboarding

## Problem 3: "No Image" fallback is generic
- File: nuke_frontend/src/components/vehicles/VehicleCardDense.tsx
- Lines: 2203-2221
- Current state: Vehicles without images show grey background with dashed border and "No Image" text in 12px muted color. ResilientImage uses /nuke.png placeholder at 0.25 opacity.
- What's missing: A useful fallback showing year/make/model prominently, data point count, and source indicators
- Severity: HIGH — makes the feed look broken/empty to new users

## Problem 4: Feed has no first-visit context
- File: nuke_frontend/src/pages/CursorHomepage.tsx
- Current state: Raw data grid with tier labels ("F tier · 1 data point"), filters, and sort options. No explanation for first-time visitors.
- What's missing: A first-visit context banner explaining what the user is looking at
- Severity: MEDIUM — power users love it, new users are lost

## Problem 5: Search page has no guided experience
- File: nuke_frontend/src/pages/Search.tsx
- Current state: Empty search box with quick-search pills
- What's missing: Inline search preview on the homepage, suggested searches with context
- Severity: MEDIUM — homepage search just redirects to /search with no preview

## Problem 6: About page is fine (no spinner)
- File: nuke_frontend/src/pages/About.tsx
- Lines: 1,607 lines of static content
- Current state: Pure static component with comprehensive technical documentation. NO loading spinner, NO async operations. All content renders immediately.
- Status: NOT BROKEN — the reported "infinite spinner" was either already fixed or was a different issue. No changes needed.
- Severity: NONE

## Problem 7: Signup gives zero reason to sign up
- File: nuke_frontend/src/components/auth/Login.tsx
- Lines: 501 lines
- Current state: Centered 320px-wide form with "Nuke / Vehicle Provenance Engine" header, sign in/sign up toggle, OAuth buttons (Google/GitHub), email/phone auth. No value proposition.
- What's missing: "Why sign up" column explaining benefits, specific numbers, what you get
- Severity: MEDIUM — functional but gives no reason to create an account

## Summary of Actual Changes Needed
1. ✅ Homepage Live Vehicle Showcase (Rule 1)
2. ✅ Homepage Inline Search Preview (Rule 2)
3. ✅ Replace No-Image Fallback (Rule 3)
4. ✅ First-Visit Context Banner on Feed (Rule 4)
5. ❌ About Page — already works, no fix needed
6. ✅ Signup Value Proposition (Rule 6)
7. ✅ Connect OnboardingSlideshow + "Take a Tour" button (Rule 7)
