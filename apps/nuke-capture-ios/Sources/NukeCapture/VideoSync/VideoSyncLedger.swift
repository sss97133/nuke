// VideoSyncLedger.swift — what the video sync owes and what it has done, as a pure value.
//
// Held locally only (Application Support/VideoSync/ledger.json). It never stores a video's bytes, a frame or any
// text read from one, and nothing in it leaves the phone: the server sees the asset key (a hash), not the PhotoKit id.
// What it keeps about a refused clip is the asset key and a fixed refusal word, so the clip is not read twice.

import Foundation

struct VideoUploadRecord: Codable, Equatable, Sendable {
    enum Stage: String, Codable, Sendable { case preview, full }
    let assetKey: String
    let rowID: String               // the vehicle_images row this object belongs to
    let stage: Stage
    let objectName: String
    let fileName: String            // staged bytes inside the VideoSync directory
    let contentType: String
    var tus: TusProgress = TusProgress()
    var attempts: Int = 0
    var lastError: String? = nil
    var key: String { "\(assetKey)|\(stage.rawValue)" }
}

/// A clip whose frames cleared the gate. It lives here from the moment it clears until its row is filed to the
/// vehicle and both objects have landed, so each step can resume after a relaunch without re-reading the frames.
struct VideoFiling: Codable, Equatable, Sendable {
    enum State: String, Codable, Sendable {
        case cleared        // gate passed on the phone; NOTHING has been sent yet
        case rowInserted    // metadata-only row exists (no pixels, no objects, vehicle_id still null)
        case filed          // device_file_images set vehicle_id: pixels may now go up
    }
    let assetKey: String
    let localID: String
    let rowID: String
    let vehicleID: String
    let method: String
    let confidence: Double
    /// The insert body, built at clearance (metadata only).
    let rowJSON: Data
    var state: State = .cleared
    var attempts: Int = 0
    var previewDone = false
    var fullDone = false
}

struct VideoLedger: Codable, Equatable, Sendable {
    /// Transfers in flight or waiting, at most one per (asset, stage).
    var pending: [VideoUploadRecord] = []
    /// Cleared clips awaiting row insert, filing or transfers, by asset key.
    var filings: [String: VideoFiling] = [:]
    /// assetKey → outcome for every clip read once: a refusal word ("refused:privacy") or "filed". Never content.
    var checked: [String: String] = [:]

    func isKnown(_ assetKey: String) -> Bool { checked[assetKey] != nil || filings[assetKey] != nil }

    mutating func markChecked(_ assetKey: String, outcome: String) { checked[assetKey] = outcome }

    mutating func recordCleared(_ filing: VideoFiling) {
        guard filings[filing.assetKey] == nil else { return }
        filings[filing.assetKey] = filing
    }

    mutating func setState(_ assetKey: String, _ state: VideoFiling.State) {
        guard filings[assetKey] != nil else { return }
        filings[assetKey]?.state = state
        if state == .filed { checked[assetKey] = "filed" }
    }

    /// The server did not file it (refused, or kept deferring): the row stays metadata-only and nothing is uploaded.
    mutating func noteFilingAttempt(_ assetKey: String, maxAttempts: Int) {
        guard filings[assetKey] != nil else { return }
        filings[assetKey]?.attempts += 1
        if (filings[assetKey]?.attempts ?? 0) >= maxAttempts {
            filings[assetKey] = nil
            checked[assetKey] = "refused:server"
        }
    }

    /// The server refused outright (not associated, conflict, gate rejected, …): done, nothing uploads.
    mutating func serverRefused(_ assetKey: String, status: String) {
        filings[assetKey] = nil
        checked[assetKey] = "refused:server_\(status)"
    }

    @discardableResult
    mutating func enqueue(_ record: VideoUploadRecord) -> Bool {
        guard !pending.contains(where: { $0.key == record.key }) else { return false }
        pending.append(record)
        return true
    }

    mutating func updateTus(key: String, _ progress: TusProgress) {
        guard let i = pending.firstIndex(where: { $0.key == key }) else { return }
        pending[i].tus = progress
    }

    mutating func noteFailure(key: String, error: String, maxAttempts: Int) {
        guard let i = pending.firstIndex(where: { $0.key == key }) else { return }
        pending[i].attempts += 1
        pending[i].lastError = error
        if pending[i].attempts >= maxAttempts { pending.remove(at: i) }
    }

    mutating func completePreview(key: String) { complete(key: key) { $0.previewDone = true } }
    mutating func completeFull(key: String) { complete(key: key) { $0.fullDone = true } }

    private mutating func complete(key: String, _ mark: (inout VideoFiling) -> Void) {
        guard let rec = pending.first(where: { $0.key == key }) else { return }
        pending.removeAll { $0.key == key }
        guard filings[rec.assetKey] != nil else { return }
        mark(&filings[rec.assetKey]!)
        if filings[rec.assetKey]!.previewDone && filings[rec.assetKey]!.fullDone { filings[rec.assetKey] = nil }
    }
}
