// IgnitionEngine.swift — the first-run scan: read the WHOLE library, find the
// work sites, build the record. The screen reports what the engine is doing
// the moment it happens — the UI is a window into this state, nothing more.
//
// Order of operations (all on-device, NOTHING uploads during ignition):
//   1. Permission. Three defined states, no path undefined:
//        full    → scan everything
//        limited → scan the granted subset, report the scope as a fact
//        denied  → truthful empty state (Settings is the one action)
//   2. Scan: enumerate every image asset newest→oldest reading ONLY
//      creationDate + location (no image data, no network). photosRead ticks
//      live; GPS-bearing assets land in the flood grid as found; the
//      UPLOADED gauge stays at the real upload count (0 on first run) the
//      whole time — the privacy contract proven, not promised.
//   3. Cluster: ~75 m grid bucketing on lat/lon, merge adjacent occupied
//      cells, rank by photo count → SITE 01/02/… candidates.
//   4. Confirm: one tap per candidate — "That's my shop" / "Not mine".
//      No naming gate (names default to SITE NN; renaming is optional,
//      later, in the Account sheet). Confirmed sites persist in SiteStore
//      (the upload gate) and sync to prod user_sites (owner-ALL RLS).
//   5. Done: backfill of the at-site photos starts AUTOMATICALLY — the
//      consent surface is the live gauge + the pause toggle in Today,
//      not an extra button gate.

import Foundation
import Photos

/// One asset's scan-pass facts — identifier, timestamp, coordinate. This is
/// ALL the scan reads; image bytes are never touched during ignition.
struct ScannedAsset {
    let id: String
    let date: Date?
    let lat: Double
    let lon: Double
}

/// A clustered group of GPS photos proposed as a work site.
struct SiteCandidate {
    let centerLat: Double
    let centerLon: Double
    let radiusMeters: Double
    let assets: [ScannedAsset]      // oldest first
    var photoCount: Int { assets.count }
    let dayCount: Int
    let yearRange: String
}

@MainActor
final class IgnitionEngine: ObservableObject {
    static let shared = IgnitionEngine()
    /// UserDefaults flag the app routes on (true → TodayView).
    static let completeKey = "ignitionComplete"

    enum Phase: Equatable {
        case off            // pre-permission
        case scanning
        case site           // presenting candidates[candidateIndex]
        case denied
    }

    // ─── Published scan state (the windows the UI renders) ──────────────────
    @Published private(set) var phase: Phase = .off
    @Published private(set) var photosRead = 0
    @Published private(set) var totalToRead = 0
    @Published private(set) var gpsPhotosFound = 0
    /// Thumbnail identifiers landing in the flood grid as they're found.
    @Published private(set) var floodAssetIDs: [String] = []
    /// .limited grant — the scope is reported as a fact, never nagged about.
    @Published private(set) var limitedScope = false

    // ─── Site confirmation state ─────────────────────────────────────────────
    @Published private(set) var candidateIndex = 0
    private(set) var candidates: [SiteCandidate] = []
    private(set) var confirmed: [SiteCandidate] = []

    var currentCandidate: SiteCandidate? {
        candidates.indices.contains(candidateIndex) ? candidates[candidateIndex] : nil
    }
    /// 1-based ordinal of the site being confirmed (SITE 01, SITE 02, …).
    var siteOrdinal: Int { confirmed.count + 1 }

    private var started = false
    private var scanStart = Date()
    static let floodGridCap = 24

    private init() {}

    // ─── 1. Permission ───────────────────────────────────────────────────────

    func start() async {
        guard !started else { return }
        started = true

        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        switch status {
        case .authorized:
            limitedScope = false
        case .limited:
            // Defined state, not a degraded one: scan the granted subset and
            // report the scope as a fact. No upgrade nag — EXPAND exists as
            // a row (presentLimitedLibraryPicker), nothing more.
            limitedScope = true
        default:
            phase = .denied
            started = false      // re-runs if the owner returns from Settings
            return
        }

        scanStart = Date()
        phase = .scanning
        await scan()
        buildCandidates()
        if candidates.isEmpty {
            finishIgnition()
        } else {
            phase = .site
            demoWalkSiteIfNeeded()
        }
    }

    /// Re-check authorization after a Settings round-trip (denied state).
    func retryAfterSettings() async {
        guard phase == .denied else { return }
        await start()
    }

    // ─── 2. The scan ─────────────────────────────────────────────────────────
    //
    // Two passes by design: PHFetchResult enumeration is metadata-only and
    // fast (creationDate + location are prefetched), so we collect first,
    // then REPLAY the counts at a readable pace — every number shown is a
    // real count of real assets; only the tick rate is paced so the gauge is
    // legible instead of an instant jump.

    private func scan() async {
        let options = PHFetchOptions()
        options.predicate = NSPredicate(
            format: "mediaType == %d", PHAssetMediaType.image.rawValue
        )
        // Newest → oldest: the most recent work lands in the grid first.
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]

        let fetch = PHAsset.fetchAssets(with: options)
        let total = fetch.count
        totalToRead = total
        guard total > 0 else { return }

        // Collect: (index in scan order, asset facts) for GPS-bearing assets.
        var gpsList: [(index: Int, asset: ScannedAsset)] = []
        fetch.enumerateObjects { asset, idx, _ in
            if let loc = asset.location {
                gpsList.append((idx, ScannedAsset(
                    id: asset.localIdentifier,
                    date: asset.creationDate,
                    lat: loc.coordinate.latitude,
                    lon: loc.coordinate.longitude
                )))
            }
        }
        scannedGPS = gpsList.map(\.asset)

        // Replay: tick the published counters over a legible duration.
        let duration = min(max(Double(total) / 4000.0, 2.2), 8.0)
        let steps = max(1, min(total, 150))
        let chunk = max(1, total / steps)
        let stepSleep = UInt64(duration / Double(steps) * 1_000_000_000)

        var read = 0
        var gpsPtr = 0
        while read < total {
            read = min(total, read + chunk)
            photosRead = read
            while gpsPtr < gpsList.count, gpsList[gpsPtr].index < read {
                gpsPhotosFound += 1
                if floodAssetIDs.count < Self.floodGridCap {
                    floodAssetIDs.append(gpsList[gpsPtr].asset.id)
                }
                gpsPtr += 1
            }
            try? await Task.sleep(nanoseconds: stepSleep)
        }
        // Flush any GPS entries the loop boundary missed.
        while gpsPtr < gpsList.count {
            gpsPhotosFound += 1
            if floodAssetIDs.count < Self.floodGridCap {
                floodAssetIDs.append(gpsList[gpsPtr].asset.id)
            }
            gpsPtr += 1
        }
    }

    private var scannedGPS: [ScannedAsset] = []

    // ─── 3. Clustering: ~75 m grid buckets, merge adjacent, rank by count ───

    private struct CellKey: Hashable { let x: Int; let y: Int }

    private func buildCandidates() {
        let cellLat = Config.siteCellMeters / 111_320.0
        var cells: [CellKey: [Int]] = [:]
        for (i, a) in scannedGPS.enumerated() {
            // Longitude cell size varies with latitude; within one site
            // (<1 km) cos(lat) is constant enough for consistent keys.
            let cellLon = Config.siteCellMeters
                / (111_320.0 * max(0.2, cos(a.lat * .pi / 180)))
            let key = CellKey(x: Int(floor(a.lon / cellLon)),
                              y: Int(floor(a.lat / cellLat)))
            cells[key, default: []].append(i)
        }

        // Merge 8-adjacent occupied cells into clusters (BFS).
        var visited = Set<CellKey>()
        var clusters: [[Int]] = []
        for key in cells.keys where !visited.contains(key) {
            var stack = [key]
            visited.insert(key)
            var members: [Int] = []
            while let k = stack.popLast() {
                members.append(contentsOf: cells[k] ?? [])
                for dx in -1...1 {
                    for dy in -1...1 where !(dx == 0 && dy == 0) {
                        let n = CellKey(x: k.x + dx, y: k.y + dy)
                        if cells[n] != nil, !visited.contains(n) {
                            visited.insert(n)
                            stack.append(n)
                        }
                    }
                }
            }
            clusters.append(members)
        }

        candidates = clusters
            .filter { $0.count >= Config.siteMinPhotos }
            .sorted { $0.count > $1.count }
            .prefix(Config.siteMaxCandidates)
            .map { makeCandidate(memberIndices: $0) }
        candidateIndex = 0
    }

    private func makeCandidate(memberIndices: [Int]) -> SiteCandidate {
        let assets = memberIndices.map { scannedGPS[$0] }
            .sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
        let lat = assets.map(\.lat).reduce(0, +) / Double(assets.count)
        let lon = assets.map(\.lon).reduce(0, +) / Double(assets.count)
        let radius = assets.map {
            Geo.distanceMeters(lat1: $0.lat, lon1: $0.lon, lat2: lat, lon2: lon)
        }.max() ?? 0

        let dates = assets.compactMap(\.date)
        let cal = Calendar.current
        let days = Set(dates.map { cal.startOfDay(for: $0) })

        return SiteCandidate(
            centerLat: lat,
            centerLon: lon,
            radiusMeters: max(radius, Config.siteMinRadiusMeters),
            assets: assets,
            dayCount: days.count,
            yearRange: Self.yearRange(of: dates)
        )
    }

    // ─── 4. Site confirmation: one tap, no naming gate ───────────────────────

    func confirmCurrentSite() {
        guard let cand = currentCandidate else { return }
        let site = Site(
            name: String(format: "SITE %02d", siteOrdinal),
            latitude: cand.centerLat,
            longitude: cand.centerLon,
            radiusMeters: cand.radiusMeters
        )
        SiteStore.shared.add(site)
        confirmed.append(cand)
        // Confirmed sites sync to prod user_sites (owner-ALL RLS). Device
        // store above stays the cache/gate; failure here is logged, never
        // blocks the flow.
        Task { await SupabaseService.pushUserSite(site) }
        advanceCandidate()
    }

    func rejectCurrentSite() {
        advanceCandidate()
    }

    private func advanceCandidate() {
        candidateIndex += 1
        if currentCandidate == nil {
            finishIgnition()
        } else {
            objectWillChange.send()
            demoWalkSiteIfNeeded()
        }
    }

    // ─── 5. Done: backfill starts automatically ──────────────────────────────
    //
    // The "UPLOAD N" button gate is GONE (founder ruling): after the last
    // site decision the at-site photos (oldest first) hand straight to the
    // SyncEngine backfill. The consent surface is the live gauge + the
    // pause toggle on the Today tab — visible the moment the TabView lands.

    private func finishIgnition() {
        let ids = confirmed.flatMap(\.assets)
            .sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
            .map(\.id)

        // Steady-state sync picks up from the scan moment — the backfill
        // owns everything older.
        SyncEngine.shared.setInitialWatermark(scanStart)
        UserDefaults.standard.set(true, forKey: Self.completeKey)

        guard !ids.isEmpty else { return }
        Task { await SyncEngine.shared.backfill(assetIdentifiers: ids) }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    static func yearRange(of dates: [Date]) -> String {
        let years = dates.map { Calendar.current.component(.year, from: $0) }
        guard let lo = years.min(), let hi = years.max() else { return "—" }
        return lo == hi ? "\(lo)" : "\(lo)–\(hi)"
    }

    // ─── DEBUG demo walk ─────────────────────────────────────────────────────
    // Launch arg -IgnitionDemoWalk drives the site screens on timers so the
    // full ignition (scan → one-tap confirms → auto-backfill → TabView) can
    // be screenshot-walked headless in the simulator. DEBUG builds only.

    private func demoWalkSiteIfNeeded() {
        #if DEBUG
        guard ProcessInfo.processInfo.arguments.contains("-IgnitionDemoWalk") else { return }
        let index = candidateIndex
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard let self, self.phase == .site, self.candidateIndex == index else { return }
            if self.confirmed.isEmpty {
                self.confirmCurrentSite()
            } else {
                self.rejectCurrentSite()
            }
        }
        #endif
    }
}
