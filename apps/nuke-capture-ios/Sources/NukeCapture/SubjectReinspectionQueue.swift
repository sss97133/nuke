import Foundation
import CryptoKit

/// Operational leases only. This never resets uploaded/finished hashes, files a
/// photograph or declares that analysis completed merely because time elapsed.
struct SubjectReinspectionQueue: Codable {
    static let method = "device_privacy_reinspection_v1"
    struct Candidate: Codable, Equatable {
        struct Witness: Codable, Equatable {
            let receipt_image_id: String
            let current_image_id: String
            let root_image_id: String
            let local_identifier: String
            let source_sha256: String
        }
        let method: String
        let reading_id: String
        let run_key: String
        let image_ids: [String]
        let expected_source_hashes: [String: String]
        let pending_source_count: Int
        let inspect: [Witness]
        var capture_filing_pending: Bool? = nil
        var valid: Bool {
            method == SubjectReinspectionQueue.method && UUID(uuidString: reading_id) != nil && !run_key.isEmpty && run_key.count <= 1024
                && (2...3).contains(image_ids.count) && Set(image_ids).count == image_ids.count
                && image_ids.allSatisfy { UUID(uuidString: $0) != nil && SubjectResolutionQueue.validHash(expected_source_hashes[$0] ?? "") }
                && Set(expected_source_hashes.keys) == Set(image_ids)
                && (capture_filing_pending == true ? inspect.isEmpty && pending_source_count == 0
                    : (1...2).contains(inspect.count) && (inspect.count...3).contains(pending_source_count))
                && Set(inspect.map(\.receipt_image_id)).count == inspect.count && Set(inspect.map(\.current_image_id)).count == inspect.count
                && Set(inspect.map(\.root_image_id)).count == inspect.count
                && inspect.allSatisfy { image_ids.contains($0.receipt_image_id) && UUID(uuidString: $0.current_image_id) != nil
                    && UUID(uuidString: $0.root_image_id) != nil && !$0.local_identifier.isEmpty && $0.local_identifier.count <= 512
                    && $0.source_sha256 == expected_source_hashes[$0.receipt_image_id] }
        }
        var key: String {
            let parts = inspect.map { "\($0.current_image_id.lowercased()):\($0.source_sha256)" }.sorted().joined(separator: "|")
            let continuation = capture_filing_pending == true ? "|capture-filing" : ""
            return SHA256.hash(data: Data("\(method)|\(reading_id)|\(run_key)|\(parts)\(continuation)".utf8)).map { String(format: "%02x", $0) }.joined()
        }
    }
    struct Lease: Codable {
        let candidate: Candidate
        var attempts = 0
        var nextAttemptAt: Date
        var receipts: [String: DevicePrivacyReceipt] = [:]
        var lastFailure: String? = nil
    }
    struct DeferredScope: Codable {
        let key: String
        let currentImageIds: [String]
        let retryAfter: Date
        let reason: String
        var receipts: [String: DevicePrivacyReceipt]
    }
    let userId: String
    var nextOffset: Int? = 0
    private(set) var leases: [Lease] = []
    private(set) var finishedScopes: [String] = []
    // Optional fields preserve decoding of an older operational queue. Only
    // fresh server-qualified candidates can reopen a cooled scope; time alone
    // never restores permission or marks a photograph analyzed.
    private(set) var deferredScopes: [DeferredScope]? = nil
    private(set) var finishReasons: [String: String]? = nil
    init(userId: String) { self.userId = userId.lowercased() }

    mutating func offer(_ candidate: Candidate, now: Date) {
        guard candidate.valid, leases.count < 16, !finishedScopes.contains(candidate.key),
              !leases.contains(where: { $0.candidate.key == candidate.key }) else { return }
        var receiptCache: [String: DevicePrivacyReceipt] = [:]
        if let index = deferredScopes?.firstIndex(where: { $0.key == candidate.key }), let deferred = deferredScopes?[index] {
            guard deferred.retryAfter <= now else { return }
            receiptCache = deferred.receipts.filter { key, receipt in
                receipt.owner_user_id == userId && candidate.inspect.contains { $0.receipt_image_id == key && $0.source_sha256 == receipt.source_sha256 }
            }
            deferredScopes?.remove(at: index)
        }
        leases.append(Lease(candidate: candidate, nextAttemptAt: now, receipts: receiptCache))
    }
    var hasCapacity: Bool { leases.count < 16 }
    mutating func beginAttempt(now: Date) -> Lease? {
        let exhausted = leases.filter { $0.attempts >= 3 && $0.nextAttemptAt <= now }
        for lease in exhausted {
            leases.removeAll { $0.candidate.key == lease.candidate.key }
            var deferred = deferredScopes ?? []
            deferred.removeAll { $0.key == lease.candidate.key }
            deferred.append(.init(key: lease.candidate.key, currentImageIds: lease.candidate.inspect.map(\.current_image_id),
                retryAfter: now.addingTimeInterval(24 * 60 * 60), reason: lease.lastFailure ?? "transient_attempts_exhausted", receipts: lease.receipts))
            if deferred.count > 8_000 { deferred.removeFirst(deferred.count - 8_000) }
            // Keep bounded receipt payloads as well as lightweight cooldowns.
            for index in deferred.indices.dropLast(16) { deferred[index].receipts = [:] }
            deferredScopes = deferred
        }
        guard let index = leases.indices.filter({ leases[$0].nextAttemptAt <= now }).min(by: {
            leases[$0].attempts == leases[$1].attempts ? leases[$0].nextAttemptAt < leases[$1].nextAttemptAt : leases[$0].attempts < leases[$1].attempts
        }) else { return nil }
        leases[index].attempts += 1
        leases[index].nextAttemptAt = now.addingTimeInterval([120.0, 600.0, 3600.0][leases[index].attempts - 1])
        return leases[index]
    }
    mutating func retain(_ receipt: DevicePrivacyReceipt, witness: Candidate.Witness, key: String) {
        guard let index = leases.firstIndex(where: { $0.candidate.key == key }), receipt.owner_user_id == userId,
              receipt.source_sha256 == witness.source_sha256, leases[index].candidate.inspect.contains(witness) else { return }
        leases[index].receipts[witness.receipt_image_id] = receipt
    }
    mutating func noteFailure(_ key: String, reason: String) {
        guard let index = leases.firstIndex(where: { $0.candidate.key == key }) else { return }
        leases[index].lastFailure = reason
    }
    mutating func finish(_ key: String, reason: String = "reconciled") {
        leases.removeAll { $0.candidate.key == key }
        deferredScopes?.removeAll { $0.key == key }
        if !finishedScopes.contains(key) { finishedScopes.append(key) }
        if finishedScopes.count > 8_000 { finishedScopes.removeFirst(finishedScopes.count - 8_000) }
        var reasons = finishReasons ?? [:]; reasons[key] = reason
        let retained = Set(finishedScopes)
        finishReasons = reasons.filter { retained.contains($0.key) }
    }
}

enum SubjectReinspectionFailure: Error { case scope, unavailable, changedBytes, privacyHeld }

/// Injectable execution seam for the actual exact-original read/prepare path.
/// The production loader uses PhotoKit's original version with network disabled.
@MainActor
enum SubjectReinspectionWork {
    static func inspect(_ lease: SubjectReinspectionQueue.Lease, userId: String,
        mayContinue: () -> Bool,
        original: (String) async throws -> Data,
        prepare: (Data, String) async throws -> SyncEngine.PreparedOriginal = { try await SyncEngine.prepare($0, userId: $1) },
        didInspect: (DevicePrivacyReceipt, SubjectReinspectionQueue.Candidate.Witness) throws -> Void
    ) async throws -> [String: DevicePrivacyReceipt] {
        guard lease.candidate.valid, UUID(uuidString: userId) != nil else { throw SubjectReinspectionFailure.scope }
        var receipts: [String: DevicePrivacyReceipt] = [:]
        for witness in lease.candidate.inspect { // Candidate caps this at two originals per pass.
            guard mayContinue(), !Task.isCancelled else { throw SubjectReinspectionFailure.unavailable }
            if let receipt = lease.receipts[witness.receipt_image_id], receipt.owner_user_id == userId.lowercased(),
               receipt.source_sha256 == witness.source_sha256 { receipts[witness.receipt_image_id] = receipt; continue }
            let data = try await original(witness.local_identifier)
            guard mayContinue(), !Task.isCancelled else { throw SubjectReinspectionFailure.unavailable }
            guard (1...4_194_304).contains(data.count), SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == witness.source_sha256 else {
                throw SubjectReinspectionFailure.changedBytes
            }
            let prepared = try await prepare(data, userId)
            guard mayContinue(), !Task.isCancelled else { throw SubjectReinspectionFailure.unavailable }
            guard prepared.pixelsEligible else { throw SubjectReinspectionFailure.privacyHeld }
            guard let receipt = prepared.privacyReceipt, receipt.owner_user_id == userId.lowercased(),
                  receipt.source_sha256 == witness.source_sha256 else { throw SubjectReinspectionFailure.unavailable }
            try didInspect(receipt, witness)
            receipts[witness.receipt_image_id] = receipt
        }
        return receipts
    }
}
