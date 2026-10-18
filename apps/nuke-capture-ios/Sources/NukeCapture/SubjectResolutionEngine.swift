import Foundation
import Supabase
import UIKit
import Photos

/// One bounded cloud comparison per foreground sync pass, over already uploaded own sources.
/// No PhotoKit reads, local classification, canonical filing or owner assertion occurs here.
@MainActor
final class SubjectResolutionEngine: ObservableObject {
    static let shared = SubjectResolutionEngine()
    static let didChange = Notification.Name("visualSubjectResolutionDidChange")
    @Published private(set) var lastSummary: String?
    @Published private(set) var lastSummaryUserId: String?
    @Published private(set) var providerNeedsReview = false
    @Published private(set) var isRunning = false
    private let defaults = UserDefaults.standard
    private init() {}

    private func key(_ userId: String) -> String { "subjectResolution.\(SubjectResolutionQueue.method).\(userId.lowercased())" }
    private func load(_ userId: String) throws -> SubjectResolutionQueue {
        guard let data = defaults.data(forKey: key(userId)) else { return SubjectResolutionQueue() }
        return try JSONDecoder().decode(SubjectResolutionQueue.self, from: data)
    }
    private func save(_ queue: SubjectResolutionQueue, _ userId: String) throws {
        // The background uploader may acknowledge another frame during an awaited network read.
        // Retain those new queue entries when this foreground attempt saves its older snapshot.
        var merged = queue
        merged.preserveAcknowledgements(from: try load(userId))
        defaults.set(try JSONEncoder().encode(merged), forKey: key(userId))
    }
    private func stillOwnAccount(_ userId: String) -> Bool {
        guard let current = SupabaseService.currentUserId else { return false }
        return UUID(uuidString: current) == UUID(uuidString: userId) && UUID(uuidString: userId) != nil
    }

    func acknowledge(localIdentifier: String, sourceHash: String, userId: String, privacyReceipt: DevicePrivacyReceipt? = nil) {
        guard stillOwnAccount(userId) else { return }
        do {
            var queue = try load(userId)
            queue.acknowledge(localIdentifier: localIdentifier, sourceHash: sourceHash, now: Date(),
                privacyReceipt: privacyReceipt?.owner_user_id == userId.lowercased() ? privacyReceipt : nil)
            try save(queue, userId)
        } catch { state("Visual analysis couldn't retain its upload queue. \(ReadFailure.text(error))", userId: userId) }
    }

    struct Source: Decodable {
        struct Exif: Decodable { let uuid: String? }
        let id: String
        let user_id: String?
        let file_hash: String?
        let image_url: String?
        let vision_gate_status: String?
        let is_superseded: Bool?
        let is_duplicate: Bool?
        let is_document: Bool?
        let is_sensitive: Bool?
        let exif_data: Exif?

        func approved(for userId: String, hash: String, privacyReceipt: DevicePrivacyReceipt? = nil) -> Bool {
            user_id?.lowercased() == userId.lowercased() && file_hash == hash
                && !(image_url ?? "").isEmpty && (vision_gate_status == "approved" ||
                    vision_gate_status == "pending" && privacyReceipt?.source_sha256 == hash && privacyReceipt?.owner_user_id == userId.lowercased())
                && is_superseded != true && is_duplicate != true && is_document != true && is_sensitive != true
                && UUID(uuidString: id) != nil
        }
        var withdrawn: Bool {
            is_superseded == true || is_duplicate == true || is_document == true || is_sensitive == true
                || (vision_gate_status?.hasPrefix("rejected") == true)
        }
    }
    struct Response: Decodable {
        struct Unresolved: Decodable { let image_id: String; let reason: String }
        let method: String
        let status: String
        let persisted_image_ids: [String]
        let retained_reading_image_ids: [String]?
        let deferred_image_ids: [String]
        let unresolved: [Unresolved]
        let refusal: String?
        let reinspection_candidate: SubjectReinspectionQueue.Candidate?
        let provider_diagnostics: [SubjectProviderDiagnostic]?
        let provider_attempt_coverage: SubjectProviderDiagnostic.AttemptCoverage?
    }
    private struct Request: Encodable {
        let mode = "resolve_subjects"
        let user_id: String
        let image_ids: [String]
        let expected_source_hashes: [String: String]
        let dry_run = false
        let reuse_only: Bool
        let device_privacy_receipts: [String: DevicePrivacyReceipt]
    }

    private struct ReinspectionReadRequest: Encodable {
        let mode = "read_subject_reinspections"
        let user_id: String
        let offset: Int
    }
    private struct ReinspectionReadResponse: Decodable {
        let method: String
        let candidates: [SubjectReinspectionQueue.Candidate]
        let next_offset: Int?
    }
    private func historicalKey(_ userId: String) -> String {
        "subjectResolution.\(SubjectReinspectionQueue.method).\(userId.lowercased())"
    }
    private func loadHistorical(_ userId: String) throws -> SubjectReinspectionQueue {
        guard let data = defaults.data(forKey: historicalKey(userId)) else { return SubjectReinspectionQueue(userId: userId) }
        let queue = try JSONDecoder().decode(SubjectReinspectionQueue.self, from: data)
        guard queue.userId == userId.lowercased() else { throw SubjectReinspectionFailure.scope }
        return queue
    }
    private func saveHistorical(_ queue: SubjectReinspectionQueue, _ userId: String) throws {
        guard stillOwnAccount(userId), queue.userId == userId.lowercased() else { throw SubjectReinspectionFailure.scope }
        defaults.set(try JSONEncoder().encode(queue), forKey: historicalKey(userId))
    }
    private func mayReinspect(_ userId: String) -> Bool {
        stillOwnAccount(userId) && !Task.isCancelled && UIApplication.shared.applicationState == .active
            && !SyncEngine.deviceWarm && !SyncEngine.shared.isPaused
    }

    /// A separate operational lease repairs historical pending sources without
    /// touching upload settlement. List/detail readers never call this method.
    /// The server supplies only qualified metadata for an existing paid reading.
    func runHistoricalAfterSync(userId: String) async {
        guard !isRunning, mayReinspect(userId) else { return }
        isRunning = true
        defer { isRunning = false }
        var historicalLeaseKey: String?
        do {
            var queue = try loadHistorical(userId)
            if queue.hasCapacity {
                let response: ReinspectionReadResponse = try await SupabaseService.client.functions.invoke("check-image-vehicle-match",
                    options: FunctionInvokeOptions(body: ReinspectionReadRequest(user_id: userId, offset: queue.nextOffset ?? 0)))
                guard mayReinspect(userId) else { return }
                guard response.method == SubjectReinspectionQueue.method, response.candidates.count <= 1,
                      response.candidates.allSatisfy(\.valid), response.next_offset == nil || (0...1_000_000).contains(response.next_offset!) else {
                    throw SubjectReinspectionFailure.scope
                }
                queue.nextOffset = response.next_offset
                for candidate in response.candidates { queue.offer(candidate, now: Date()) }
                try saveHistorical(queue, userId) // Advance even if Photos later cannot access this candidate.
            }
            guard mayReinspect(userId), let lease = queue.beginAttempt(now: Date()) else { return }
            historicalLeaseKey = lease.candidate.key
            try saveHistorical(queue, userId) // Persist the lease before opening an original.
            let receipts: [String: DevicePrivacyReceipt]
            do {
                receipts = try await SubjectReinspectionWork.inspect(lease, userId: userId,
                    mayContinue: { self.mayReinspect(userId) }, original: { localIdentifier in
                        let assets = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
                        guard let asset = assets.firstObject, asset.localIdentifier == localIdentifier,
                              asset.mediaType == .image else { throw SubjectReinspectionFailure.unavailable }
                        return try await SyncEngine.requestOriginalData(for: asset, allowNetwork: false)
                    }, didInspect: { receipt, witness in
                        queue.retain(receipt, witness: witness, key: lease.candidate.key)
                        try self.saveHistorical(queue, userId)
                    })
            } catch {
                guard stillOwnAccount(userId) else { return }
                switch error as? SubjectReinspectionFailure {
                case .privacyHeld: queue.finish(lease.candidate.key, reason: "completed_privacy_hold")
                case .changedBytes: queue.finish(lease.candidate.key, reason: "original_hash_changed")
                case .scope: queue.finish(lease.candidate.key, reason: "invalid_scope")
                default: queue.noteFailure(lease.candidate.key, reason: error is VisionEngine.TriageFailure ? "privacy_read_unavailable" : "original_unavailable")
                }
                try saveHistorical(queue, userId)
                state("Historical visual reading waits for its exact local original or a completed privacy read.", userId: userId)
                return // Bounded lease/backoff remains; later carrier pages can still proceed.
            }
            guard mayReinspect(userId) else { return }
            let candidate = lease.candidate
            let response: Response = try await SupabaseService.client.functions.invoke("check-image-vehicle-match",
                options: FunctionInvokeOptions(body: Request(user_id: userId, image_ids: candidate.image_ids,
                    expected_source_hashes: candidate.expected_source_hashes, reuse_only: true, device_privacy_receipts: receipts)))
            guard stillOwnAccount(userId) else { return }
            guard response.method == SubjectResolutionQueue.method else {
                queue.noteFailure(candidate.key, reason: "unreadable_response_method")
                try saveHistorical(queue, userId)
                return
            }
            let requested = Set(candidate.image_ids.map { $0.lowercased() })
            if ["resolved", "cached", "unresolved"].contains(response.status), response.method == SubjectResolutionQueue.method,
               SubjectResolutionQueue.completeReceipt(requested: requested, persisted: response.persisted_image_ids,
                 unresolved: response.unresolved.map(\.image_id), deferred: response.deferred_image_ids) {
                queue.finish(candidate.key)
                if !response.persisted_image_ids.isEmpty { NotificationCenter.default.post(name: Self.didChange, object: nil) }
            } else if response.method == SubjectResolutionQueue.method, response.status == "refused", response.refusal == "source_privacy_partial",
                      let remaining = response.reinspection_candidate, remaining.valid,
                      remaining.reading_id == candidate.reading_id, remaining.run_key == candidate.run_key,
                      remaining.expected_source_hashes == candidate.expected_source_hashes,
                      Set(remaining.image_ids) == Set(candidate.image_ids) {
                queue.finish(candidate.key, reason: "privacy_progress")
                queue.offer(remaining, now: Date()) // The third pending original is a later bounded pass.
            } else if response.status == "refused", !["source_not_ready", "required_input_unavailable"].contains(response.refusal ?? "") {
                queue.finish(candidate.key, reason: response.refusal ?? "hard_refusal") // Operational refusal is not an analyzed-photo flag.
            } else {
                queue.noteFailure(candidate.key, reason: response.refusal ?? "incomplete_reconciliation")
            }
            try saveHistorical(queue, userId)
        } catch {
            guard stillOwnAccount(userId) else { return }
            if let key = historicalLeaseKey, var queue = try? loadHistorical(userId) {
                queue.noteFailure(key, reason: "transport_or_source_read_unavailable")
                try? saveHistorical(queue, userId)
            }
            state("Historical visual reading couldn't finish. \(ReadFailure.text(error))", userId: userId)
        }
    }

    func runAfterSync(userId: String) async {
        guard !isRunning, stillOwnAccount(userId), !Task.isCancelled,
              UIApplication.shared.applicationState == .active, !SyncEngine.deviceWarm,
              !SyncEngine.shared.isPaused else { return }
        isRunning = true
        defer { isRunning = false }
        do {
            var queue = try load(userId)
            if queue.active == nil {
                let waiting = queue.readyForSourceRead(now: Date())
                guard !waiting.isEmpty else { return }
                let rows: [Source]
                do {
                    rows = try await SupabaseService.client.from("vehicle_images")
                        .select("id,user_id,file_hash,image_url,vision_gate_status,is_superseded,is_duplicate,is_document,is_sensitive,exif_data")
                        .eq("user_id", value: userId)
                        .in("file_hash", values: waiting.map(\.sourceHash))
                        .limit(120).execute().value
                } catch {
                    guard stillOwnAccount(userId) else { return }
                    queue.deferSources(Set(waiting.map(\.sourceHash)), now: Date(),
                        reason: "Visual analysis couldn't load its sources. \(ReadFailure.text(error))")
                    try save(queue, userId); state(queue.lastOutcome!, userId: userId); return
                }
                guard stillOwnAccount(userId), !Task.isCancelled else { return }
                var inputs: [SubjectResolutionQueue.Input] = []
                var gated = Set<String>(), withdrawn = Set<String>()
                for upload in waiting {
                    let matching = rows.filter { $0.file_hash == upload.sourceHash }
                    let qualified = matching.filter { $0.approved(for: userId, hash: upload.sourceHash, privacyReceipt: upload.privacyReceipt) }
                    // Duplicate acknowledgements may resolve to an older same-byte row. Prefer the
                    // exact source witness; a hash alone still names the exact acknowledged bytes.
                    let exact = qualified.filter { $0.exif_data?.uuid == upload.localIdentifier }
                    if let row = (exact.isEmpty ? qualified : exact).sorted(by: { $0.id < $1.id }).first {
                        inputs.append(.init(imageId: row.id, sourceHash: upload.sourceHash))
                    } else if !matching.isEmpty, matching.allSatisfy(\.withdrawn) {
                        withdrawn.insert(upload.sourceHash)
                    } else { gated.insert(upload.sourceHash) }
                }
                if !withdrawn.isEmpty { queue.finishSources(withdrawn, reason: "Source photos are held or withdrawn; no visual analysis requested.") }
                if !gated.isEmpty { queue.deferSources(gated, now: Date(), reason: "Visual analysis is waiting for current, approved source rows.") }
                // The server consumes one fresh source with up to two protected context frames,
                // or bootstraps two fresh sources. Unconsumed sources remain queued, not retried.
                // Time may rank retrieval; correspondence still needs actual photo evidence.
                _ = queue.stage(Array(inputs.prefix(2)), now: Date())
                try save(queue, userId)
                guard queue.active != nil else { state(queue.lastOutcome ?? "Visual analysis needs another qualified view.", userId: userId); return }
            }
            guard UIApplication.shared.applicationState == .active, !SyncEngine.deviceWarm,
                  !SyncEngine.shared.isPaused, stillOwnAccount(userId), !Task.isCancelled else { return }
            let attempt = queue.beginAttempt(now: Date())
            try save(queue, userId)
            guard let batch = attempt else {
                if let outcome = queue.lastOutcome { state(outcome, userId: userId) }
                return
            }
            let response: Response
            do {
                response = try await SupabaseService.client.functions.invoke("check-image-vehicle-match",
                    options: FunctionInvokeOptions(body: Request(user_id: userId,
                        image_ids: batch.inputs.map(\.imageId),
                        expected_source_hashes: Dictionary(uniqueKeysWithValues: batch.inputs.map { ($0.imageId, $0.sourceHash) }),
                        reuse_only: batch.reuseOnly,
                        device_privacy_receipts: Dictionary(uniqueKeysWithValues: batch.inputs.compactMap { input in
                            guard let receipt = queue.uploads.first(where: { $0.sourceHash == input.sourceHash })?.privacyReceipt else { return nil }
                            return (input.imageId, receipt)
                        }))))
            } catch {
                guard stillOwnAccount(userId) else { return }
                queue.retry(reason: "Visual analysis couldn't finish. \(ReadFailure.text(error))", reuseOnly: true)
                try save(queue, userId)
                state(queue.lastOutcome ?? "Visual analysis couldn't finish.", userId: userId)
                return
            }
            guard stillOwnAccount(userId) else { return }
            let requested = Set(batch.inputs.map { $0.imageId.lowercased() })
            let deferred = Set(response.deferred_image_ids.map { $0.lowercased() })
            let sourceReadChange = SubjectResolutionQueue.sourceReadChange(requested: requested,
                persisted: response.persisted_image_ids, retained: response.retained_reading_image_ids ?? [], deferred: response.deferred_image_ids)
            guard response.method == SubjectResolutionQueue.method,
                  sourceReadChange != .invalid,
                  deferred.count == response.deferred_image_ids.count && deferred.isSubset(of: requested),
                  Set(response.persisted_image_ids.map { $0.lowercased() }).isSubset(of: requested),
                  response.unresolved.allSatisfy({ requested.contains($0.image_id.lowercased()) }),
                  deferred.isDisjoint(with: response.persisted_image_ids.map { $0.lowercased() }),
                  deferred.isDisjoint(with: response.unresolved.map { $0.image_id.lowercased() }) else {
                queue.finish(reason: "Visual analysis returned an unreadable source receipt.")
                try save(queue, userId); state(queue.lastOutcome!, userId: userId); return
            }
            let providerDiagnostic = response.status == "refused" &&
                ["provider_unavailable", "provider_call_failed"].contains(response.refusal ?? "") &&
                (response.provider_diagnostics?.count ?? 0) <= 3
                ? SubjectProviderDiagnostic.primary(response.provider_diagnostics) : nil
            switch response.status {
            case "resolved", "cached", "unresolved":
                guard SubjectResolutionQueue.completeReceipt(requested: requested, persisted: response.persisted_image_ids,
                    unresolved: response.unresolved.map(\.image_id), deferred: response.deferred_image_ids) else {
                    queue.retry(reason: "Visual analysis omitted a source result; retrying its retained reading.", reuseOnly: true)
                    try save(queue, userId); state(queue.lastOutcome!, userId: userId); return
                }
                queue.releaseDeferred(deferred)
                let reasons = Set(response.unresolved.map(\.reason)).sorted().joined(separator: ", ")
                queue.finish(reason: response.persisted_image_ids.isEmpty
                    ? "Visual reading retained as unresolved\(reasons.isEmpty ? "." : ": \(reasons).")"
                    : "Visual subject observations saved; physical identity may remain unresolved.")
            case "partial":
                guard deferred.count < requested.count else {
                    queue.finish(reason: "Visual analysis returned no consumed source for its storage retry.")
                    try save(queue, userId); state(queue.lastOutcome!, userId: userId); return
                }
                queue.releaseDeferred(deferred)
                queue.retry(reason: "Some subject observations are waiting for storage retry.", reuseOnly: true)
            case "refused":
                let reason = response.refusal ?? "unspecified_refusal"
                if reason == "source_needs_corresponding_view" {
                    queue.awaitCorrespondingView(reason: "Visual analysis needs another corresponding photo; the upload remains saved.")
                } else if ["source_not_ready", "provider_unavailable", "provider_call_failed", "required_input_unavailable"].contains(reason) {
                    let reuseOnly = SubjectResolutionQueue.retryRequiresRetainedReading(refusal: reason,
                        alreadyReuseOnly: batch.reuseOnly,
                        providerReadNotStarted: SubjectProviderDiagnostic.provesNoReading(response.provider_diagnostics,
                            coverage: response.provider_attempt_coverage))
                    queue.retry(reason: providerDiagnostic?.message ?? "Visual analysis waiting: \(reason).", reuseOnly: reuseOnly,
                        readingWasNotStarted: !reuseOnly)
                } else { queue.finish(reason: "Visual analysis refused: \(reason).") }
            default:
                queue.finish(reason: "Visual analysis returned an unknown outcome.")
            }
            try save(queue, userId)
            state(queue.lastOutcome ?? "Visual analysis is waiting.", userId: userId,
                  providerNeedsReview: providerDiagnostic?.needsConnectionReview == true)
            if sourceReadChange == .changed {
                NotificationCenter.default.post(name: Self.didChange, object: nil)
            }
        } catch { state("Visual analysis couldn't load its sources. \(ReadFailure.text(error))", userId: userId) }
    }

    private func state(_ summary: String, userId: String, providerNeedsReview: Bool? = nil) {
        guard stillOwnAccount(userId) else { return }
        let presented = SubjectResolutionCopy.summary(summary)
        let review = SubjectProviderDiagnostic.reviewFlag(previousUser: lastSummaryUserId, user: userId.lowercased(),
            previousSummary: lastSummary, summary: presented, previousValue: self.providerNeedsReview, explicitValue: providerNeedsReview)
        if lastSummaryUserId != userId.lowercased() { lastSummary = nil }
        lastSummaryUserId = userId.lowercased()
        self.providerNeedsReview = review
        lastSummary = presented
        NSLog("NukeCapture visual subjects: %@", summary)
    }
}
