# Blur — iOS

**A Nuke product.** Blur organizes the photo library already on your phone into
galleries you can find and show fast — and lets you hide the ones you don't want
flashing past when you hand someone your phone. Everything happens **on-device**.

> **Status:** v0 scaffold, staged inside the nuke monorepo at `apps/blur/` for
> review. It is self-contained (no dependency on the rest of the repo) and is
> intended to be **extracted into its own repository** before launch — Blur is a
> standalone product Nuke publishes. See `FEASIBILITY_AND_BUILD_PLAN.md`.

## What v0 is (the free tier)

Pure local, zero backend, zero account, zero network:

- Reads your **albums and Apple smart albums** (Favorites, Selfies,
  Screenshots, …) and presents each as a **gallery** (the free "seed" layer —
  Apple already classifies on-device; we surface it well).
- **Curate:** tap any photo to hide it (it blurs).
- **Show mode:** one toggle removes hidden photos so you can present a gallery
  safely — the fastest path to *the* photo without the frantic scroll.

The paid upgrade — **automatic image handling** (passive AI clustering that
builds and completes galleries for you) — is a later phase and is deliberately
not in v0, to keep the first App Review surface tiny. See the build plan.

## Lineage

Forked from `apps/nuke-capture-ios` (itself a port of the proven Mac relay).
Blur **inverts** it: the capture app uploads photos to a shared backend; Blur
removes the upload and GPS gate entirely and keeps the photos on the phone.

| Concern | nuke-capture | **Blur v0** |
|---|---|---|
| Photo bytes | uploaded to Supabase | **never leave the device** |
| Backend / account | required | **none** |
| Network | yes | **none** |
| Reused | PhotoKit scan, BGTask, thumbnail loader, XcodeGen + monotonic build number | same |

## Build

The `.xcodeproj` is generated from `project.yml`, never committed. Always use
`./generate.sh` (it also stamps a fresh, monotonic build number so App Store
Connect never rejects a stale build).

```bash
brew install xcodegen
cd apps/blur          # (or the repo root once extracted)
./generate.sh
open Blur.xcodeproj
```

In Xcode: target **Blur** → Signing & Capabilities → set your **Team**
(automatic signing) → run on a device or simulator.

> Authored without Xcode in the loop (same as the capture app at scaffold
> time). Expect at most minor compile fixes on first ⌘B; the PhotoKit and
> SwiftUI patterns are ported from the known-compiling capture app.

## Files

```
project.yml                  XcodeGen spec (bundle ag.nuke.blur, iOS 17+, no deps)
PrivacyInfo.xcprivacy        Privacy manifest — v0 collects NOTHING
generate.sh                  generate + stamp monotonic build number
Sources/Blur/
  BlurApp.swift              @main; opens straight to galleries (no sign-in); BGTask
  Config.swift               app constants; commented breadcrumbs for the paid backend
  Gallery.swift              the Gallery model + source enum
  LibraryEngine.swift        PhotoKit scan → galleries; local hidden-state store
  AssetThumbnail.swift       local thumbnail loader (optional blur)
  GalleriesView.swift        home grid of gallery covers
  GalleryFocusView.swift     one gallery: curate (tap to hide) + Show mode
  SettingsView.swift         privacy promise + upgrade teaser
```

## Shipping

See `APP_STORE_LAUNCH.md` (Blur-specific runbook) for the TestFlight → App
Store path. Because v0 is local-only with no account, several of the capture
app's blockers (privacy-policy data disclosures, account-deletion RPC) shrink
dramatically.
