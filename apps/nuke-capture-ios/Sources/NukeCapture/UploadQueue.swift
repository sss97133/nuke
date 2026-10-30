// UploadQueue.swift — uploads that outlive the app.
//
// Until 2026-10-29 the original bytes went up inside the sync pass through the Supabase SDK, so the
// upload died with the app's suspension: the owner shot 311 frames on 10-28, opened the app twice the
// next day, and 80 landed (40 per open, one every 8 s), the rest waiting for the next open. The pass now
// hands each gated original to a background URLSession: iOS carries the transfer after the app is
// suspended or killed, relaunches the app in the background when it finishes, and the row is inserted
// then. The record lands within seconds of the bytes, with the app closed.
//
// Order of operations per photo (unchanged gates, see SyncEngine.processAsset):
//   site gate → settled/dedupe → contributor verdict → original bytes → on-device triage → ownership
//   → (pixels eligible) write the bytes to the queue folder, persist the row the upload will insert,
//     start the transfer → the pass moves on.
//   On completion: 200/409 → insert the vehicle_images row → tell SyncEngine (seen-set, counters,
//   subject acknowledgement) → delete the file. A refused session (401) keeps the item for a retry with
//   a fresh token; a server or network failure keeps it (iOS retries the transfer itself); any other
//   4xx drops the item and counts one attempt against the photo.
//
// The queue is a JSON file in Application Support (not UserDefaults: it holds a row per photo). The
// state machine is a pure value (`UploadQueueState`) so the unit tests cover it without a session.

import Foundation
import Supabase
import UIKit

/// One photo owed to storage. The row it inserts was built when the original was read, so a relaunch
/// inserts it without touching PhotoKit again.
struct UploadItem: Codable, Equatable, Sendable {
    enum State: String, Codable, Sendable { case queued, uploading, uploaded }
    let assetID: String          // PHAsset.localIdentifier (one item per asset)
    let sha256: String
    let storagePath: String
    let fileName: String         // the bytes, inside UploadQueueState.directory
    let mimeType: String
    let seenKey: String          // "filename|bytes" for SyncEngine's dedupe set
    let userID: String
    let row: Data                // the encoded VehicleImageRow
    let privacyReceipt: DevicePrivacyReceipt?
    var state: State = .queued
    var attempts: Int = 0
    var createdAt: Date = Date()
    var lastError: String? = nil
}

/// Follow-up work, not a vehicle claim. The server's unfiled image remains the source of truth.
struct IdentityFollowupSource: Codable, Equatable, Sendable {
    let assetID: String
    let sha256: String
    let userID: String
    var methodVersion: String
    var privacyReceipt: DevicePrivacyReceipt? = nil
    var lastAttemptAt: Date? = nil
    var key: String { [userID, assetID, sha256, methodVersion].joined(separator: "|") }
    func matches(assetID: String?, sha256: String?, userID: String, methodVersion: String) -> Bool {
        self.userID == userID && self.assetID == assetID && self.sha256 == sha256 && self.methodVersion == methodVersion
    }
}

/// The queue's value: what is owed, what is in flight, what landed. Pure, so a test can drive it.
struct UploadQueueState: Codable, Equatable, Sendable {
    var items: [UploadItem] = []
    // Optional for queues written before identity follow-up existed.
    var identityFollowups: [IdentityFollowupSource]? = nil
    /// Rows inserted today (the Today screen's "landed" count), keyed by local day.
    var landedDay: String = ""
    var landedToday: Int = 0

    /// Enqueue or no-op when the asset is already owed (the next pass finds it pending, never re-reads
    /// the original).
    @discardableResult
    mutating func enqueue(_ item: UploadItem) -> Bool {
        guard !items.contains(where: { $0.assetID == item.assetID }) else { return false }
        items.append(item)
        return true
    }

    func item(for assetID: String) -> UploadItem? { items.first { $0.assetID == assetID } }
    func isPending(assetID: String) -> Bool { items.contains { $0.assetID == assetID } }
    var queued: [UploadItem] { items.filter { $0.state == .queued } }
    var inFlight: [UploadItem] { items.filter { $0.state == .uploading } }

    mutating func markUploading(assetID: String) {
        guard let i = items.firstIndex(where: { $0.assetID == assetID }) else { return }
        items[i].state = .uploading
        items[i].attempts += 1
    }

    /// The transfer finished and the row is in: the item leaves the queue.
    mutating func complete(assetID: String, dayKey: String, identityMethodVersion: String? = nil) {
        if let item = item(for: assetID), let method = identityMethodVersion {
            let source = IdentityFollowupSource(assetID: item.assetID, sha256: item.sha256, userID: item.userID, methodVersion: method,
                                               privacyReceipt: item.privacyReceipt)
            enqueueIdentity(source)
        }
        items.removeAll { $0.assetID == assetID }
        if landedDay != dayKey { landedDay = dayKey; landedToday = 0 }
        landedToday += 1
    }

    mutating func enqueueIdentity(_ source: IdentityFollowupSource, recovering: Bool = false) {
        var pending = identityFollowups ?? []
        // A recovery query can finish after a newer original was acknowledged.
        if recovering, pending.contains(where: { $0.userID == source.userID && $0.assetID == source.assetID }) { return }
        // A changed original/method supersedes owed work, never the retained source or testimony.
        pending.removeAll { $0.userID == source.userID && $0.assetID == source.assetID && $0.key != source.key }
        if let i = pending.firstIndex(where: { $0.key == source.key }) {
            if pending[i].privacyReceipt == nil { pending[i].privacyReceipt = source.privacyReceipt }
        } else { pending.append(source) }
        identityFollowups = pending
    }

    mutating func identityBatch(userID: String, methodVersion: String, limit: Int, now: Date) -> [IdentityFollowupSource] {
        var pending = identityFollowups ?? []
        for i in pending.indices where pending[i].userID == userID { pending[i].methodVersion = methodVersion }
        let batch = pending.filter { $0.userID == userID }.sorted {
            ($0.lastAttemptAt ?? .distantPast) < ($1.lastAttemptAt ?? .distantPast)
        }.prefix(max(0, limit))
        let keys = Set(batch.map(\.key))
        for i in pending.indices where keys.contains(pending[i].key) { pending[i].lastAttemptAt = now }
        identityFollowups = pending
        return Array(batch)
    }

    mutating func finishIdentity(_ completedKeys: Set<String>) {
        identityFollowups?.removeAll { completedKeys.contains($0.key) }
    }

    /// The transfer or the insert failed. A retryable failure returns the item to the queue; a final one
    /// drops it. Returns true when the item was dropped.
    @discardableResult
    mutating func fail(assetID: String, error: String, retryable: Bool, maxAttempts: Int) -> Bool {
        guard let i = items.firstIndex(where: { $0.assetID == assetID }) else { return false }
        items[i].lastError = error
        if retryable && items[i].attempts < maxAttempts {
            items[i].state = .queued
            return false
        }
        items.remove(at: i)
        return true
    }

    /// Items left `uploading` by a run that ended before its delegate fired (a kill mid-transfer) go back
    /// to `queued` when no task for them exists in the session.
    mutating func requeueOrphans(liveAssetIDs: Set<String>) {
        for i in items.indices where items[i].state == .uploading && !liveAssetIDs.contains(items[i].assetID) {
            items[i].state = .queued
        }
    }
}

/// How an HTTP status from storage or PostgREST is treated.
enum UploadResponseClass: Equatable {
    case success          // 2xx, or 409 / "already exists" (the path is the bytes' hash: same photo)
    case refusedSession   // 401: retry with a fresh token, then stop
    case transient        // 408, 425, 429, 5xx: iOS or the next pass retries; nothing counts against the photo
    case rejected         // other 4xx: the request itself is wrong; drop after noting one attempt

    static func classify(status: Int, body: String) -> UploadResponseClass {
        let lower = body.lowercased()
        switch status {
        case 200..<300: return .success
        case 409: return .success
        case 400 where lower.contains("already exists") || lower.contains("duplicate"): return .success
        case 401: return .refusedSession
        case 408, 425, 429, 500..<600: return .transient
        case 402 where lower.contains("quota") || lower.contains("exceed"): return .transient
        default: return .rejected
        }
    }
}

/// The background URLSession that carries the originals, and the insert that follows each one.
@MainActor
final class BackgroundUploader: NSObject, ObservableObject {
    static let shared = BackgroundUploader()

    @Published private(set) var queuedCount = 0
    @Published private(set) var inFlightCount = 0
    @Published private(set) var landedToday = 0
    @Published private(set) var lastError: String?

    private(set) var state = UploadQueueState()
    private let fm = FileManager.default
    private let stateURL: URL
    private let directory: URL
    private var session: URLSession!
    /// Response bodies per task, for the error text (small: storage answers in a few hundred bytes).
    private var bodies: [Int: Data] = [:]
    /// iOS hands this over when it relaunches the app for the session's events; called once every
    /// completion (transfer + insert) of that wake has been handled.
    private var relaunchCompletion: (() -> Void)?
    private var insertsInFlight = 0
    private var identityTask: Task<Void, Never>?
    private var identityRunning = false
    private var identityProgressed = false
    private var lastIdentityAttempt: Date?
    private var recoveredIdentityUsers = Set<String>()
    private var identityRecoveryTask: Task<Void, Never>?

    private override init() {
        let support = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? fm.temporaryDirectory
        directory = support.appendingPathComponent("capture-upload-queue", isDirectory: true)
        stateURL = directory.appendingPathComponent("queue.json")
        super.init()
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: stateURL), let decoded = try? JSONDecoder().decode(UploadQueueState.self, from: data) {
            state = decoded
        }
        let config = URLSessionConfiguration.background(withIdentifier: Config.uploadSessionID)
        config.isDiscretionary = false          // the owner wants the frame up now, not when iOS feels like it
        config.sessionSendsLaunchEvents = true  // relaunch us to insert the row
        config.waitsForConnectivity = true
        config.allowsCellularAccess = true      // a just-taken frame goes up on whatever link is there (the owner's call, 2026-10-29)
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        publish()
    }

    // ─── Enqueue (from the sync pass) ─────────────────────────────────────────

    func isPending(assetID: String) -> Bool { state.isPending(assetID: assetID) }

    /// Write the bytes beside the queue and start the transfer. Returns false when the asset was already
    /// owed. Never reads PhotoKit; the caller already passed every gate.
    @discardableResult
    func enqueue(assetID: String, data: Data, sha256: String, storagePath: String, mimeType: String,
                 seenKey: String, userID: String, row: Data, privacyReceipt: DevicePrivacyReceipt?) -> Bool {
        guard !state.isPending(assetID: assetID) else { return false }
        let fileName = sha256 + "-" + String(assetID.hashValue.magnitude) + ".bin"
        do {
            try data.write(to: directory.appendingPathComponent(fileName), options: .atomic)
        } catch {
            lastError = "could not stage the photo: \(error.localizedDescription)"
            return false
        }
        let item = UploadItem(assetID: assetID, sha256: sha256, storagePath: storagePath, fileName: fileName,
                              mimeType: mimeType, seenKey: seenKey, userID: userID, row: row, privacyReceipt: privacyReceipt)
        state.enqueue(item)
        persist()
        Task { await resume() }
        return true
    }

    /// Start every queued item that has no live task. Safe to call on every pass, wake and foreground.
    func resume() async {
        guard let userID = SupabaseService.currentUserId else { return }
        if !recoveredIdentityUsers.contains(userID), identityRecoveryTask == nil {
            // Never put a metadata query ahead of starting an original's transfer.
            identityRecoveryTask = Task { [weak self] in
                guard let self else { return }
                defer { self.identityRecoveryTask = nil }
                do {
                    // Recent landed captures only; no historical paid/discovery enrollment.
                    let sources = try await AttributionEngine.shared.recentAcknowledgedSources(userID: userID)
                    guard SupabaseService.currentUserId == userID else { return }
                    for source in sources { self.state.enqueueIdentity(source, recovering: true) }
                    if self.persist() { self.recoveredIdentityUsers.insert(userID) }
                    self.requestIdentityFollowup()
                } catch {
                    self.lastError = "Recent photo filing could not resume: \(ReadFailure.text(error))"
                }
            }
        }
        requestIdentityFollowup()
        let live = await liveTasks()
        state.requeueOrphans(liveAssetIDs: Set(live.compactMap(\.taskDescription)))
        let queued = state.queued
        guard !queued.isEmpty else { persist(); return }
        guard let token = await SupabaseService.accessToken() else {
            lastError = "no session for the upload"
            persist()
            return
        }
        for item in queued {
            let file = directory.appendingPathComponent(item.fileName)
            guard fm.fileExists(atPath: file.path) else {
                state.fail(assetID: item.assetID, error: "staged bytes missing", retryable: false, maxAttempts: Config.maxAttemptsPerAsset)
                continue
            }
            var request = SupabaseService.storageUploadRequest(path: item.storagePath, mimeType: item.mimeType, accessToken: token)
            request.timeoutInterval = 300
            let task = session.uploadTask(with: request, fromFile: file)
            task.taskDescription = item.assetID
            state.markUploading(assetID: item.assetID)
            task.resume()
        }
        persist()
    }

    /// Called by the app delegate when iOS relaunched us for this session's events.
    func attachRelaunchCompletion(_ handler: @escaping () -> Void) {
        relaunchCompletion = handler
    }

    // ─── Completion ───────────────────────────────────────────────────────────

    private func handle(assetID: String, status: Int?, body: String, transportError: Error?) async {
        guard let item = state.item(for: assetID) else { return }
        if let transportError {
            // Network: the background session already waited for connectivity; keep the item for the
            // next resume. Nothing counts against the photo.
            let text = transportError.localizedDescription
            state.fail(assetID: assetID, error: text, retryable: true, maxAttempts: Int.max)
            lastError = text
            persist()
            return
        }
        switch UploadResponseClass.classify(status: status ?? 0, body: body) {
        case .success:
            insertsInFlight += 1
            defer { insertsInFlight -= 1 }
            do {
                try await SupabaseService.insertImageRow(encoded: item.row)
            } catch {
                if SupabaseService.isAuthFailure(error) {
                    state.fail(assetID: assetID, error: "session refused at insert", retryable: true, maxAttempts: Int.max)
                    SyncEngine.shared.noteSessionRefused()
                } else if SyncEngine.countsAgainstThePhoto(error) {
                    state.fail(assetID: assetID, error: error.localizedDescription, retryable: false, maxAttempts: Config.maxAttemptsPerAsset)
                    SyncEngine.shared.uploadRejected(assetID: assetID, message: error.localizedDescription)
                } else {
                    state.fail(assetID: assetID, error: error.localizedDescription, retryable: true, maxAttempts: Int.max)
                }
                lastError = error.localizedDescription
                persist()
                return
            }
            let before = state
            state.complete(assetID: assetID, dayKey: Self.dayKey(Date()), identityMethodVersion: LibraryIngest.identityMethodVersion)
            // Persist the follow-up before dropping the transfer. A crash replays either stage safely.
            guard persist() else { state = before; return }
            try? fm.removeItem(at: directory.appendingPathComponent(item.fileName))
            lastError = nil
            SyncEngine.shared.uploadLanded(assetID: assetID, seenKey: item.seenKey, sha256: item.sha256,
                                           userID: item.userID, privacyReceipt: item.privacyReceipt)
        case .refusedSession:
            // The token staged with the transfer expired before iOS ran it. One retry with a fresh
            // token; a second refusal is the account, not the photo.
            let dropped = state.fail(assetID: assetID, error: "HTTP 401", retryable: item.attempts < 2, maxAttempts: 2)
            if dropped { SyncEngine.shared.noteSessionRefused() }
        case .transient:
            state.fail(assetID: assetID, error: "HTTP \(status ?? 0)", retryable: true, maxAttempts: Int.max)
            lastError = "storage answered \(status ?? 0); will retry"
        case .rejected:
            let text = "HTTP \(status ?? 0): \(body.prefix(120))"
            try? fm.removeItem(at: directory.appendingPathComponent(item.fileName))
            state.fail(assetID: assetID, error: text, retryable: false, maxAttempts: 0)
            SyncEngine.shared.uploadRejected(assetID: assetID, message: text)
            lastError = text
        }
        persist()
    }

    private func liveTasks() async -> [URLSessionTask] {
        await withCheckedContinuation { c in session.getAllTasks { c.resume(returning: $0) } }
    }

    @discardableResult
    private func persist() -> Bool {
        do {
            try JSONEncoder().encode(state).write(to: stateURL, options: .atomic)
        } catch {
            lastError = "Upload follow-up could not be saved: \(error.localizedDescription)"
            publish()
            return false
        }
        publish()
        return true
    }

    /// Coalesce arrivals. Fresh identity OCR is tiny and local while the app is active and cool;
    /// the existing charging job carries the larger budget. A held source stays persisted.
    func requestIdentityFollowup(after minimumDelay: TimeInterval = 2) {
        guard identityTask == nil, let userID = SupabaseService.currentUserId,
              (state.identityFollowups ?? []).contains(where: { $0.userID == userID }),
              UIApplication.shared.applicationState == .active else { return }
        let elapsed = lastIdentityAttempt.map { Date().timeIntervalSince($0) } ?? 15
        let delay = elapsed >= 0 ? max(minimumDelay, 15 - elapsed) : minimumDelay
        identityTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, !Task.isCancelled else { return }
            self.identityTask = nil
            let ran = await self.drainIdentityFollowups(ocrBudget: 2)
            // Only pending metadata is polled while held; no original is read until the gates pass.
            self.requestIdentityFollowup(after: ran && self.identityProgressed ? 2 : 60)
        }
    }

    @discardableResult
    func drainIdentityFollowups(ocrBudget: Int, background: Bool = false) async -> Bool {
        guard !identityRunning, !Task.isCancelled, let userID = SupabaseService.currentUserId,
              (background ? !SyncEngine.deviceTooHot : ProcessInfo.processInfo.thermalState == .nominal), !SyncEngine.lowPowerHolds,
              background || UIApplication.shared.applicationState == .active else { return false }
        let now = Date()
        if !background, let last = lastIdentityAttempt, now.timeIntervalSince(last) >= 0,
           now.timeIntervalSince(last) < 15 { return false }
        let sources = state.identityBatch(userID: userID, methodVersion: LibraryIngest.identityMethodVersion, limit: background ? 200 : 16, now: now)
        guard !sources.isEmpty, persist() else { return false }
        identityRunning = true
        identityProgressed = false
        lastIdentityAttempt = now
        defer { identityRunning = false }
        let completed = await AttributionEngine.shared.runAcknowledged(sources: sources, ocrBudget: ocrBudget)
        identityProgressed = !completed.isEmpty
        state.finishIdentity(completed)
        persist()
        return true
    }

    private func publish() {
        queuedCount = state.queued.count
        inFlightCount = state.inFlight.count
        landedToday = state.landedDay == Self.dayKey(Date()) ? state.landedToday : 0
    }

    nonisolated static func dayKey(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current
        return f.string(from: date)
    }

    private func finishRelaunchIfIdle() {
        guard let done = relaunchCompletion, insertsInFlight == 0 else { return }
        relaunchCompletion = nil
        done()
    }
}

extension BackgroundUploader: URLSessionDataDelegate {
    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let id = dataTask.taskIdentifier
        Task { @MainActor in
            var buf = self.bodies[id] ?? Data()
            if buf.count < 4096 { buf.append(data.prefix(4096 - buf.count)) }
            self.bodies[id] = buf
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = task.taskIdentifier
        let assetID = task.taskDescription
        let status = (task.response as? HTTPURLResponse)?.statusCode
        Task { @MainActor in
            let body = String(data: self.bodies.removeValue(forKey: id) ?? Data(), encoding: .utf8) ?? ""
            if let assetID { await self.handle(assetID: assetID, status: status, body: body, transportError: error) }
            self.finishRelaunchIfIdle()
        }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in self.finishRelaunchIfIdle() }
    }
}
