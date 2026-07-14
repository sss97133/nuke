# McMaster-Carr as Speed & Density Benchmark

**Date**: 2026-05-24
**Status**: Reference study — external system to learn from. Cited by `docs/library/technical/design-book/frontend-doctrine.md` §2b and `.claude/rules/frontend.md` performance targets.
**Trigger**: Skylar 2026-05-24 — *"mcmaster is a great ref to increase speed of the ui you should look at the structure so you can ref it in ui redesign or rules in the agents library."*

---

## Why It Matters

McMaster-Carr (mcmaster.com) is the parts catalog for North American mechanical engineering — 750,000+ SKUs, sub-second page loads, zero marketing copy, and an interface that engineers navigate by muscle memory. It is widely considered one of the fastest commerce/catalog sites on the internet. The stack is "outdated" (ASP.NET + jQuery + YUI, no React, no Vue, no SPA) — and that's the point. They optimize for **the user finishing a task**, not for resume-driven engineering.

It is the natural UX north-star for nuke.ag's parts/builds/supply-side surfaces, and the speed/density philosophy generalizes to every projection in the doctrine.

## What They Do (Verified 2026-05-24)

### 1. Server-rendered HTML, no SPA
The full HTML is in the first byte. No `<div id="root">` waiting for a JS bundle to hydrate. ASP.NET templates render the page server-side, Akamai CDN caches the rendered HTML at edge POPs worldwide. First Contentful Paint is essentially "time-to-first-byte."

### 2. Critical CSS inlined
The most important styles are embedded directly in the HTML `<head>`, so layout and typography apply on first paint. No render-blocking CSS request.

### 3. Intelligent JS bundling per page
Each page loads only the JavaScript it actually needs. No 2MB monolithic bundle. jQuery + YUI for what they need; nothing fancier.

### 4. Hover-prefetch
Mouse over any link → the destination's HTML is silently prefetched in the background → click feels instant. The trick that makes the site feel like it has no latency at all. Conceptually identical to Next.js `<Link prefetch>` but implemented in vanilla JS over a server-rendered site in ~2010.

### 5. Image sprites + fixed dimensions
Every image has explicit width/height. Zero Cumulative Layout Shift. Multiple small UI images packed into sprite sheets to reduce HTTP request count. (Modern browsers + HTTP/2 reduce the sprite need, but the fixed-dimension rule still applies — and McMaster keeps doing it because it works.)

### 6. Hierarchical faceted navigation
27 top-level category tiles on the homepage, three tiers deep (category → subcategory → product). Plus duplicate text-based category lists for SEO and keyboard navigation. Faceted spec filters appear once inside a product class (e.g., bolts → filter by material, length, thread, head type, drive type, finish, with live counts).

### 7. Zero marketing surface
No hero rotator. No testimonials. No "Why McMaster?" page. No newsletter modal. No promotional banners. No animation. The homepage is the catalog directory and a phone number. Their value proposition is *"you find what you need and leave."* Skylar's directive — *"ui the data to infer and then call to action confirm, coordinate and deliver"* — is structurally identical.

### 8. Layout stability over decoration
Same shape on every page. Engineers develop muscle memory. No A/B test redesigns. No seasonal themes. The page you visited in 2015 has the same skeleton as the page you visit in 2026.

## Performance Targets (Target These)

Working backwards from McMaster's measured behavior:

| Metric | McMaster (typical) | Our target | Why |
|---|---|---|---|
| Time to First Byte | <100ms | <200ms | Edge-cached HTML over Vercel |
| First Contentful Paint | <300ms | <500ms | SSR + inlined critical CSS |
| Largest Contentful Paint | <800ms | <1.5s | Fixed-dim images, no JS-blocking |
| Cumulative Layout Shift | ~0 | <0.05 | Reserved space for all media |
| JS bundle (per page) | <80kb | <150kb | Code-split per route |
| Hover→prefetch | yes | yes | Vite + react-router hover prefetch |

## What to Steal

### Steal directly (cite this study in PRs)
1. **Hover-prefetch on every internal link.** The single most impactful perceived-latency win. Implementation: react-router `Link` with prefetch helper, OR a generic `onMouseEnter` handler that fetches the destination route's data.
2. **Fixed image dimensions everywhere.** Already a `frontend.md` rule for sticky positioning; should be a rule for all `<img>` and lazy-loaded media too.
3. **Inline critical CSS.** Vite config can extract above-the-fold CSS into the HTML payload. ~20 LOC change in `vite.config.ts` once measured.
4. **Faceted attribute filters with live counts.** §2b of the doctrine names Flamenco; McMaster is the live production-grade demonstration. Our parts/supply-side surface (per `.claude/rules/supply-side.md`) gets this UX directly.
5. **Zero marketing surface on canonical pages.** Doctrine §5 already says "UI as call-to-action, not browser" — McMaster is the proof that this works at scale. Resist any urge to add a hero rotator to `/u/:handle` or `/v/:id`.
6. **Stability over reinvention.** Doctrine §3 (convergence point) and §6 (96-pages deletion gate) are the structural enforcement. McMaster is the cultural enforcement: pages don't change shape because users don't want them to.

### Adapt, don't copy
1. **Server-side rendering.** Vercel + Vite + React is our stack; we can't migrate to ASP.NET. But Vercel does support per-route SSR / ISR — the doctrine's "render is compute, not cache" axiom should be **re-examined** against McMaster's "edge-cached pre-render is the right answer for catalog-shaped data." Some lenses (entity briefing on a stable vehicle, faceted browse over parts) may be better as cached HTML than as live-computed React. **This is an open question worth profiling.**
2. **No animations.** `frontend.md` already says 180ms cubic-bezier for animations. McMaster does ~0ms (no animations at all). For the user profile / vehicle profile, the 180ms is acceptable for hover/expand interactions. For *navigation* between pages, McMaster's instant-via-prefetch is the model — no fade transitions, no loading spinners (because there's no wait).

## Future Integration: McMaster API

Skylar tagged this as a side-quest 2026-05-24. McMaster offers a programmatic catalog API for OEM/business customers. For nuke.ag's supply-side surface, this is the natural integration: parts/fitment data flowing in from a canonical source with sub-second latency expectations.

Speculative integration shape (not designed here):
- Webhook ingestion when a build manifest references hardware (M6 bolt, AN-6 fitting, etc.) → query McMaster for canonical SKU + spec sheet → land as `parts_catalog` testimony with `source='mcmaster.com'`.
- Per `.claude/rules/supply-side.md`: parts prices are testimony with short half-lives. McMaster's pricing API would refresh price testimony on demand, not on a polling cron.

## What This Study Does NOT Argue

- That we should rewrite the frontend in ASP.NET. (We shouldn't.)
- That we should abandon React. (We shouldn't.)
- That we should remove all animations and styling. (We shouldn't — `frontend.md` has a clear visual language already.)
- That McMaster's IA is the right IA for nuke.ag specifically. (It's not — nuke is observation-centric, not catalog-centric.)

What we are arguing: **the speed and density philosophy** is universally correct for engineering audiences who use a tool to finish a task. Skylar's user base (mechanics, restorers, technicians, buyers, dealers) is structurally the same audience as McMaster's. Steal the philosophy. Adapt the implementation.

---

## Sources

- [7 Key Learnings from McMaster-Carr's Website — Anand Derick, Medium](https://medium.com/design-bootcamp/7-key-learnings-from-mcmaster-carrs-website-how-speed-and-stability-drive-great-ux-e290f7e59a5d)
- [The Surprising Tech Behind McMaster-Carr's Blazing Fast Website Speed — DEV Community](https://dev.to/svsharma/the-surprising-tech-behind-mcmaster-carrs-blazing-fast-website-speed-bfc)
- [Why This "Outdated" Website Is Actually a Speed Demon — Dev Genius](https://blog.devgenius.io/why-this-outdated-website-is-actually-a-speed-demon-a-deep-dive-into-web-performance-b3235e575f0e)
- [Why McMaster.com is One of the Fastest Websites — QRRY](https://www.qrry.com/2024/10/why-mcmaster-com-is-one-of-the-fastest-websites/)
- [Tip: Why Is This Website So Fast — Wes Bos](https://wesbos.com/tip/why-is-this-website-so-fast)
- ["Everything possible to make this website as fast as they can" — Unsung / Aresluna](https://unsung.aresluna.org/everything-possible-to-make-this-website-as-fast-as-they-can/)
- [The Secrets Behind the Fastest Website on the Internet — NashTech blog](https://blog.nashtechglobal.com/the-secrets-behind-the-fastest-website-on-the-internet-a-frontend-developers-breakdown/)
- [mcmaster.com homepage — primary source](https://www.mcmaster.com/)

*Study complete. No code modified. Frontend doctrine §2b and `.claude/rules/frontend.md` updated to cite this reference in companion edits.*
