# Publishing Module — Design Plan

## Scope (4-hour build)

A completely separate domain module for publishing, parallel to the vehicle module. No mingling. Own routes, own pages, own components. Same design system (8pt, Arial/Courier New, zero border-radius, Windows 95 aesthetic).

## Route Structure

```
/publishing                    → PublishingDashboard (overview of all publications)
/publishing/:slug              → PublicationProfile (e.g., L'Officiel St Barth)
/publishing/:slug/issue/:num   → IssueProfile (e.g., Issue #11, 87 pages)
/publishing/people             → PeopleDirectory (all professionals with role spectrums)
/publishing/people/:id         → PersonProfile (role spectrum + reliability + timeline)
/publishing/archive            → ArchiveExplorer (browse production files)
```

## Pages to Build (priority order)

### 1. PublishingDashboard.tsx
**Layout:** Single column, full width
**Content:**
- Header: "PUBLISHING" in 11px uppercase
- Stats bar: 8 publications | 18 issues | 1,092 professionals | 4,643 credits
- Publication cards grid (2 columns): each card shows name, type, issue count, email volume, date range
- Click card → PublicationProfile

### 2. PublicationProfile.tsx
**Layout:** 5-layer stack
- Sub-header badges: Type (Magazine) | Frequency (Annual) | Issues (14) | People (1,045) | Span (13 years)
- Timeline bar: BarcodeTimeline showing all issues by year, color = email volume
- Hero: latest issue cover (if available) or publication name display
- Left column: Publication info widget, Issues list (collapsible), Top contributors (top 20)
- Right column: Monthly activity chart, Brand partnership list, Production phases breakdown

### 3. IssueProfile.tsx
**Layout:** 5-layer stack
- Sub-header badges: Issue # | Pages (87) | Stories (18) | Ads (13) | Brands (30) | Date
- Timeline bar: Production stages (brief → photography → layout → BAT → print → published)
- Hero: Cover image
- Left column: Flatplan widget (page-by-page list with type + brand/story), Editorial stories widget, Ad placements widget, Credits/masthead widget
- Right column: Page thumbnails grid (from PDF), Brand cloud

### 4. PersonProfile.tsx
**Layout:** 5-layer stack
- Sub-header badges: Primary role | Publications worked | Credits | Reliability score | Active since
- Timeline bar: Activity across years (email + iMessage + production)
- Hero: none (or avatar if available)
- Left column: Role spectrum widget (cited vs observed bar chart), Affiliations widget (org timeline), Production credits widget (per publication), Reliability widget (scores breakdown)
- Right column: Communication activity chart, Recent activity feed

### 5. PeopleDirectory.tsx
**Layout:** Single column table
- Sortable columns: Name | Role (cited) | Publications | Credits | Reliability | Last Active | Ghost Status
- Filter by: role, publication, ghost status, reliability range
- Row click → PersonProfile
- Badge bar: Total people | Active | Ghosted | Cross-channel

### 6. ArchiveExplorer.tsx
**Layout:** Single column with sidebar filter
- File tree or flat list view
- Filter by: publication, issue, file type, production stage
- Sortable by: name, size, date, type
- Click file → detail panel showing parsed metadata

## Components to Build

### PublicationCard.tsx
- 2px solid border, no radius
- Publication name (11px, uppercase, bold)
- Type badge (8px)
- Stats row: issues | people | emails (Courier New, 9px)
- Date range (Courier New, 9px)
- Hover: translateY(-2px), border darken

### RoleSpectrumChart.tsx
- Horizontal stacked bars showing observed role weights
- Cited roles shown as labeled markers above the bar
- Colors from chart palette (--chart-purple, --chart-green, etc.)
- 8px labels, Courier New for percentages

### ReliabilityWidget.tsx
- 6 sub-scores as horizontal bars (responsiveness, consistency, follow-through, ghost risk, cross-channel, reciprocity)
- Overall score in Courier New 12px bold
- Ghost status badge with color coding:
  - active: --success
  - cooling: --warning
  - dormant: --text-disabled
  - ghosted: --error

### FlatplanStrip.tsx
- Horizontal strip showing all pages of an issue as small rectangles
- Color by page type: editorial (--chart-green), ad (--chart-purple), fashion story (--chart-gold)
- Hover shows page number + type + brand/story name
- Click → scrolls to page detail

### ProductionTimeline.tsx
- Horizontal timeline showing production stages
- Each stage: start date → end date as a bar
- Color: pending (grey), in_progress (--info), completed (--success)
- File count badge per stage

### IssueMiniCard.tsx
- Compact issue representation for lists
- Issue number (Courier New, bold), page count, date, story count
- Click → IssueProfile

## Data Sources (Supabase queries)

```typescript
// Publications
const { data: publications } = await supabase
  .from('publications')
  .select('*')
  .order('created_at', { ascending: false });

// Publication issues
const { data: issues } = await supabase
  .from('publication_issues')
  .select('*')
  .eq('publication_id', pubId)
  .order('cover_date', { ascending: false });

// Production credits
const { data: credits } = await supabase
  .from('nuke_production_credits')
  .select('*')
  .eq('publication_id', pubId);

// Editorial stories (for issue profile)
const { data: stories } = await supabase
  .from('editorial_stories')
  .select('*')
  .eq('issue_id', issueId);

// Ad placements
const { data: ads } = await supabase
  .from('ad_placements')
  .select('*')
  .eq('issue_id', issueId);

// Flatplan pages
const { data: pages } = await supabase
  .from('flatplan_pages')
  .select('*')
  .eq('issue_id', issueId)
  .order('page_number');
```

## File Structure

```
src/routes/modules/publishing/
  routes.tsx                    — Route definitions

src/pages/publishing/
  PublishingDashboard.tsx       — Overview
  PublicationProfile.tsx        — Single publication
  IssueProfile.tsx             — Single issue  
  PersonProfile.tsx            — Person with role spectrum
  PeopleDirectory.tsx          — Sortable people table
  ArchiveExplorer.tsx          — File browser

src/components/publishing/
  PublicationCard.tsx           — Card for dashboard grid
  RoleSpectrumChart.tsx         — Cited vs observed roles
  ReliabilityWidget.tsx         — Reliability scores display
  FlatplanStrip.tsx            — Page strip visualization
  ProductionTimeline.tsx        — Stage timeline
  IssueMiniCard.tsx            — Compact issue card
  MastheadWidget.tsx           — Credits display
  BrandCloudWidget.tsx         — Brand frequency display

src/hooks/
  usePublication.ts            — Fetch publication data
  useIssue.ts                  — Fetch issue + stories + ads + flatplan
  usePerson.ts                 — Fetch person + role spectrum + reliability
  usePublishingStats.ts        — Aggregate stats

src/types/
  publishing.ts                — All publishing type definitions
```

## 4-Hour Build Order

```
Hour 1: Foundation
  - Create route module + register in DomainRoutes
  - Create TypeScript types
  - Create hooks (usePublication, useIssue, usePerson)
  - PublishingDashboard with PublicationCard grid

Hour 2: Publication + Issue Profiles
  - PublicationProfile with 5-layer stack
  - IssueProfile with flatplan + stories + ads
  - FlatplanStrip component

Hour 3: Person Profiles + People Directory
  - PersonProfile with role spectrum + reliability
  - RoleSpectrumChart component
  - ReliabilityWidget component
  - PeopleDirectory table page

Hour 4: Polish + Deploy
  - ProductionTimeline component
  - MastheadWidget
  - Cross-linking (click person → profile, click pub → profile)
  - Test with real Supabase data
  - Verify design system compliance
```
