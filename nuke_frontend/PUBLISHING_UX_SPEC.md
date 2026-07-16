# Publishing Module — UX Reading Path Specification

## Core UX Principle (from Vehicle Profile)

**The user never leaves the page to explore data.** Every click opens an inline expansion or stacking popup. The user drills deeper through popup stacks (Escape to back out), not page navigations. Page navigation only happens when switching to a fundamentally different entity.

The vehicle profile achieves this with:
1. **BadgePortal** — click badge → inline cluster panel or stacking popup
2. **PopupStack** — each deeper click pushes a new popup (20px offset), Escape closes top only
3. **Cross-column coupling** — click data in left column → right column gallery/view updates
4. **Inline drawers** — field provenance expands inline, doesn't navigate

Publishing module must follow the same patterns.

---

## Entity Relationship Map

```
PUBLICATION SERIES (e.g., "L'Officiel St Barth")
│
├── ISSUE (#11, #10, #9...)
│   ├── PAGE (87 pages per issue)
│   │   ├── page_type (ad / editorial / cover / masthead)
│   │   ├── brand_name (if ad)
│   │   └── story_title (if editorial)
│   │
│   ├── STORY ("James Perse", "Charly Sturm"...)
│   │   ├── page_range (pp. 49-59)
│   │   ├── credits (photographer, stylist, model)
│   │   └── brand_partner
│   │
│   ├── AD PLACEMENT (Bulgari p.4, Chanel p.22...)
│   │   ├── brand → ORG
│   │   ├── page_number
│   │   └── placement_type (full page, spread, etc.)
│   │
│   ├── MASTHEAD (credits page)
│   │   └── all staff with roles
│   │
│   └── PRODUCTION FILES (InDesign, PDFs, BATs)
│       ├── filename → parsed_stage, parsed_story
│       └── file_type, size, date
│
├── PERSON (photographer, editor, stylist...)
│   ├── role_spectrum (cited + observed + platform)
│   ├── reliability_score
│   ├── ghost_status
│   ├── email_activity (198K emails)
│   ├── imessage_activity (87K messages)
│   ├── production_credits → links to issues/publications
│   └── aliases (multiple emails = same person)
│
├── ORGANIZATION (brand, agency, printer...)
│   ├── org_type (business, personal_email_provider, etc.)
│   ├── parent_org → child_org chains
│   ├── contact_count, email_count
│   └── relationship to publications (advertiser, printer, licensor)
│
└── PRODUCTION FILES (101K files across archives)
    ├── file_type (InDesign, PDF, image, PSD)
    ├── production_role (layout, BAT, print_ready, ad_creative)
    ├── parsed_publication, parsed_issue, parsed_story
    └── content_hash (for dedup)
```

Data volumes: 198K emails, 87K iMessages, 87 magazine pages, 4,643 credits, 17,980 people, 4,277 orgs, 101K production files, 54K relationship edges, 84K threads.

---

## Page Architecture (Only 3 Pages)

The vehicle system has essentially ONE page (VehicleProfile) with popups for everything else. Publishing should follow the same pattern but needs a few entry points:

### Page 1: `/publishing` — Publishing Dashboard
Entry point. Shows all publication series as cards.

### Page 2: `/publishing/:slug` — Publication Profile
The MAIN page. Like VehicleProfile, this is the convergence point. All data is explorable from here through popups and inline expansions. The user should be able to explore issues, people, orgs, pages, stories, ads, production files — ALL from this one page via stacking popups.

### Page 3: `/publishing/people` — People Directory
A table/list view for browsing professionals. Clicking a person opens a PersonPopup on the publication profile, or navigates to the publication where they have the most credits.

---

## Click-Through Chains

### Publication Profile — Master Reading Path

The Publication Profile is the convergence point. Everything is reachable from here.

```
PUBLICATION PROFILE (/publishing/lofficiel_stbarth)
│
├── SUB-HEADER BADGE BAR
│   ├── [MAGAZINE] badge → click → inline panel: type details, frequency, ISSN
│   ├── [14 ISSUES] badge → click → inline panel: issue list with mini-cards
│   ├── [1,045 PEOPLE] badge → click → popup: PeoplePopup (sortable table, filterable)
│   ├── [FRENCH] badge → click → inline panel: language + territory details
│   ├── [2013-2026] badge → click → inline panel: timeline density view
│   └── [JALOU MEDIA GROUP] badge → click → popup: OrgPopup (parent org, ownership chain)
│
├── TIMELINE BAR (BarcodeTimeline adapted)
│   ├── Each year segment → click → inline: IssueCard popup for that year's issue
│   ├── Color = email volume density
│   └── Hover = tooltip with issue # + email count + key events
│
├── LEFT COLUMN — DATA WIDGETS (collapsible)
│   │
│   ├── ISSUES WIDGET
│   │   ├── Each issue row: [#11] [87p] [2025-01-08] [▸]
│   │   │   └── click → pushes IssuePopup onto PopupStack
│   │   │       ├── Shows: flatplan strip, stories, ads, credits, production stages
│   │   │       ├── Click story → pushes StoryPopup
│   │   │       │   ├── Shows: page range, photographer, stylist, model, brand
│   │   │       │   ├── Click photographer name → pushes PersonPopup
│   │   │       │   ├── Click brand name → pushes OrgPopup
│   │   │       │   └── Click page range → right column updates to show those pages
│   │   │       ├── Click ad → pushes AdPopup
│   │   │       │   ├── Shows: brand, page, placement type, rate card price
│   │   │       │   └── Click brand → pushes OrgPopup
│   │   │       ├── Click person in credits → pushes PersonPopup
│   │   │       └── Escape → closes IssuePopup, back to publication profile
│   │   └── Issue count badge in header → no action (static count)
│   │
│   ├── MASTHEAD WIDGET (for latest issue with PDF data)
│   │   ├── Each person row: [PERSON NAME] [CREATIVE DIRECTOR & EDITOR-IN-CHIEF]
│   │   │   └── click → pushes PersonPopup
│   │   │       ├── Role spectrum (cited vs observed bars)
│   │   │       ├── Reliability score + ghost status
│   │   │       ├── Production credits across all publications
│   │   │       ├── Email + iMessage activity summary
│   │   │       ├── Click publication in their credits → scrolls to that issue in Issues widget
│   │   │       └── Click org in their affiliations → pushes OrgPopup
│   │   └── "View full masthead" → expands to show all staff
│   │
│   ├── TOP CONTRIBUTORS WIDGET
│   │   ├── Each row: [Name] [Role badge] [Credit count]
│   │   │   └── click → pushes PersonPopup (same as masthead click)
│   │   └── Sorted by credit count descending
│   │
│   ├── BRAND PARTNERSHIPS WIDGET
│   │   ├── Each row: [Brand name] [Type badge] [Issues involved]
│   │   │   └── click → pushes OrgPopup
│   │   │       ├── Shows: org info, parent company, all ad placements, email volume
│   │   │       ├── Click parent org → pushes parent OrgPopup
│   │   │       └── Click issue where they advertised → scrolls Issues widget
│   │   └── Sorted by total ad placements descending
│   │
│   ├── PRODUCTION PHASES WIDGET
│   │   ├── Phase bars: [Photography ████████ 1,596] [Design ████████ 1,620]
│   │   │   └── click phase → right column filters to production files of that phase
│   │   └── Phases from email subject keyword analysis
│   │
│   └── ORGANIZATION CHAIN WIDGET
│       ├── Tree view: Jalou Media Group → Editions Jalou → L'Officiel St Barth
│       │   └── click any node → pushes OrgPopup
│       └── Shows ownership/license relationships
│
├── RIGHT COLUMN — VISUAL / CONTEXTUAL
│   │
│   ├── COVER GALLERY (latest issue covers)
│   │   ├── Grid of cover images from cover_image_url
│   │   │   └── click → pushes IssuePopup for that issue
│   │   └── Hover → shows issue number + date
│   │
│   ├── PRODUCTION FILES BROWSER
│   │   ├── File type filter: [All] [InDesign] [PDF] [Image] [PSD]
│   │   ├── Stage filter: [All] [Maquette] [BAT] [Print] [Final]
│   │   ├── Each file row: [icon] [filename] [type badge] [stage badge] [size]
│   │   │   └── click → pushes FileDetailPopup
│   │   │       ├── Full path, parsed metadata, modification date
│   │   │       ├── If image: thumbnail preview
│   │   │       └── If linked to issue/story: click links
│   │   └── Coupled to left column: clicking phase in Production Phases → filters files to that stage
│   │
│   ├── MONTHLY ACTIVITY CHART
│   │   ├── Bar chart showing email volume per month
│   │   ├── Click bar → left column highlights the issue produced in that month
│   │   └── Greyscale with chart palette vars
│   │
│   └── STATS PANEL
│       ├── Total emails, unique people, unique orgs, financial signals
│       ├── All in Courier New 9px
│       └── No clicks (static summary)
│
└── POPUP DEFINITIONS (reusable across all publishing pages)
    │
    ├── IssuePopup
    │   ├── Issue # + date + page count header
    │   ├── FLATPLAN STRIP: colored rectangles per page (ad=purple, editorial=green)
    │   │   └── click page → FlatplanPagePopup (page details, brand/story, content type)
    │   ├── STORIES section: each story clickable → StoryPopup
    │   ├── ADS section: each ad clickable → AdPopup
    │   ├── CREDITS section: each person clickable → PersonPopup
    │   └── PRODUCTION STAGES: brief → photography → layout → BAT → print → published
    │
    ├── PersonPopup
    │   ├── Name + primary role header
    │   ├── ROLE SPECTRUM: cited roles (from mastheads) + observed roles (from email data, horizontal bars)
    │   ├── RELIABILITY: overall score, 6 sub-scores as thin bars, ghost status badge
    │   ├── CREDITS: grouped by publication, each with role + date range
    │   │   └── click publication → scrolls/highlights in Issues widget
    │   ├── ACTIVITY: first seen, last seen, email count, iMessage count, active months
    │   └── ALIASES: if multiple emails, show all (expandable, click to copy)
    │
    ├── OrgPopup
    │   ├── Org name + type header
    │   ├── HIERARCHY: parent/child org tree
    │   │   └── click parent or child → pushes new OrgPopup
    │   ├── PUBLICATIONS: which publications they advertise in / partner with
    │   ├── CONTACTS: top people at this org by email volume
    │   │   └── click person → pushes PersonPopup
    │   ├── STATS: email count, contact count, first/last seen, financial signals
    │   └── AD PLACEMENTS: all ad placements across all issues
    │
    ├── StoryPopup
    │   ├── Story title + type + page range header
    │   ├── CREDITS: photographer, stylist, model, writer — each clickable → PersonPopup
    │   ├── BRAND: brand partner — clickable → OrgPopup
    │   ├── PAGES: page numbers with page type indicators
    │   └── FILES: production files linked to this story (InDesign, PDFs, images)
    │
    ├── AdPopup
    │   ├── Brand name + placement type header
    │   ├── PAGE: page number, left/right indicator
    │   ├── FINANCIAL: rate card price, actual price, payment type
    │   ├── BRAND ORG: clickable → OrgPopup
    │   └── AD FILE: if we have the PDF, show thumbnail
    │
    ├── FileDetailPopup
    │   ├── Filename + type badge header
    │   ├── Full path, size, modification date
    │   ├── PARSED METADATA: publication, issue, story, version, stage
    │   ├── If image: thumbnail or preview
    │   └── LINKS: click publication/issue/story → scrolls/highlights in main page
    │
    └── FlatplanPagePopup
        ├── Page # + type badge header
        ├── Content: brand name (if ad) or story title (if editorial)
        ├── Spread info: left/right page, partner page
        └── Click story → StoryPopup, click brand → OrgPopup
```

---

## Cross-Column Coupling Rules

When the user interacts with the left column, the right column responds:

| Left Column Action | Right Column Response |
|-------------------|----------------------|
| Click production phase bar | Files browser filters to that stage |
| Click issue | Cover gallery highlights that issue's cover |
| Click brand in partnerships | Files browser filters to that brand's ad files |
| Hover over issue | Monthly activity chart highlights that issue's production months |

When the user interacts with the right column, the left column responds:

| Right Column Action | Left Column Response |
|--------------------|---------------------|
| Click month in activity chart | Issues widget highlights the issue from that period |
| Click file with parsed_issue | Issues widget scrolls to that issue |
| Click cover image | Issues widget highlights + IssuePopup opens |

---

## Popup Stack Behavior

Same rules as vehicle profile:
1. Each popup pushes onto the stack
2. Visual offset: 20px right + 20px down from previous
3. Draggable by title bar
4. Expand button (+) toggles full width
5. X closes this popup only
6. Escape closes TOP popup only
7. Click dim overlay closes TOP popup only

**Max recommended stack depth:** 4 (Publication → Issue → Story → Person). Deeper than 4 becomes confusing.

---

## Badge Bar Design

Publication Profile sub-header badges:

```
[MAGAZINE] [ANNUAL] [14 ISSUES] [1,045 PEOPLE] [429 ORGS] [FR] [2013 — 2026] [JALOU MEDIA GROUP]
```

Each badge:
- 8px, uppercase, letter-spacing 0.1em, font-weight 600
- 2px 6px padding, 1px solid border
- Hover: border darkens, slight background change
- Click: opens inline cluster panel OR pushes popup (depending on data depth)

Badge grouping with gaps:
- Group 1 (Identity): type, frequency — 4px gap
- Group 2 (Scale): issues, people, orgs — 4px gap  
- Group 3 (Meta): language, date range, parent org — 4px gap
- Between groups: 12px gap

---

## Navigation Between Pages

Only THREE page navigations exist:

1. `/publishing` → `/publishing/:slug` — Click publication card on dashboard
2. `/publishing` → `/publishing/people` — Click "People" link in dashboard nav
3. `/publishing/people` → `/publishing/:slug` — Click person's primary publication

Everything else is popup-based exploration within the current page. The user should be able to explore the entire data universe from ANY of these three pages without navigating away.

---

## Reading Path Examples

### "Who shot the cover of Issue #11?"
```
Dashboard → click L'Officiel St Barth card
  → Publication Profile loads
    → Issues widget → click #11 row
      → IssuePopup opens
        → Credits section shows: Photographer: Skylar Williams
          → click Skylar → PersonPopup opens
            → Role spectrum shows: Cited: Photographer. Observed: 32% casting, 28% photography...
            → Escape back to IssuePopup
        → Escape back to Publication Profile
```

### "Which brands advertise with us?"
```
Dashboard → click L'Officiel St Barth card
  → Publication Profile loads
    → Brand Partnerships widget shows all brands with ad counts
      → click Bulgari → OrgPopup opens
        → Shows all ad placements across all issues
        → Shows parent: LVMH group (if in org_relationships)
        → Shows contacts at Bulgari who emailed us
          → click contact → PersonPopup
        → Escape back to Publication Profile
```

### "Is this photographer reliable?"
```
Dashboard → People directory
  → Search "[photographer name]"
    → click row → PersonPopup opens (or navigate to their primary pub)
      → Reliability: 0.72 overall, 15hr avg response, active ghost status
      → Role spectrum: Cited Photographer, Observed 35% design + 30% photography
      → Credits: [publication] (720 emails, 9 years)
```

### "What went into producing Issue #11?"
```
Publication Profile → Issues widget → click #11
  → IssuePopup: 87 pages, 18 stories, 13 ads
    → Flatplan strip: visual page map (purple=ad, green=editorial)
      → click any page rectangle → FlatplanPagePopup
    → Production stages: assignment → photography → layout → BAT → print
    → Stories: James Perse (pp.49-59), Charly Sturm (pp.60-68)...
      → click story → StoryPopup with full credits
    → Right column: production files filter to Issue #11 files
      → Browse InDesign files, BAT proofs, final PDFs
```

---

## Build Order (Revised)

1. **PopupStack integration** — Import existing PopupStack from vehicle system OR build lightweight equivalent
2. **Publication Profile page** — The convergence point with left/right columns + badge bar
3. **IssuePopup** — First popup, opens from issue row click
4. **PersonPopup** — Opens from any person name click
5. **OrgPopup** — Opens from any org/brand name click
6. **StoryPopup + AdPopup + FlatplanPagePopup** — Detail popups
7. **Cross-column coupling** — Filter context shared between columns
8. **Dashboard** — Simple entry page with publication cards
9. **People directory** — Table page as alternate entry point
10. **Timeline bar** — BarcodeTimeline adaptation for publication activity

---

## Files Required

```
src/components/publishing/popups/
  IssuePopup.tsx
  PersonPopup.tsx
  OrgPopup.tsx
  StoryPopup.tsx
  AdPopup.tsx
  FileDetailPopup.tsx
  FlatplanPagePopup.tsx

src/components/publishing/widgets/
  IssuesWidget.tsx
  MastheadWidget.tsx
  ContributorsWidget.tsx  
  BrandPartnershipsWidget.tsx
  ProductionPhasesWidget.tsx
  OrgChainWidget.tsx
  FlatplanStrip.tsx
  ProductionFileBrowser.tsx
  MonthlyActivityChart.tsx
  StatsPanel.tsx
  RoleSpectrumDisplay.tsx
  ReliabilityDisplay.tsx
  CoverGallery.tsx

src/pages/publishing/
  PublishingDashboard.tsx    (entry page)
  PublicationProfile.tsx     (convergence point)
  PeopleDirectory.tsx        (alternate entry)

src/hooks/publishing/
  usePublicationData.ts      (fetches all data for a publication)
  usePublishingPopupStack.ts (popup state management)
  usePublishingFilter.ts     (cross-column filter coupling)

src/types/
  publishing.ts              (already exists, may need updates)
```
