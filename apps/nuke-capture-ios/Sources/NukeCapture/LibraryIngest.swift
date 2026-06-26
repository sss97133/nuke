// LibraryIngest.swift — the WIRE: scan the on-device library → write the local
// store. The write half of the local-first loop the NEXT BUILD directive
// commissioned. Until this ran, LocalStore.ingest() had zero callers, so
// appearance.takenAt was always NULL and dayCounts() returned empty — the
// "render a record offline" promise was structurally impossible.
//
// What it writes: each photo's TRUE capture facts — file EXIF DateTimeOriginal
// (CameraEXIF.captureDate, NOT PHAsset.creationDate; see HARD_RULES §7), GPS, and
// camera make/model — via LocalStore.ingest() (which COALESCE-upserts ONLY its own
// columns, never the classify()/owner verdicts). Reads the user's own original
// bytes through PhotoKit (SyncEngine.requestOriginalData) — never a Supabase
// storage re-download (HARD_RULES §6).
//
// THE REAL ORGAN (no v1 cap): it walks the WHOLE library, resumable and in the
// background, in two passes:
//   • runHeadPass(limit:)   — the newest N positions, run on launch/foreground +
//                             pull-to-refresh, to catch new arrivals fast.
//   • runBackfillBatch(_:)  — resume the deep backlog from a persisted cursor and
//                             make budgeted progress; hosted by the existing
//                             BGProcessingTask (power + Wi-Fi charging window).
//
// CORRECTNESS rests on the per-asset skip-set (identifiersWithTakenAt) — immune to
// index drift, deletions, and re-runs — NOT on the cursor, which is only a
// resume hint that avoids re-scanning the already-indexed prefix. The cursor only
// advances over FULLY-completed batches, so a budget cutoff never steps past an
// un-ingested asset. iCloud-unavailable originals simply stay out of the skip-set
// and are retried (head pass while recent; a pull-to-refresh full re-sweep otherwise).
//
// Operating table: source → LibraryStore · store → LocalStore · this file → the
// populate pass · day window → LibraryDaysView.

import CoreGraphics
import Photos
import SwiftUI

@MainActor
final class LibraryIngest: ObservableObject {
    static let shared = LibraryIngest()

    @Published private(set) var running = false
    @Published private(set) var ingested = 0          // rows written this pass
    @Published private(set) var scanned = 0           // assets examined this pass (skipped + attempted)
    @Published private(set) var target = 0            // assets in scope this pass
    @Published private(set) var backlogComplete = false  // whole library walked at least once

    /// Resume hint: the index (into the newest-first PHFetchResult) the backlog walk
    /// has fully resolved DOWN TO. Persisted so a fresh wake skips the indexed prefix.
    private let cursorKey = "libraryIngestBacklogCursor"
    private let completeKey = "libraryIngestBacklogComplete"
    private let versionKey = "libraryIngestProcessingVersion"
    /// Bump when the per-asset "fully processed" definition gains a column, so devices
    /// that completed an older definition re-walk to fill it. 2 = + content phash
    /// (and the T0 verdict, populated as a byproduct of the same pass).
    private let processingVersion = 2
    private var cursor: Int {
        get { UserDefaults.standard.integer(forKey: cursorKey) }
        set { UserDefaults.standard.set(newValue, forKey: cursorKey) }
    }

    private let batchSize = 400
    /// A few concurrent lanes per batch — the original-data load (often an iCloud
    /// fetch) is the bottleneck; GRDB serializes the writes internally.
    private let lanes = 4

    /// What a pass writes. The head pass stays cheap for the foreground; the deep
    /// backfill enriches with the content phash + the on-device T0 verdict.
    private enum Mode { case exifOnly, full }

    private init() {
        // Processing definition advanced since we last completed → re-walk to fill the
        // new columns (the skip-set makes already-done EXIF a no-op; phash/classify is
        // the genuinely new work).
        if UserDefaults.standard.integer(forKey: versionKey) < processingVersion {
            UserDefaults.standard.set(0, forKey: cursorKey)
            UserDefaults.standard.set(false, forKey: completeKey)
            UserDefaults.standard.set(processingVersion, forKey: versionKey)
        }
        backlogComplete = UserDefaults.standard.bool(forKey: completeKey)
    }

    // MARK: Passes

    /// The newest `limit` positions: catch new arrivals quickly on launch/foreground
    /// and pull-to-refresh. EXIF only (cheap, no Vision) — phash/classify is the
    /// backfill's job. Bounded by POSITION (not work), never advances the cursor.
    func runHeadPass(limit: Int = 2000) async {
        let total = LibraryStore.shared.count
        await walk(startIndex: 0, positionEnd: min(limit, total), workBudget: .max, advanceCursor: false, mode: .exifOnly)
    }

    /// Full processing (EXIF + content phash + T0 verdict). Two sub-passes: a bounded
    /// head re-scan so NEW arrivals get phash/classify without a whole re-walk, then
    /// the deep backlog resumed from the cursor. Hosted by the BGProcessingTask.
    func runBackfillBatch(budget: Int = 4000) async {
        let total = LibraryStore.shared.count
        guard total > 0 else { return }
        // New arrivals at the top: full-process the newest window (mostly skip-set hits
        // once steady) so recent days get their phash + vehicle counts.
        await walk(startIndex: 0, positionEnd: min(512, total), workBudget: min(budget, 512), advanceCursor: false, mode: .full)
        // Resume the deep backlog from the cursor.
        let start = min(max(0, cursor), total)
        if start >= total {
            backlogComplete = true
            UserDefaults.standard.set(true, forKey: completeKey)
            return
        }
        await walk(startIndex: start, positionEnd: total, workBudget: budget, advanceCursor: true, mode: .full)
    }

    // MARK: The walk

    private func walk(startIndex: Int, positionEnd: Int, workBudget: Int, advanceCursor: Bool, mode: Mode) async {
        guard !running else { return }
        running = true
        defer { running = false }

        let total = LibraryStore.shared.count
        let end = min(positionEnd, total)
        target = max(0, end - startIndex)
        scanned = 0
        ingested = 0

        var i = startIndex
        var processed = 0   // assets we actually attempted to load (the budget unit)

        while i < end && processed < workBudget && !Task.isCancelled {
            let batchEnd = min(i + batchSize, end)

            // Snapshot this batch off the live PHFetchResult (main-actor read).
            let batch: [Item] = (i ..< batchEnd).compactMap { idx in
                guard let a = LibraryStore.shared.asset(at: idx) else { return nil }
                return Item(lid: a.localIdentifier,
                            lat: a.location?.coordinate.latitude,
                            lon: a.location?.coordinate.longitude,
                            asset: a)
            }
            // Skip what this mode considers done: EXIF for the head pass, the full
            // EXIF+phash+verdict for the backfill (so a head-only row gets enriched).
            let lids = batch.map { $0.lid }
            let alreadyDone = mode == .full
                ? LocalStore.shared.identifiersFullyProcessed(in: lids)
                : LocalStore.shared.identifiersWithTakenAt(in: lids)
            let todo = batch.filter { !alreadyDone.contains($0.lid) }
            scanned += batch.count - todo.count

            // Respect the work budget within the batch.
            let room = workBudget - processed
            let slice = room < todo.count ? Array(todo.prefix(room)) : todo
            let budgetHit = slice.count < todo.count
            processed += slice.count

            // Process the slice in small concurrent lanes for throughput.
            var lo = 0
            while lo < slice.count && !Task.isCancelled {
                let group = Array(slice[lo ..< min(lo + lanes, slice.count)])
                let wrote = await withTaskGroup(of: Bool.self) { g -> Int in
                    for item in group { g.addTask(priority: .utility) { await Self.processOne(item, mode: mode) } }
                    var n = 0
                    for await ok in g where ok { n += 1 }
                    return n
                }
                ingested += wrote
                scanned += group.count
                lo += group.count
            }

            // Advance the cursor ONLY over a fully-scanned batch — never past an
            // asset a budget cutoff or cancellation skipped.
            if budgetHit || Task.isCancelled { break }
            i = batchEnd
            if advanceCursor { cursor = i }
        }

        if advanceCursor && i >= total {
            backlogComplete = true
            UserDefaults.standard.set(true, forKey: completeKey)
        }
    }

    private struct Item { let lid: String; let lat: Double?; let lon: Double?; let asset: PHAsset }

    /// Load one asset's original bytes off-main and write its facts. Always the TRUE
    /// EXIF/identity columns; in `.full` mode ALSO the content phash (dedup spine) and
    /// the cheap on-device T0 verdict — both from the SAME bytes, both off-main, no
    /// network. Returns whether the EXIF row was written. `nonisolated` so the
    /// task-group child runs off the main actor; LocalStore is thread-safe.
    private nonisolated static func processOne(_ item: Item, mode: Mode) async -> Bool {
        guard let data = try? await SyncEngine.requestOriginalData(for: item.asset) else {
            return false   // iCloud unavailable / threw → stays out of the skip-set, retried later
        }
        let date = CameraEXIF.captureDate(from: data)
        let (make, model) = CameraEXIF.cameraInfo(from: data)

        // Loaded but nothing locatable in time or space → don't write a NULL-day row
        // (it would never surface in dayCounts) and don't spend the decode on it.
        guard date != nil || item.lat != nil else { return false }

        // The deep pass decodes one small frame, reused for BOTH the phash and the
        // T0 verdict (one decode, two disjoint writers).
        var phash: String?
        var cg: CGImage?
        if mode == .full {
            cg = SyncEngine.downsampledCGImage(from: data, maxPixel: 256)
            // Prefer the orientation-corrected 256px frame; fall back to the bytes.
            phash = cg.flatMap { PerceptualHash.dHash(of: $0) } ?? PerceptualHash.dHash(from: data)
        }

        // ingest() owns EXIF/identity; passing phash also seeds image_identity (insert
        // .ignore → one row per content, firstSeenAt never overwritten) + vehicle_image.
        LocalStore.shared.ingest(
            localIdentifier: item.lid,
            sourceType: "local_filesystem",
            phashHex: phash,
            takenAt: date,
            latitude: item.lat, longitude: item.lon,
            cameraMake: make, cameraModel: model
        )

        // classify() owns the disjoint verdict columns. Mirror VisionEngine's rule:
        // isPersonal = prominent face AND not a vehicle/work photo.
        if mode == .full, let cg, let cls = VisionEngine.classify(cg) {
            let face = VisionEngine.hasProminentFace(cg)
            let labels = Array(cls.labels.prefix(12).map { $0.0 })
            LocalStore.shared.classify(localIdentifier: item.lid,
                                       isVehicle: cls.isVehicle,
                                       isPersonal: face && !cls.isVehicle,
                                       hasPerson: face,
                                       labels: labels)
        }
        return true
    }
}
