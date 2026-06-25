// LibraryIngest.swift — the missing WIRE: scan the on-device library → write the
// local store. This is the write half of the local-first loop the NEXT BUILD
// directive commissioned. Until this ran, LocalStore.ingest() had zero callers,
// so appearance.takenAt was always NULL and dayCounts() returned empty — the
// "render a record offline" promise was structurally impossible.
//
// What it writes: each photo's TRUE capture facts — file EXIF DateTimeOriginal
// (CameraEXIF.captureDate, NOT PHAsset.creationDate; see HARD_RULES §7), GPS, and
// camera make/model — via LocalStore.ingest() (which COALESCE-upserts ONLY its own
// columns, never the classify()/owner verdicts). Reads the user's own original
// bytes through PhotoKit (SyncEngine.requestOriginalData) — never a Supabase
// storage re-download (HARD_RULES §6).
//
// Bounded for v1: the newest `cap` photos, newest-first, idempotent (skips rows
// that already have a takenAt). The cap is SURFACED (`capped`), never silent.
// Operating table: source → LibraryStore · store → LocalStore · this file → the
// populate pass · day window → LibraryDaysView.

import Photos
import SwiftUI

@MainActor
final class LibraryIngest: ObservableObject {
    static let shared = LibraryIngest()

    @Published private(set) var running = false
    @Published private(set) var ingested = 0      // rows written this pass
    @Published private(set) var scanned = 0        // assets considered this pass
    @Published private(set) var target = 0         // how many we're walking
    @Published private(set) var capped = false     // library bigger than the v1 cap

    /// v1 bound: walk the newest N. A full-library walk is a later pass; this is
    /// enough to prove the loop and render recent days offline.
    private let cap = 600

    /// Populate LocalStore from the newest photos' true EXIF. Idempotent: an asset
    /// that already has a `takenAt` is skipped (no original-data reload). Safe to
    /// call on appear / pull-to-refresh.
    func run() async {
        guard !running else { return }
        running = true
        defer { running = false }

        let assets = LibraryStore.shared.newestAssets(cap)
        capped = LibraryStore.shared.count > cap
        let lids = assets.map { $0.localIdentifier }
        let alreadyDone = LocalStore.shared.identifiersWithTakenAt(in: lids)
        let todo = assets.filter { !alreadyDone.contains($0.localIdentifier) }

        target = assets.count
        scanned = assets.count - todo.count
        ingested = 0

        for asset in todo {
            if Task.isCancelled { break }
            let lid = asset.localIdentifier
            let lat = asset.location?.coordinate.latitude
            let lon = asset.location?.coordinate.longitude

            // Heavy work OFF the main actor: pull the original bytes and parse EXIF.
            let facts: (takenAt: Date?, make: String?, model: String?) =
                await Task.detached(priority: .utility) {
                    guard let data = try? await SyncEngine.requestOriginalData(for: asset) else {
                        return (nil, nil, nil)
                    }
                    let (mk, md) = CameraEXIF.cameraInfo(from: data)
                    return (CameraEXIF.captureDate(from: data), mk, md)
                }.value

            // Nothing locatable in time or space → skip (don't write an empty row
            // that pollutes dayCounts with a NULL day).
            guard facts.takenAt != nil || lat != nil else { scanned += 1; continue }

            LocalStore.shared.ingest(
                localIdentifier: lid,
                sourceType: "local_filesystem",
                takenAt: facts.takenAt,
                latitude: lat, longitude: lon,
                cameraMake: facts.make, cameraModel: facts.model
            )
            ingested += 1
            scanned += 1
        }
    }
}
