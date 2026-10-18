import Foundation
import Supabase
import UIKit

/// One bounded cloud comparison per foreground sync pass, over already uploaded own sources.
/// No PhotoKit reads, local classification, canonical filing or owner assertion occurs here.
@MainActor
final class SubjectResolutionEngine: ObservableObject {
    static let shared = SubjectResolutionEngine()
    static let didChange = Notification.Name("visualSubjectResolutionDidChange")
    @Published private(set) var lastSummary: String?
    @Published private(set) var lastSummaryUserId: String?
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

    func acknowledge(localIdentifier: String, sourceHash: String, userId: String) {
        guard stillOwnAccount(userId) else { return }
        do {
            var queue = try load(userId)
            queue.acknowledge(localIdentifier: localIdentifier, sourceHash: sourceHash, now: Date())
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

        func approved(for userId: String, hash: String) -> Bool {
            user_id?.lowercased() == userId.lowercased() && file_hash == hash
                && !(image_url ?? "").isEmpty && vision_gate_status == "approved"
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
        let deferred_image_ids: [String]
        let unresolved: [Unresolved]
        let refusal: String?
    }
    private struct Request: Encodable {
        let mode = "resolve_subjects"
        let user_id: String
        let image_ids: [String]
        let expected_source_hashes: [String: String]
        let dry_run = false
        let reuse_only: Bool
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
                    let qualified = matching.filter { $0.approved(for: userId, hash: upload.sourceHash) }
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
                        reuse_only: batch.reuseOnly)))
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
            guard response.method == SubjectResolutionQueue.method,
                  deferred.count == response.deferred_image_ids.count && deferred.isSubset(of: requested),
                  Set(response.persisted_image_ids.map { $0.lowercased() }).isSubset(of: requested),
                  response.unresolved.allSatisfy({ requested.contains($0.image_id.lowercased()) }),
                  deferred.isDisjoint(with: response.persisted_image_ids.map { $0.lowercased() }),
                  deferred.isDisjoint(with: response.unresolved.map { $0.image_id.lowercased() }) else {
                queue.finish(reason: "Visual analysis returned an unreadable source receipt.")
                try save(queue, userId); state(queue.lastOutcome!, userId: userId); return
            }
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
                        alreadyReuseOnly: batch.reuseOnly)
                    queue.retry(reason: "Visual analysis waiting: \(reason).", reuseOnly: reuseOnly,
                        readingWasNotStarted: !reuseOnly)
                } else { queue.finish(reason: "Visual analysis refused: \(reason).") }
            default:
                queue.finish(reason: "Visual analysis returned an unknown outcome.")
            }
            try save(queue, userId)
            state(queue.lastOutcome ?? "Visual analysis is waiting.", userId: userId)
            if !response.persisted_image_ids.isEmpty {
                NotificationCenter.default.post(name: Self.didChange, object: nil)
            }
        } catch { state("Visual analysis couldn't load its sources. \(ReadFailure.text(error))", userId: userId) }
    }

    private func state(_ summary: String, userId: String) {
        guard stillOwnAccount(userId) else { return }
        if lastSummaryUserId != userId.lowercased() { lastSummary = nil }
        lastSummaryUserId = userId.lowercased()
        lastSummary = summary
        NSLog("NukeCapture visual subjects: %@", summary)
    }
}
