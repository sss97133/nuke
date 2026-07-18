# Skins & Source Fidelity

*A skin renders the one universal vehicle profile in a source's visual language. It must be reverse-engineered from the **real source markup**, never from memory. A skin is `businesses.brand_design_language` for that business entity — the render surface reads it, not a hardcoded theme.*

## Method (no hallucination)

1. **Get authentic markup.** Most venues hard-block live fetchers (WebFetch/Firecrawl 403 on bringatrailer.com, carsandbids.com). Use our own archive: `listing_page_snapshots.html` holds the real captured page. Pull by anchored `listing_url like 'https://<host>/...%'` then slice the matched row **by id** (the table is large — never `%wildcard%` + substring across rows; it times out).
2. **Extract real tokens**: fonts (the `google-fonts` / `<link>` href), button/accent classes, section order, exact heading text, copy formats, component structure. Quote the evidence.
3. **Map Nuke atoms** to each slot.
4. **Only then render.** Exact hexes that live in external theme CSS (not archived) are marked "confirm via screenshot" — not guessed.

## Two camps: skinnability = postability

The property that makes a venue easy to **skin** is the same property that makes it easy to **post to**. Evidence:
- **BaT** — 580KB, semantic WordPress markup (`.essentials`, `.listing-post-title`, `.button-black`). Copy the HTML → instant accurate skin. Also extracts cleanly; clean submission path.
- **Facebook Marketplace** — 2.3MB, obfuscated atomic CSS (`x9f619 x1n2onr6 x1ja2u2z…`), behind a login wall. "Copy the HTML" yields a useless blob. Also: no API, bot-hostile, posting needs a rendered-browser agent.

Venues sort into two camps, identical for both directions:
- **Clean/semantic** (BaT, Craigslist, Hagerty) → skin by copying the source HTML; extract/post via clean paths.
- **Obfuscated SPA + auth wall** (FB, Cars & Bids, Bonhams-Next.js) → skin from the **rendered DOM / screenshot** (the source is machine-garbage); post via the agent-pilot rendered-browser mechanism.

So "copy the HTML" is the method for camp 1. For camp 2 the unit is the rendered output, captured the same way the auto-pilot poster drives the page. **Skinning-difficulty and posting-difficulty are one variable.**

## Source status

| Source | Authentic source available? | Spec |
|---|---|---|
| Bring a Trailer | ✅ archived HTML (`listing_page_snapshots`) | **done — below** |
| Cars & Bids | ⚠️ archive holds only the React **nav shell** — listing content is client-rendered, NOT captured | SPA camp — needs rendered-DOM/screenshot capture; copy-HTML can't work |
| Hagerty Marketplace | ✅ archived (extract-hagerty-listing) | todo |
| Bonhams (apex pole) | ✅ archived (`cars.bonhams.com`) | **structure done** — sale│date│venue line, Estimate range, `Chassis no.` format, white wordmark on dark header. Next.js self-hosts the font → exact typeface/palette pending a screenshot pass |
| RM Sotheby's / Mecum | likely archived via auction discovery | todo |
| Craigslist | ✅ extractor exists | todo (vernacular pole) |
| Facebook Marketplace | obfuscated SPA + login wall | **EXCLUDED per Skylar** |
| eBay (old style) · AutoTrader (print) · ClassicCars | retro/print — need period reference images, NOT live markup | todo — flag: needs external reference, can't pull from archive |

Order: do the **value-axis poles first** (BaT done → RM/Bonhams apex → Craigslist vernacular), so the spectrum reads in three glances before filling the middle.

---

## Skin Spec: Bring a Trailer

*Reverse-engineered from authentic archived markup — `listing_page_snapshots`, listing `2005-ford-excursion-179`, Lot #236,225, http 200, 580KB. Evidence quoted inline.*

### Real tokens (evidence-based)
- **Font: Open Sans** — 400 / 600 / 700 + italics. Evidence: `<link id='google-fonts-css' href='https://fonts.googleapis.com/css?family=Open+Sans:400italic,600italic,700italic,400,600,700'>`. (Not Arial/Helvetica.)
- **Primary action button: black** — class `button button-black`. Evidence: `<a class="button button-black" href="#listing-bid">`. (Not green.)
- **Palette**: light/white background, near-black text, monochrome with small colored tags (country flag). Exact hexes are in the external theme stylesheet (not archived; BaT blocks fetch) → **confirm via screenshot before final render**, do not guess.

### Real structure & copy (top → bottom)
1. **Title** `<h1 class="post-title listing-post-title">` = `{Year} {Make} {Model} {Trim}` only. SEO/page title format = `No Reserve: {title} for sale on BaT Auctions - sold for ${X} on {date} (Lot #{n,nnn})` — the **"No Reserve:" prefix** and **`Lot #`** (comma-formatted) are real.
2. **Item tags** under title: country flag SVG + currency code (`item-tag item-tag-currency` → flag + "USA").
3. **Availability bar** `listing-available-info`: ended → `Sold for USD $37,000` + localized date (`on 4/3/26`); live → current bid + `button-black`. Comments anchor: comments icon + `47 Comments` (`info-value` + `info-label`).
4. **Photo gallery**: large hero + grid (Hearst/Nitehawk player for video).
5. **BaT Essentials** `<div class="essentials"><h2 class="title">BaT Essentials</h2>` — order is fixed:
   - `Seller: {username}` (linked, + subscribe bell `item item-seller`)
   - `Location: {City, State ZIP}` (linked to Google Maps)
   - `Listing Details` → `<ul>`: `Chassis: {VIN}` (linked to a VIN search), `{mileage}k Miles` (**abbreviated**), `{engine spelled out}`, `{transmission}`, `{transfer case/drivetrain}`, `{differential}`, … full-spelled spec bullets.
6. **Description**: one flowing narrative in paragraphs — **not** labeled highlight/equipment/flaw blocks.
7. **Comments**: threaded vote/reply; count mirrored in the availability bar.

### Nuke atom mapping
- Title ← year/make/model/trim · Chassis ← `vin` · mileage ← render `{round(mi/1000)}k Miles` · engine/trans/drivetrain ← identity
- Seller ← owner/lead-contributor handle · Location ← city/state
- Availability bar ← `listing_exports` status (armed → "Listing"); a Nuke estimate must be **labeled "Nuke estimate," never "Current Bid"**
- Description ← `listing_content.description`

### Homage / honesty rules
- Brand mark stays `NUKE · skin in the style of Bring a Trailer`.
- Never fabricate a live bid or auction result. Estimates are labeled as Nuke valuations.

### Correction log (what the from-memory v0 got wrong)
green button → **black**; Arial → **Open Sans**; flat fact-list → **Seller / Location / Listing Details** order; missing **No Reserve:** prefix, **Lot #**, **country-flag tag**, abbreviated **"{n}k Miles"**, and **linked Chassis**.

---

# Continuation brief — venue skins (for the working agents)

*Read this before touching the skin system. The answers are in the repo; lean on the ecosystem below instead of re-deriving. Don't add knowledge to root — this doc is the home.*

## The goal: distill, don't clone
A skin presents Nuke's one universal vehicle profile in a venue's design language. **Two layers — never confuse them:**

- **The clone is the ORACLE, not the product.** Serving the venue's *real* archived HTML+CSS (in a real browser, with the subject vehicle's data swapped in) is the ground-truth reference. Proven on BaT: the 2005-Excursion snapshot, data swapped → Boss 302, all images repointed, served via the preview server → renders pixel-faithful (real BaT header/nav/two-column/typography). Use the oracle to (a) **distill** the design DNA and (b) **validate** fidelity. It is the venue's copyrighted markup — it NEVER ships.
- **The distilled skin is the PRODUCT.** Re-express the venue's DNA — tokens (font/palette), `layout` (region map), signature components — as **Nuke's own** `skin_spec` → `VenueSkin`. Branding is Nuke; design cues are the venue's. This ships, and it must match the oracle side-by-side.

The original failure was distilling from memory → generic color-swap cards. **The rule: distill FROM the oracle, measure AGAINST the oracle.**

## Per-venue workflow
1. **Get the real page** — `listing_page_snapshots.html` (archived) or render via `_shared/firecrawl.ts` (`firecrawlScrape`) / `archiveFetch({useFirecrawl:true})` for SPAs. (C&B/Hagerty extractors already use it — don't mint a fetcher.)
2. **Render the oracle** — swap data→subject vehicle, ALL images→its photos, price→Nuke estimate, hide the donor's comments, add the NUKE banner; serve in a **real browser** (preview server `nuke-frontend`) and `preview_screenshot` at **1280×900** (native viewport defaults to 2px — set it explicitly). The visualize widget CANNOT show venue images (CSP blocks the host) — that is why widget previews are gray; use a real browser.
3. **Distill the DNA** into a `skin_spec`: tokens read from the real CSS (BaT = Open Sans + black button; pull the real `<link>` font + computed colors), `layout` (`single`|`sidebar-right`), per-section `region` (`top`/`main`/`sidebar`), signature `section` types.
4. **Render the native skin** (`VenueSkin`), screenshot, **diff against the oracle** until it reads unmistakably as that venue.
5. **Promote** the spec to `organizations.brand_design_language` (canonical home, currently null) — needs Skylar's go for the canonical write; runs from `skinSeeds` staging until then.

## The ecosystem — lean on this
- **Oracle source / template library:** `listing_page_snapshots` (real archived markup; BaT proof id `a627ed2e-…`). Pull by **anchored** `listing_url like 'https://host/…%'`, slice **by id** — the table is huge; never `%wildcard%` + substring across rows (times out).
- **Venue entities:** 22 venue orgs in `organizations` (slugs; `brand_design_language` = skin home; `ui_config` empty). Dupes (`bonhams` vs `bonhams-cars`, `bring-a-trailer-4`) — pick canonical.
- **DOM maps (structure already reverse-engineered — read, don't guess):** `extract-cars-and-bids-core` (dl/dt-dd, `.dougs-take`, `.bid-stats`), `extract-hagerty-listing` (`__NEXT_DATA__` auction object), `extract-craigslist` (`ld_posting_data` + attr spans), `extract-ebay-motors` (item specifics), `bat-simple-extract`.
- **Product code:** `nuke_frontend/src/services/skinSpec.ts` (schema + validator + binding DSL + `layout`/`region`), `skinSeeds.ts` (staged specs — BaT faithful, 5 others still single-column), `components/listing/VenueSkin.tsx` (data-driven, region-aware renderer + `bidbar`/`comments`/`specs` sections; `reply`/`feedback`/`callout` declared, not yet rendered), `pages/vehicle-profile/VenueSkinPreviewCard.tsx` ("Preview as Venue", mounted, owner-gated). Tests: `services/__tests__/skins.test.ts`.
- **Submit side (built):** `ChannelSwitchboard` + `services/channelAdapters.ts` — the skin's bound content is the submission payload.
- **Real vehicle data:** `prepare_listing` / `get_vehicle` MCP. Bind live atoms; never retype/fabricate.
- **Doctrine:** `~/.claude` memory feedback — *no fabricated/mixed data in design surfaces* (cardinal), *everything is an org-entity with service provenance*, *develop from what exists*, *don't mint*.

## Hard constraints
- FACTS SACRED: real vehicle data; estimates labeled "Nuke estimate", never a live bid; **never** leave a donor listing's data/photos/comments in a skin (full swap or hide — the contamination check). The BaT oracle leaked "Ford Excursion" in the got-away banner until scrubbed — grep the output for donor strings.
- CREATIVITY bounded to FORM (styling yes, facts no). DON'T MINT (reuse firecrawl/archiveFetch; no new fetcher/table). The oracle clone is a dev artifact — never deploy venue HTML/CSS publicly.

## Status / worklist
- **Engine:** `layout`/`region` + `bidbar`/`comments`/`specs` sections — built, typechecks, 6 tests green.
- **BaT:** faithful two-column native skin done; oracle clone proven.
- **Remaining** (distill native from oracle + real tokens + validate side-by-side): **Cars & Bids** (sidebar + Doug's Take + bid-stats), **Craigslist** (cramped, reply/QR/map, price-first), **eBay classic** (right-rail Buy-It-Now + feedback), **Hagerty**, **Bonhams**. **FB excluded** (Skylar).
