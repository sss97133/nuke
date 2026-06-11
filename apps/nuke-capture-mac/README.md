# Nuke Capture — macOS menu-bar capture relay

A signed native menu-bar app that watches the Photos library and relays
shop photos into the owner's Nuke account.

## Why this exists

The previous capture organ was an unsigned CLI chain:

```
launchd → dotenvx → node (photo-sync-daemon.mjs) → osxphotos
```

macOS TCC cannot persist a Photos grant for an unsigned CLI process tree —
every binary in the chain re-triggers consent, which produced **~96 Photos
permission popups per day**. A signed native app holds **one** persistent
Photos permission, forever.

What carries over from `scripts/photo-sync-daemon.mjs`:

| Concern | Daemon | This app |
|---|---|---|
| Row shape | `uploadPhoto()` in the daemon | `VehicleImageRow` — cloned faithfully |
| Bucket/path | `vehicle-photos`, `users/<uid>/photo-sync/` | `vehicle-photos`, `users/<uid>/capture-relay/` |
| `source` | `iphoto` | `capture_relay` (provenance survives the migration) |
| Auth | service-role key (env) | **user JWT via email/password + RLS** — no secrets in the app |
| Privacy gate 1 | Apple on-device labels + GPS shop-gate | **GPS shop-gate only** (PhotoKit exposes no labels API on macOS); off-shop / no-GPS photos never leave the Mac, counted in the menu |
| Privacy gate 2 | server pipeline (vision gate) | unchanged — still the second gate |
| Watermark | `~/.nuke/photo-sync-state.json` | `UserDefaults` (creationDate watermark + 3-day overlap + (filename,size) seen-set) |
| Trigger | launchd every 15 min | `PHPhotoLibraryChangeObserver` — event-driven, idle at 0% CPU |
| Silent-failure law | watermark only advances on clean run | same |

The Supabase URL + anon key in `Config.swift` are public by design (same
values ship in every browser that loads nuke.ag). All write authority comes
from the signed-in user's session; RLS scopes everything. The service-role
key must never appear here.

## Dev run (no signing needed)

```bash
cd apps/nuke-capture-mac
swift build        # resolves supabase-swift 2.x, compiles
swift run NukeCapture
```

Notes for dev runs:

- The `Package.swift` linker flags embed `Info.plist` into the bare
  executable (`__TEXT,__info_plist`) so the Photos permission dialog works
  even unbundled. The grant attaches to that exact binary, so expect a
  re-prompt after rebuilds — that's the unsigned-CLI disease this app cures;
  it disappears once the app is bundled and signed (below).
- A car icon appears in the menu bar. First run: "Sign in…" prompts for the
  Nuke email/password; the session persists in the Keychain (supabase-swift's
  default `KeychainLocalStorage`), so sign-in is once per machine.
- "Start at Login" only works for the bundled, signed app — `SMAppService`
  refuses bare executables. The menu item explains this if you try.

## Signing & distribution (one-time, after Xcode finishes installing)

1. **Open the package in Xcode**: `cd apps/nuke-capture-mac && xed .`
2. **Sign in to your Apple Developer account**: Xcode → Settings → Accounts →
   "+" → sign in with the Apple ID that holds the membership.
3. **Make it an app target**: SPM executables don't produce an `.app` bundle.
   Either:
   - File → New → Project → macOS App, name it `NukeCapture`, drag the
     `Sources/NukeCapture` files in, set the project's Info.plist entries from
     `Info.plist` here (LSUIElement + NSPhotoLibraryUsageDescription), and add
     the `supabase-swift` package (File → Add Package Dependencies…), **or**
   - keep the SPM package as-is for CLI dev and create the Xcode app project
     beside it when ready to ship.
4. **Set the team**: target → Signing & Capabilities → Team = your new
   Developer account. For local use, "Automatically manage signing" +
   Development is enough — the TCC grant now persists across rebuilds.
5. **Direct distribution (other Macs, no App Store)**:
   - Signing: use a **Developer ID Application** certificate (Xcode creates it
     under Accounts → Manage Certificates).
   - Product → Archive → Distribute App → **Direct Distribution** — Xcode 15+
     signs with Developer ID and submits for **notarization** automatically;
     staple and export when it returns.
   - CLI equivalent: `xcrun notarytool submit NukeCapture.zip --keychain-profile <profile> --wait`
     then `xcrun stapler staple NukeCapture.app`.
6. **First launch of the signed app**: macOS shows the Photos consent dialog
   once ("Nuke uploads your shop photos…"). Click "Allow Full Access". That is
   the last Photos popup this Mac will ever show for capture.
7. **Start at Login**: tick it in the app's menu (uses the modern
   `SMAppService.mainApp` API; user can audit/revoke under System Settings →
   General → Login Items).

## Phase 2 — iPhone

The capture core (`SyncEngine` + `SupabaseService` + `Config`) is
platform-portable: PhotoKit, Supabase, and the GPS gate all exist identically
on iOS. Plan:

- Same package, add an iOS target; UI swaps the `NSStatusItem` for a minimal
  SwiftUI shell.
- Background sync via `BGAppRefreshTask` (+ `PHPhotoLibrary` change
  notifications while foregrounded) — iOS gives no daemon, so the refresh
  task is the heartbeat.
- Distribution through **TestFlight** (the Developer membership covers it) —
  no notarization dance on iOS.

That kills the iCloud → Mac → relay hop entirely: photos upload from the
phone at the shop, on shop Wi-Fi, minutes after they're taken.

## Files

```
Package.swift                      SPM manifest (macOS 14+, supabase-swift 2.x,
                                   embeds Info.plist into the dev binary)
Info.plist                         LSUIElement + Photos usage description
Sources/NukeCapture/
  App.swift                        @main entry, accessory activation policy
  AppDelegate.swift                NSStatusItem menu, sign-in prompt, SMAppService
  Config.swift                     public URL/anon key, shop-gate geometry, tuning
  SyncEngine.swift                 PhotoKit watch + watermark + dedupe + GPS gate
  SupabaseService.swift            auth (Keychain session), storage upload, row insert
```
