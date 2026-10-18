import Foundation
import CryptoKit

/// Retry bookkeeping, never a local vehicle or subject model. The protected server read owns
/// profile membership. Source hashes prevent repeat work on unchanged acknowledged bytes.
struct SubjectResolutionQueue: Codable {
    static let method = "visual_subjects_v1"
    static let maxAttempts = 3
    struct Upload: Codable, Equatable {
        let localIdentifier: String
        let sourceHash: String
        let acknowledgedAt: Date
        var nextReadAt: Date
        var waitingForCorrespondingView: Bool?
    }
    struct Input: Codable, Equatable {
        let imageId: String
        let sourceHash: String
    }
    struct Batch: Codable, Equatable {
        var inputs: [Input]
        var attempts = 0
        var nextAttemptAt: Date
        var reuseOnly = false
        var lastError: String?
        var key: String {
            let witnesses = inputs.map { "\($0.imageId.lowercased()):\($0.sourceHash)" }.sorted().joined(separator: "|")
            return SHA256.hash(data: Data("\(SubjectResolutionQueue.method)|\(witnesses)".utf8))
                .map { String(format: "%02x", $0) }.joined()
        }
    }
    private(set) var uploads: [Upload] = []
    private(set) var finishedHashes: [String] = []
    private(set) var active: Batch?
    private(set) var lastOutcome: String?

    static func validHash(_ hash: String) -> Bool {
        hash.count == 64 && hash.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    /// A missing/invalid provider answer does not establish that no paid work occurred.
    /// Only refusals before the model callback can permit a fresh automatic reading.
    static func retryRequiresRetainedReading(refusal: String, alreadyReuseOnly: Bool, providerReadNotStarted: Bool = false) -> Bool {
        if alreadyReuseOnly { return true }
        if ["source_not_ready", "required_input_unavailable"].contains(refusal) { return false }
        if ["provider_unavailable", "provider_call_failed"].contains(refusal), providerReadNotStarted { return false }
        return true
    }

    enum SourceReadChange: Equatable { case invalid, unchanged, changed }
    /// Raw retained interpretations also change the source inbox, even when no same-car profile
    /// could be supported. Only acknowledged results within the exact fresh-source scope notify.
    static func sourceReadChange(requested: Set<String>, persisted: [String], retained: [String], deferred: [String]) -> SourceReadChange {
        let stored = persisted.map { $0.lowercased() }, readings = retained.map { $0.lowercased() }, unused = deferred.map { $0.lowercased() }
        guard Set(stored).count == stored.count, Set(readings).count == readings.count, Set(unused).count == unused.count,
              Set(stored + readings + unused).isSubset(of: requested),
              Set(stored + readings).isDisjoint(with: unused) else { return .invalid }
        return stored.isEmpty && readings.isEmpty ? .unchanged : .changed
    }

    mutating func acknowledge(localIdentifier: String, sourceHash: String, now: Date) {
        guard !localIdentifier.isEmpty, Self.validHash(sourceHash),
              !finishedHashes.contains(sourceHash), !uploads.contains(where: { $0.sourceHash == sourceHash }) else { return }
        uploads.append(Upload(localIdentifier: localIdentifier, sourceHash: sourceHash, acknowledgedAt: now,
            nextReadAt: now, waitingForCorrespondingView: nil))
    }

    mutating func preserveAcknowledgements(from newer: SubjectResolutionQueue) {
        for upload in newer.uploads where !finishedHashes.contains(upload.sourceHash)
            && !uploads.contains(where: { $0.sourceHash == upload.sourceHash }) {
            uploads.append(upload)
        }
    }

    /// A lone fresh photo may use protected server context. A contextless photo is held after
    /// the server's pre-inference refusal until another due source arrives; it is never polled
    /// through a model. Privacy-gate waits keep their separate bounded source-read backoff.
    func readyForSourceRead(now: Date) -> [Upload] {
        guard active == nil else { return [] }
        let due = uploads.filter { $0.nextReadAt <= now }
        let fresh = due.filter { $0.waitingForCorrespondingView != true }
        guard !fresh.isEmpty else { return [] }
        return Array((fresh + due.filter { $0.waitingForCorrespondingView == true }).prefix(60))
    }

    mutating func deferSources(_ hashes: Set<String>, now: Date, reason: String) {
        for i in uploads.indices where hashes.contains(uploads[i].sourceHash) {
            uploads[i].nextReadAt = now.addingTimeInterval(10 * 60)
        }
        lastOutcome = reason
    }

    mutating func finishSources(_ hashes: Set<String>, reason: String) {
        uploads.removeAll { hashes.contains($0.sourceHash) }
        finishedHashes.append(contentsOf: hashes.subtracting(finishedHashes).sorted())
        // This cache only suppresses repeated operational work; server custody/replay remains
        // authoritative if an old entry ever falls out of this bounded cache.
        if finishedHashes.count > 8_000 { finishedHashes.removeFirst(finishedHashes.count - 8_000) }
        lastOutcome = reason
    }

    mutating func stage(_ inputs: [Input], now: Date) -> Bool {
        guard active == nil, (1...3).contains(inputs.count),
              Set(inputs.map { $0.imageId.lowercased() }).count == inputs.count,
              Set(inputs.map(\.sourceHash)).count == inputs.count,
              inputs.allSatisfy({ input in
                  UUID(uuidString: input.imageId) != nil && Self.validHash(input.sourceHash)
                      && uploads.contains(where: { $0.sourceHash == input.sourceHash })
              }) else { return false }
        active = Batch(inputs: inputs, nextAttemptAt: now)
        return true
    }

    /// Unconsumed acknowledgements are future work, not failed attempts. Partial storage retry
    /// keeps only the actually consumed fresh sources in its reuse-only batch.
    mutating func releaseDeferred(_ imageIds: Set<String>) {
        guard var batch = active else { return }
        let deferred = batch.inputs.filter { imageIds.contains($0.imageId.lowercased()) }
        let hashes = Set(deferred.map(\.sourceHash))
        for index in uploads.indices where hashes.contains(uploads[index].sourceHash) {
            uploads[index].waitingForCorrespondingView = nil
        }
        batch.inputs.removeAll { imageIds.contains($0.imageId.lowercased()) }
        active = batch.inputs.isEmpty ? nil : batch
    }

    mutating func awaitCorrespondingView(reason: String) {
        guard let batch = active else { return }
        let hashes = Set(batch.inputs.map(\.sourceHash))
        for index in uploads.indices where hashes.contains(uploads[index].sourceHash) {
            uploads[index].waitingForCorrespondingView = true
        }
        active = nil
        lastOutcome = reason
    }

    /// Save this lease before the request. A killed process cannot immediately pay for the same
    /// reading again. The request also pins the exact source hashes and method on the server.
    mutating func beginAttempt(now: Date) -> Batch? {
        guard var batch = active, batch.nextAttemptAt <= now else { return nil }
        guard batch.attempts < Self.maxAttempts else {
            finish(reason: "Visual analysis stopped after three attempts; the last request did not return a receipt.")
            return nil
        }
        batch.attempts += 1
        batch.nextAttemptAt = now.addingTimeInterval([120.0, 600.0, 3600.0][batch.attempts - 1])
        active = batch
        // This request may reach the provider even if the process dies before receiving its
        // response. A restarted process may only reuse the protected reading, never pay again.
        active?.reuseOnly = true
        return batch
    }

    mutating func retry(reason: String, reuseOnly: Bool = false, readingWasNotStarted: Bool = false) {
        guard var batch = active else { return }
        batch.lastError = reason
        batch.reuseOnly = readingWasNotStarted ? false : batch.reuseOnly || reuseOnly
        active = batch
        lastOutcome = reason
        if batch.attempts >= Self.maxAttempts { finish(reason: "Visual analysis stopped after three attempts. \(reason)") }
    }

    mutating func finish(reason: String) {
        guard let batch = active else { return }
        finishSources(Set(batch.inputs.map(\.sourceHash)), reason: reason)
        active = nil
    }

    static func completeReceipt(requested: Set<String>, persisted: [String], unresolved: [String], deferred: [String] = []) -> Bool {
        let stored = persisted.map { $0.lowercased() }, pending = unresolved.map { $0.lowercased() }, unused = deferred.map { $0.lowercased() }
        guard !stored.isEmpty || !pending.isEmpty else { return false }
        return Set(stored).count == stored.count && Set(pending).count == pending.count && Set(unused).count == unused.count
            && Set(stored).isDisjoint(with: pending) && Set(stored + pending).isDisjoint(with: unused)
            && Set(stored + pending + unused) == requested
    }
}
