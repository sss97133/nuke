// VisionDecisionLog.swift: a local, on-device log of every filter decision.
//
// Ids and labels only: asset localIdentifier, category, reason, top labels with scores, and
// whether a face was seen. No image bytes, thumbnails, OCR text, GPS or EXIF are stored here.
// The optional upload (off by default) sends reject metadata only and never a sensitive row.

import Foundation
import GRDB
import Supabase

struct VisionDecisionRecord: Codable, Equatable, Sendable {
    struct Label: Codable, Equatable, Sendable { let id: String; let score: Double }
    let assetId: String
    /// "library" (LibraryIngest), "sync" (SyncEngine upload gate)
    let source: String
    /// VisionDecision.Category raw value, or "gate" for a metadata gate (no location, off site...).
    let category: String
    let reason: String
    let labels: [Label]
    let hasFace: Bool
    let decidedAt: Date

    static let gateCategory = "gate"

    init(assetId: String, source: String, decision: VisionDecision, labels: [(String, Float)], hasFace: Bool, decidedAt: Date = Date()) {
        self.init(assetId: assetId, source: source, category: decision.category.rawValue, reason: decision.reason,
                  labels: labels, hasFace: hasFace, decidedAt: decidedAt)
    }
    init(assetId: String, source: String, category: String, reason: String, labels: [(String, Float)] = [],
         hasFace: Bool = false, decidedAt: Date = Date()) {
        self.assetId = assetId; self.source = source; self.category = category; self.reason = reason
        self.labels = labels.prefix(5).map { Label(id: $0.0, score: (Double($0.1) * 1000).rounded() / 1000) }
        self.hasFace = hasFace; self.decidedAt = decidedAt
    }

    var isSensitive: Bool { category == VisionDecision.Category.sensitive.rawValue }
    var isReject: Bool { category != VisionDecision.Category.work.rawValue }
}

struct VisionDecisionCount: Hashable, Identifiable, Sendable {
    let category: String, reason: String, count: Int
    var id: String { category + "/" + reason }
}

final class VisionDecisionLog: @unchecked Sendable {
    static let shared: VisionDecisionLog = {
        let fm = FileManager.default
        let dir = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? fm.temporaryDirectory
        let queue = (try? DatabaseQueue(path: dir.appendingPathComponent("nuke-vision-decisions.sqlite").path))
            ?? (try! DatabaseQueue())
        return (try? VisionDecisionLog(queue)) ?? (try! VisionDecisionLog(DatabaseQueue()))
    }()

    private let db: DatabaseQueue
    init(_ db: DatabaseQueue) throws {
        self.db = db
        var m = DatabaseMigrator()
        m.registerMigration("v1_vision_decisions") { db in
            try db.create(table: "vision_decision") { t in
                t.column("assetId", .text).notNull()
                t.column("source", .text).notNull()
                t.column("category", .text).notNull()
                t.column("reason", .text).notNull()
                t.column("labelsJSON", .text).notNull()
                t.column("hasFace", .boolean).notNull()
                t.column("decidedAt", .datetime).notNull()
                t.primaryKey(["assetId", "source"])
            }
        }
        try m.migrate(db)
    }

    static func encodeLabels(_ labels: [VisionDecisionRecord.Label]) -> String {
        let e = JSONEncoder(); e.outputFormatting = [.sortedKeys]
        return String(decoding: (try? e.encode(labels)) ?? Data("[]".utf8), as: UTF8.self)
    }
    static func decodeLabels(_ json: String) -> [VisionDecisionRecord.Label] {
        (try? JSONDecoder().decode([VisionDecisionRecord.Label].self, from: Data(json.utf8))) ?? []
    }

    /// Latest decision per (asset, source) wins.
    func record(_ r: VisionDecisionRecord) {
        do {
            try db.write { db in
                try db.execute(sql: """
                    INSERT INTO vision_decision(assetId,source,category,reason,labelsJSON,hasFace,decidedAt) VALUES (?,?,?,?,?,?,?)
                    ON CONFLICT(assetId,source) DO UPDATE SET category=excluded.category, reason=excluded.reason,
                      labelsJSON=excluded.labelsJSON, hasFace=excluded.hasFace, decidedAt=excluded.decidedAt
                    """, arguments: [r.assetId, r.source, r.category, r.reason, Self.encodeLabels(r.labels), r.hasFace, r.decidedAt])
            }
        } catch { NSLog("VisionDecisionLog: write failed: %@", String(describing: error)) }
    }

    func counts(source: String? = nil) -> [VisionDecisionCount] {
        (try? db.read { db in
            try Row.fetchAll(db, sql: """
                SELECT category, reason, COUNT(*) AS n FROM vision_decision
                WHERE (? IS NULL OR source = ?) GROUP BY category, reason ORDER BY category, n DESC
                """, arguments: [source, source])
                .map { VisionDecisionCount(category: $0["category"], reason: $0["reason"], count: $0["n"]) }
        }) ?? []
    }

    func records(limit: Int = 100_000) -> [VisionDecisionRecord] {
        (try? db.read { db in
            try Row.fetchAll(db, sql: "SELECT * FROM vision_decision ORDER BY decidedAt DESC LIMIT ?", arguments: [limit]).map {
                VisionDecisionRecord(assetId: $0["assetId"], source: $0["source"], category: $0["category"], reason: $0["reason"],
                    labels: Self.decodeLabels($0["labelsJSON"]).map { ($0.id, Float($0.score)) },
                    hasFace: $0["hasFace"], decidedAt: $0["decidedAt"])
            }
        }) ?? []
    }
}

// MARK: - Optional reject-metadata upload (off by default)

enum VisionRejectUpload {
    static let enabledKey = "visionRejectUpload.enabled"
    static var isEnabled: Bool { UserDefaults.standard.bool(forKey: enabledKey) }   // unset ⇒ false

    struct Item: Encodable, Equatable {
        let asset_id: String, source: String, category: String, reason: String
        let labels: [VisionDecisionRecord.Label]
    }

    /// Rejects only, and never a sensitive one: a sensitive row is not in the payload at all,
    /// not even its id or reason. No bytes exist in a record to begin with.
    static func payload(_ records: [VisionDecisionRecord], cap: Int = 500) -> [Item] {
        records.filter { $0.isReject && !$0.isSensitive }.prefix(cap).map {
            Item(asset_id: $0.assetId, source: $0.source, category: $0.category, reason: $0.reason, labels: $0.labels)
        }
    }

    /// Reuses the existing `app_events` table (same insert SyncEngine's pass report uses).
    @discardableResult
    static func uploadIfEnabled(log: VisionDecisionLog = .shared) async -> Int {
        guard isEnabled else { return 0 }
        let items = payload(log.records())
        guard !items.isEmpty else { return 0 }
        struct Row: Encodable { let event: String; let props: Props; let user_id: String?; let path: String }
        struct Props: Encodable { let rejects: [Item]; let count: Int }
        let row = Row(event: "ios_vision_rejects", props: Props(rejects: items, count: items.count),
                      user_id: SupabaseService.currentUserId, path: "ios/vision")
        do { try await SupabaseService.client.from("app_events").insert(row).execute(); return items.count }
        catch { NSLog("VisionRejectUpload failed: %@", String(describing: error)); return 0 }
    }
}

extension VisionDecisionLog {
    /// LibraryIngest's library-wide read: logs the decision and returns the grid's personal verdict.
    /// People with vehicle/part/tool/shop context are not personal (soft signal).
    @discardableResult
    func recordLibrary(assetId: String, _ cls: VisionEngine.Classification, face: Bool, isScreenshot: Bool) -> Bool {
        let d = VisionDecision.decide(labels: cls.labels, isVehicle: cls.isVehicle, face: face, isScreenshot: isScreenshot)
        record(.init(assetId: assetId, source: "library", decision: d, labels: cls.labels, hasFace: face))
        return face && d.isPersonal
    }
}
