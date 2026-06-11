# NUKE DESIGN CODEX

**The design language of Nuke — web profile, NukeCapture iOS, App Store presence.**
Synthesized from the design council (Rams lens, Ive lens, McMaster lens, Art Direction lens), 2026-06-10.
Binding on every surface. Violations are build failures, not taste debates.

Companion documents: `.claude/rules/frontend.md` (web enforcement),
`docs/library/technical/design-book/facet-tabs-are-a-skill-fingerprint.md` (facet doctrine),
`docs/library/intellectual/contemplations/proof-of-work-not-pay-to-play.md` (the thesis).

---

## 0. PHILOSOPHY — GREEK/ROMAN, NOT TINSELTOWN

Structural, timeless, nothing decorative that isn't load-bearing. Every pixel must be
able to answer the question *"what data called you into existence?"*

- **Proof of work, not presence.** Instagram measures presence; we measure work. The
  barcode timeline is green squares for people who work with their hands. A day under
  the Blazer is a commit. You can't buy the graph — you can only do the work.
- **The substrate is the scoreboard.** Nothing on any screen may exist that the data
  didn't call into existence. No vanity metrics, no purchased reach, no placeholder
  modules, no "coming soon."
- **The blank is honest.** An empty graph is the invitation, not an apology
  (GitHub proved it). Empty states render the truthful zero, never an illustration.
- **Benchmark:** McMaster-Carr — faceted specs, sub-second, zero marketing surface.
  **Anti-benchmarks:** LinkedIn (hollow), pay-to-play Instagram. The capture app's
  success metric is *seconds-to-pocket* — the exact inverse of Instagram's.
- **The product is an instrument, not an app.** Calibrated once (five touches), then it
  reads. A torque wrench, not a social client. Every minute a user spends inside the
  capture app is evidence against the thesis.

---

## 1. COLOR — ACHROMATIC + EVIDENCE; COLOR IS DATA, NEVER DECORATION

Nuke has no brand color. `--accent` is ink. The only saturated pixels anywhere are
**earned data**: the heat ramp, the three semantic states, and the user's own
photographs. This is the single most protectable asset of the system. The capture app
must not "fix" it by adding a brand hue.

### The 12-token canon (one source, two renderers)

| Token | Light | Dark | Role |
|---|---|---|---|
| `paper` | `#f5f5f5` | `#1e1e1e` | page field |
| `surface` | `#ffffff` | `#252526` | cards, sheets |
| `card` | `#ebebeb` | `#2d2d30` | secondary fill |
| `ink` | `#1a1a1a` | `#cccccc` | text, 2px borders |
| `pencil` | `#666666` | `#9d9d9d` | secondary text, attribution |
| `ghost` | `#dddddd` | `#3e3e42` | hairlines, disabled |
| `border` | `#bdbdbd` | `#3e3e42` | 1px secondary structure |
| `success` | `#16825d` | same | semantic only |
| `warning` | `#b05a00` | same | semantic only |
| `error` | `#d13438` | same | semantic only |
| `heat-lo` | `#d9f99d` | same | evidence ramp start |
| `heat-hi` | `#065f46` | same | evidence ramp end |

Rules:
- **No component hardcodes a hex.** Web consumes CSS custom properties; iOS mirrors the
  same table in `Assets.xcassets`. Phone and web read as one instrument by construction.
- `#999`-class greys are reserved for **genuine absence** (the em-dash). Present data
  never renders lighter than `pencil`. NO SALE rows are history, not absence.
- **Racing accents** (Gulf `#6AADE4`/`#EE7623`, Martini `#C8102E`, JPS `#C8A951`,
  BRG `#004225`) are press-state/completion easter eggs only — one per surface maximum,
  never at rest, never in marketing assets.
- Dark mode ships day one from the same table, not as a later theme.
- **Repair order (web):** retire the ~200 compatibility alias tokens in
  `unified-design-system.css` and reconcile the `--up-*` fork against this canon. The
  iOS app is born from the 12-token canon; the canon is back-ported to the web — the
  sprawl is never forward-ported to the phone.

---

## 2. TYPE — MAPS BY ROLE, NOT BY FONT

The web chose Arial for its *unchosenness* — the platform's honest default grotesque.
The DNA is the role mapping, not the letterform. **Never embed Arial or Courier New in
the iOS bundle.**

| Role | Web | iOS |
|---|---|---|
| Human-readable | Arial | SF Pro (system) |
| Machine data — every digit, timestamp, count, dollar, VIN | Courier New | SF Mono, monospaced digits |
| Micro-labels | Arial bold 8–9px ALL-CAPS, +0.08em tracking | SF Pro Semibold 11pt ALL-CAPS, +0.08em tracking (Apple's legibility floor — 8px on iOS is decoration pretending to be information) |
| Body | Arial 10px | SF Pro 13pt |
| Section heads | Arial bold 11px | SF Pro Semibold 15pt |
| Data lines | Courier 9–10px | SF Mono 13pt |
| Hero figure | one size class above its labels | SF Mono 28–34pt |
| Accessibility | `--font-scale` | Dynamic Type, native (the floor scales up, never below 13pt for values) |

### ONE SCREEN, ONE NUMBER

Every screen has exactly one hero figure — the number you came for — set large in the
data face. Everything else lives at caption level, serving that figure, never competing
with it. Braun small type always served one large operative figure; a field of uniform
micro-labels the user must hunt through is instrument-panel cosplay — density as
costume, not density as service.

*Web back-port:* promote the operative figure of each profile widget (day total, ledger
sum) one full size class above its labels. Labels stay 8px; the figure stops hiding
among them. This is a constitutional amendment to the current ≤13px ceiling and needs
the client's sign-off (see Decisions).

### NUMBERS-PRESENTATION LAW

1. Every digit is set in the data face. Arial/SF Pro never carries a number.
2. Units live in the same glyph run: `147 PHOTOS`, `4.5H`, `$31,000`. Bare numbers are
   a schema failure on screen, same as in the database.
3. Money is exact at Shelf 1 and below; compression (`$12.3K`) only on Shelf 0 with the
   exact figure one tap away.
4. **One date grammar platform-wide:** `JUN 10 2026`; day headers may prefix the
   weekday: `WED JUN 10 2026`. One shared formatter. Four date grammars is four catalogs.
5. Every aggregate carries a pencil attribution microline:
   `N=325 · work_sessions · 2014–2026`. Numbers carry source DNA at the surface, not
   just in the database.
6. Truncation is always marked (`FIRST 2,000 OF 3,114`) or eliminated by server-side
   aggregation. A silently capped total in mono is worse than no total.

---

## 3. STRUCTURE — THE THREE-SHELF LAW

Every Nuke surface, web or native:

- **Shelf 0** — always visible, zero interaction: names and numbers only, never prose.
  At most one identity line plus four load-bearing aggregates.
- **Shelf 1** — one tap: the table behind each aggregate. Rows, not menus.
- **Shelf 2** — two taps: the receipt — a single day/session/listing with full
  provenance and the link out.

Nothing requires a third tap to reach its evidence. **No number without a table behind
it** — if a Shelf-0 figure can't open into rows, it doesn't render.

The barcode timeline (collapsed strip → heatmap → day-receipt drawer → `/journal/:date`)
already implements this exactly. Copy it; don't reinvent it.

### FACET DOCTRINE (carried whole into the app)

A module/pill/row exists **iff its count > 0**. Counts come from the ALL set, never the
filtered set. Label grammar: `KIND (N)`. No disabled states, no greyed tabs, no
empty-state illustrations. An empty profile shows zero pills; TODAY before the first
upload shows the scan counter and nothing else. The UI is structurally incapable of
claiming what the substrate didn't record.

---

## 4. SURFACES — NUKE DRAWS SQUARE; APPLE DRAWS APPLE

- Zero radius, zero shadows, zero gradients on every Nuke-drawn surface. Cards get
  2pt `ink` borders; secondary structure gets 1px `ghost`/`border` hairlines; thumbnails
  are square.
- **System chrome stays stock.** Permission alerts, share sheet, notification banners —
  never re-implement a system dialog to skin it. The seam between Apple's material and
  Nuke's material stays visible: borrowed material must look borrowed. That visible
  seam is the identity-chain doctrine at pixel level.
- Where a public API permits honest squaring, take it to the last detail:
  `ASAuthorizationAppleIDButton.cornerRadius = 0`. The Sign in with Apple button can be
  constitutionally Nuke without a single private API — Apple's type, Apple's tap,
  Nuke's geometry.
- App icon: the barcode mark — 5–7 vertical bars of varying weight, pure ink on pure
  paper, content square to the edges. Apple applies the corner mask; we do not
  pre-round, and we draw no border to fight it. The icon is the data structure. Same
  mark anchors the favicon and profile header.
- Spacing: the 4pt grid — 4/8/12/16/20/24 (the web `--space-1..6`, in points). Every
  container inset is 12, mirroring the web's universal `padding: 0 12px`. Pills 2×6,
  receipt cards 8×10, thumb gutters 2. No layout value exists outside the scale.
- Motion: **one curve everywhere** — 180ms `cubic-bezier(0.16, 1, 0.3, 1)`. No springs,
  no bounce. Bounce is Tinseltown.

---

## 5. SPEED & HONESTY — THE INSTRUMENT'S OATH

- **Sub-second is the first form of respect.** A surface renders whole or not at all.
  No spinners, no skeletons, no progress rings. Progress is data: real counts ticking
  (`SCANNING 41,202 PHOTOS`), a 2px rule that extends.
- Full-resolution originals never load into thumbnail slots
  (`getThumbnailUrl` + `resize=contain` — the recorded Supabase crop rule). One
  consolidated substrate call per surface, never per-widget waterfalls.
- iOS: TODAY reads a local store first — last-known numbers paint in <100ms cold
  launch; the network refreshes figures silently in place.
- **Real timestamps, never fuzz.** `LAST SYNC 2:41 PM`, never "just now."
- **The held-back count is a first-class gauge** with typographic weight equal to the
  upload count, everywhere, forever: `754 ON THE RECORD · 12 HELD ON PHONE`. The
  filter visibly works FOR the user, not ON them. It may never be demoted to a settings
  page. Each held photo has a one-line reason. The count is the product's oath,
  renewed at every sync.
- A `FAILED` row appears in the ledger the moment it is nonzero. Silent failure is the
  house style of broken systems.
- An RPC failure closes the surface rather than rendering a lying empty state.

---

## 6. THE RECEIPT, NOT THE DASHBOARD

The capture app is glanceable in under 3 seconds, then gets out of the way:

- IA is one screen plus settings: launch → TODAY → pocket. No feed, no charts, no
  pull-to-refresh theater, no infinite scroll, no analytics duplicated from the web.
- The phone captures; the web testifies. Anything analytical deep-links to
  `nuke.ag/profile` — the native receipt and the web receipt read as the same document
  at two sizes: same mono numbers, same field order.
- **Notification budget:** one daily summary, fired only when work landed, carrying
  both numbers. One permitted alert class: sync failure (`Sync stalled — 14 photos
  waiting. Open to retry.`) — a silent dead instrument is worse than an interruption.
  Zero engagement nags, zero "we miss you," zero streaks. If no work landed, no
  notification — absence is honest signal, exactly like the missing facet pill.
- Delight is earned exclusively by the data. The first earned moment is the day
  receipt the next morning: the app reconstructs a workday the user never logged.
  That asymmetry is the entire emotional payload. The number IS the firework.

---

## 7. THE FORBIDDEN LIST (binding; reviewed like border-radius)

Streaks · badges · confetti · mascots · progress rings · percentage donuts ·
gradients · drop shadows · rounded Nuke-drawn corners · haptic fanfares ·
"milestone" modals · onboarding carousels · empty-state illustrations ·
skeleton loaders · indeterminate spinners · pull-to-refresh rubber theater ·
hearts, follower counts, share icons, avatars-in-a-row · the word "feed" ·
re-engagement notifications · marketing gradient frames · benefits-soup copy ·
startup-cute microcopy · **any copy containing an exclamation mark** ·
"GMV"-class operator jargon (`TOTAL SOLD` carries the same number without the
LinkedIn smell) · curation by truncation (full testimony is always one tap away) ·
fake pre-permission dialogs styled to look like the system's ·
embedded Arial/Courier in the iOS bundle · spinners labeled as progress ·
"just now" timestamp fuzz · brand colors.

A PR adding UI to the capture app is checked against this list the way
`frontend.md` checks border-radius — a violation is a build failure.

---

## 8. VOICE & MICROCOPY

- Cut-list prose. Declarative, unit-bearing, no adjectives that aren't measurements.
- Labels are furniture: ALL-CAPS, learned once. Values are the message: data face,
  ≥13pt/px on Shelf 0, ≥10 on Shelf 1.
- The old-man test: if a 60-year-old machinist can't read it at arm's length or
  doesn't know the word, it fails. Tap targets ≥44pt iOS / ≥32px web; visual density
  and touch density are independent variables — expand hit areas invisibly.
- Purpose strings are design surface, not legal boilerplate:
  *"Nuke Capture finds photos taken at your shop and adds them to your work record.
  Off-site photos never leave your phone."*
- Canonical voice samples:
  - `212 on the record.` / `Tuesday's work is in. 38 off-shop photos stayed on your phone.`
  - `0 PHOTOS TODAY · LAST SYNC 2:41 PM`
  - `THE SHOP FILTER RUNS ON YOUR PHONE.`
  - `You can't buy the graph. You can only do the work.`

---

## 9. THE FIRST FIVE MINUTES (the unboxing script)

**Tap budget: five touches from App Store to first upload. Hard spec.**
Install → open → Sign in with Apple (Face ID glance) → the deal screen → system Photos
dialog. Anything that adds a sixth touch (username picker, notification pre-prompt,
tour) is cut. The login maze is the enemy's UX.

- **Beat 1 — Cold open (0:00–0:20).** One screen, one sentence, one button. `NUKE`
  wordmark, micro-label `PROOF OF WORK`, body: *"Your shop photos become a work
  record. Nothing posts. Nothing is public until you say so."* Sign in with Apple
  (stock material, cornerRadius 0). No carousel, no skip — there is nothing to skip.
  The foam cutout holds one tool. Handle/display name derive server-side from the
  Apple credential; edited later on nuke.ag, never during first run.
- **Beat 2 — The deal (0:20–0:35).** Three 2px-bordered ledger rows that earn the
  system dialog: `WHAT LEAVES YOUR PHONE` — photos taken at your shop. `WHAT STAYS` —
  everything else; family, screenshots, off-site; held on your phone, never uploaded.
  `WHO SEES IT` — you; nothing is public until you publish it. Mono footer:
  `THE SHOP FILTER RUNS ON YOUR PHONE.` One button: `ALLOW PHOTO ACCESS`. Then the
  stock iOS dialog, untouched. The gate runs on the photo's own EXIF location, on
  device — the app never requests Location Services.
- **Beat 3 — First sync (0:35–3:00).** TODAY appears immediately in its empty-honest
  state; the scan counter does the work: `SCANNING 41,202 PHOTOS`, real thumbnails
  landing as they upload, a 2px rule extending. First-run truth stated, not hidden,
  and the copy must match actual BGProcessingTask behavior. The four sync counts
  (uploaded / off-shop held / deduped / failed) render facet-style — a row exists iff
  nonzero. **Backfill is the hero moment:** *"Your camera roll already contains N shop
  photos from the last M years — import the proof."* The graph is not empty on day one
  (the Flighty move).
- **Beat 4 — First notification.** Contextually request permission only after the
  first sync: *"Want the receipt when a day's work lands?"* Then one per day, receipt
  voice, both numbers, no emoji, no exclamation.
- **Beat 5 — TODAY the next morning.** The day receipt, bare: `TUE JUN 09 2026` ·
  `47 PHOTOS · FIRST 8:12A · LAST 5:48P` · square thumbs · `LAST SYNC 6:02P` ·
  `VIEW DAY ON NUKE.AG →`. Standard 180ms reveal, zero garnish.

At no moment does the user see a placeholder for a feature, a greyed tab, or a
"coming soon." The no-empty-shells rule extends from widgets to onboarding itself.

---

## 10. DIRECTOR'S RECONCILIATIONS (where lenses disagreed)

1. **Sign in with Apple geometry.** Ive: keep stock. Rams: square it via the public
   `cornerRadius` API. **Ruling: square it.** It remains Apple's material (their type,
   their tap, their HIG) — the API exists precisely so the host design system can
   integrate it. System *dialogs* remain untouched; only the button, where Apple
   explicitly hands over geometry.
2. **Photos permission posture.** Ive: full library access ("pick photos by hand and
   this becomes another chore"). Art direction: limited-picker scope in review notes.
   **Ruling: ask for Full Access, honestly, via the deal screen** — the instrument
   thesis collapses under a manual picker. Limited access degrades gracefully (the
   ledger shows the narrower scope as a fact). The GPS gate runs on EXIF metadata on
   device; the app requests **zero location permission**. Flagged for client sign-off.
3. **Micro-label floor on iOS.** Web's 8px caps layer maps to 11pt SF Pro Semibold —
   Apple's legibility floor wins over literal porting. Density is preserved by the
   grid and the shelf law, not by sub-legible type.
4. **Hero-figure exception.** ONE SCREEN, ONE NUMBER authorizes a 28–34pt mono figure
   per screen, and back-ports the promotion to web widgets — a deliberate amendment to
   the ≤13px web ceiling. Flagged for client sign-off.
