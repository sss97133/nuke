# NUKE CAPTURE — APP STORE LISTING

Design council synthesis, 2026-06-10. The listing is substrate, not marketing: it obeys
the design codex (`NUKE_DESIGN_CODEX.md`) like any other surface. McMaster does not have
a brand film; neither do we. The privacy nutrition label is a marketing surface; the
screenshots are the first proof the philosophy is real.

---

## 1. NAME

**Decision: `Nuke Capture`** (12 chars)

Bare "Nuke" is not viable: the App Store query is owned by missile and arcade games
(fatal shelf adjacency for a professional tool), Foundry's NUKE is a registered software
trademark with real collision risk, Apple requires unique app names so the bare word is
almost certainly held, and single-generic-word ASO is unwinnable at zero users.

- The brand survives; "Capture" states the job; fits the home-screen label without
  truncation; escapes the missile-game shelf.
- **Fallback 1:** `Nuke Garage` — warmer, place-based, matches the shop framing.
- **Fallback 2:** `Nuke Worklog` — most literal, strongest ASO for "work log."
- Bundle display name matches the listing exactly. The web keeps the plain `NUKE`
  wordmark — the app name carries the qualifier, the brand does not.

## 2. SUBTITLE (30-char field)

**`Proof of work, not presence`** (27)

The thesis verbatim in the second-most-read field; buys "proof" and "work" in Apple's
search index for free. Keyword-first alternative if ASO testing demands it:
`Shop photo log & work ledger` (28). Never benefits-soup.

## 3. CATEGORY & ICON

- **Category:** Productivity (primary), Utilities (secondary). Never Social Networking —
  it would both lie and invite the wrong review rubric.
- **Icon:** the barcode mark — 5–7 vertical bars of varying weight, pure ink on pure
  paper. No gradient, no bevel, no pre-rounding, no border drawn to fight Apple's mask.
  The icon is the data structure (the green-squares move). Same mark anchors the
  nuke.ag favicon and profile header.

## 4. SCREENSHOT STORYBOARD — THE CHAIN OF CUSTODY (6 frames)

Production spec: white background, plain black device frame, captions top-aligned
ALL-CAPS bold, all numerals in the mono data face, 2px solid black rule between caption
and screen, zero radius/shadows/gradients. One racing accent total across all six
frames: a single 2px Gulf-orange underline beneath the S5 caption — easter egg, not
theme. The only imagery is the user's actual shop photos inside the UI. Real substrate
only — real counts, real timestamps, never staged lorem; the listing must pass the same
render condition the product does. Every number shown must be legible at App Store
preview scale.

| # | Frame | Caption | Sub (mono) |
|---|---|---|---|
| S1 | TOOL — TODAY screen, native | `THE DAY IS THE COMMIT.` | `47 PHOTOS / 6.2 HRS / 1 VEHICLE` |
| S2 | CONSENT — Sign in with Apple + the deal screen | `ONE TAP. ONE PERMISSION. NO FEED.` | — |
| S3 | GATE — shop filter with held-back gauge | `ONLY WHAT YOU SHOT AT THE SHOP.` | `Everything else stays on your phone. HELD BACK: 132` |
| S4 | RECEIPT — day receipt with photos, vehicle, hour span | `EVERY DAY ENDS WITH A RECEIPT.` | `TUE JUN 09 2026 · FIRST 8:12A · LAST 5:48P` |
| S5 | GRAPH — barcode timeline via the in-app deep-link view (guideline 2.3.3: depicts the app in use), URL visible | `THE GRAPH YOU CAN'T BUY.` | `nuke.ag/you — every bar is a day of work.` |
| S6 | FINGERPRINT — facet pills + backfill | `TABS ARE EARNED, NOT CHOSEN.` | `PHOTOS (20978) WORK (292) VEHICLES (14)` + `Your proof already exists — we import it from your camera roll.` |

S4 lock-screen variant (the daily notification, verbatim) is the App Preview alternate —
the most persuasive screen we have because it shows the product costing nothing.

## 5. DESCRIPTION

**First paragraph (the only one read) — ship this text:**

> Nuke Capture is a shop tool, not a social network. You work; it keeps the record.
> Photos you take at your shop upload themselves — timestamped, GPS-gated, attached to
> the vehicle on the lift — and become a public work ledger at nuke.ag: a contribution
> graph for people who build with their hands. No feed. No followers. No way to buy
> the graph. The only way to look good is to do the work.

**Remaining paragraphs — McMaster-plain bullets:**

- 1. Sign in with Apple. 2. Allow photo access. 3. Done. Two permissions, five taps,
  then it runs itself.
- What uploads: photos whose own location metadata places them at your shop. The
  filter runs entirely on your phone.
- What never uploads: everything else — family, screenshots, off-site. The app shows
  you the held-back count to prove it.
- Your camera roll already contains your proof. We import years of shop photos so the
  graph isn't empty on day one.
- The day receipt: every workday reconstructed — photo count, first and last shot,
  the vehicle, the hours. You logged nothing.
- Sign in with Apple only. No ads. No tracking. No third-party SDKs. Export or delete
  everything, anytime.
- You can't buy the graph. You can only do the work.

## 6. KEYWORDS (97/100 chars)

```
mechanic,restoration,garage,portfolio,fabrication,welding,detailing,project,car,build,ledger,shop
```

Trade nouns over tech nouns — the audience searches their trade, not "productivity."
Zero duplication with indexed name/subtitle words (nuke, capture, proof, work, presence).

## 7. APP REVIEW NOTES

> Nuke Capture uploads only photos that (a) fall within the photo-library scope the
> user granted and (b) carry GPS metadata inside the user's self-declared workplace
> radius. The filter runs entirely on device by reading each asset's own location
> metadata; the app never requests Location Services and performs no background
> location tracking. Photos outside the radius are never transmitted — the TODAY
> screen shows a HELD BACK count so the user can audit the filter. Every upload
> appears in a visible ledger; sync pauses with one tap; all data is exportable and
> deletable. Sign in with Apple only; no ads; no third-party SDKs. Privacy label:
> photos are user content linked to the user's own account; no data used for tracking.
> Demo account supplied; to test the gate, grant access to the bundled sample album —
> assets tagged at the demo shop coordinates upload, the beach photos do not.

Engineering must match the notes: EXIF-gated filtering, **no CoreLocation
entitlement**, a real pause switch, a clean privacy nutrition label, the bundled demo
album. The notes are bounded (shop radius), auditable (held-back gauge), minimal
(one permission) — the counter-position to the unbounded-ambient-upload pattern App
Review is primed against. Surveillance becomes service the moment the user can audit it.

Purpose string (`NSPhotoLibraryUsageDescription`), in voice:
*"Nuke Capture finds photos taken at your shop and adds them to your work record.
Off-site photos never leave your phone."*

## 8. WHAT NEVER APPEARS

No hearts, follower counts, share icons, or avatars-in-a-row in any frame. The word
"share" does not appear in the listing. No device-floating-in-gradient hero art, no
"Join thousands of builders," no testimonials, no exclamation marks. The web profile is
framed as "ledger" and "record," never "feed" or "page."
