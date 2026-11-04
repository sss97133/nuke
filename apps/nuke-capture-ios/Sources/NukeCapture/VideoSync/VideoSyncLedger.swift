// VideoSyncLedger.swift — what the video sync owes and what it has done, as a pure value.
//
// Held locally only (Application Support/VideoSync/ledger.json). It never stores a video's bytes and
// nothing in it leaves the phone: the server sees the asset key (a hash), not the PhotoKit id.

import Foundation

struct VideoUploadRecord: Codable, Equatable, Sendable {
    enum Stage: String, Codable, Sendable { case preview, full }
    let assetKey: String
    let localID: String
    let kind: VideoKind
    let stage: Stage
    let objectName: String
    let fileName: String            // staged bytes inside the VideoSync directory
    let contentType: String
    var tus: TusProgress = TusProgress()
    var attempts: Int = 0
    var lastError: String? = nil
    /// The insert that tells the server about a landed preview (stage .preview only).
    var rowJSON: Data? = nil
    /// The server row to mark after a landed full file (stage .full only).
    var rowID: String? = nil
    var key: String { "\(assetKey)|\(stage.rawValue)" }
}

struct VideoLedger: Codable, Equatable, Sendable {
    /// Transfers in flight or waiting, at most one per (asset, stage).
    var pending: [VideoUploadRecord] = []
    /// assetKey → PhotoKit local identifier, for every clip whose preview landed (local only; phase 2 needs it).
    var previewed: [String: String] = [:]
    var fullUploaded: Set<String> = []

    func isKnown(_ assetKey: String) -> Bool {
        previewed[assetKey] != nil || pending.contains { $0.assetKey == assetKey }
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

    /// A preview landed and its row is in: the clip is known, the transfer leaves the queue.
    mutating func completePreview(key: String) {
        guard let rec = pending.first(where: { $0.key == key }) else { return }
        previewed[rec.assetKey] = rec.localID
        pending.removeAll { $0.key == key }
    }

    mutating func completeFull(key: String) {
        guard let rec = pending.first(where: { $0.key == key }) else { return }
        fullUploaded.insert(rec.assetKey)
        pending.removeAll { $0.key == key }
    }
}
