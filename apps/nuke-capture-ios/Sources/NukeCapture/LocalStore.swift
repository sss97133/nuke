//  LocalStore.swift — the on-device notebook (GRDB). The app's own database.
//
//  THE MISSING ORGAN (local-first pipeline, Phase 1). Today the app ships every
//  photo to the cloud and reads everything back down — nothing renders offline.
//  This is the local mirror of the prod identity-first model
//  (image_identities → image_appearances → vehicle_images), so the phone can
//  understand and render a record WITHOUT a connection:
//
//      T0 (Apple Vision + the file's true EXIF)  ──writes──▶  LocalStore
//      Library glasses / day receipt             ──reads───▶  LocalStore
//      when online: the same payload             ──escalates▶ ingest_image_identity_first (prod RPC)
//
//  Keyed by content (phashHex) like prod, and indexed by PHAsset.localIdentifier
//  (= the exif_data.uuid stamped on upload) so the Library glasses seam can
//  resolve a cell → what we know about it, offline, off the scroll path.
//
//  GRDB is thread-safe; this type is NOT main-actor-confined. Callers on the
//  main actor (LibraryOverlayStore) hop to it async and publish on main.

import Foundation
import GRDB

// MARK: - Records (mirror the prod identity-first model)

/// ROOT — one row per unique image *content*. Mirrors prod `image_identities`.
struct LocalImageIdentity: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "image_identity"
    var phashHex: String            // primary key — the content identity
    var contentSha256: String?
    var firstSeenAt: Date
}

/// INSTANCE — one sighting of an identity on THIS device. Mirrors `image_appearances`.
/// Keyed by `localIdentifier` (one PHAsset = one local sighting).
struct LocalAppearance: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "appearance"
    var localIdentifier: String     // primary key — PHAsset.localIdentifier (the Library cell key)
    var phashHex: String?           // FK → image_identity (nil until a phash is computed)
    var sourceType: String          // 'camera_capture' | 'local_filesystem' | …
    var takenAt: Date?              // file EXIF DateTimeOriginal — TRUTH, never PHAsset.creationDate
    var latitude: Double?
    var longitude: Double?
    var cameraMake: String?
    var cameraModel: String?
    var appleMLLabelsJSON: String?  // T0 labels (VisionEngine), JSON array
    var analyzedAt: Date?           // when T0 wrote the labels
    var createdAt: Date
}

/// LEAF — the vehicle binding (ownership derived on-device). Mirrors `vehicle_images`.
struct LocalVehicleImage: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "vehicle_image"
    var phashHex: String            // primary key — FK → image_identity
    var localIdentifier: String?
    var vehicleId: String?          // resolved on-device (VIN / site / attribution); nullable
    var sessionDate: String?        // 'yyyy-MM-dd' — the day bucket for the receipt
}

/// The back-of-the-photo ledger for one image — what the local store knows about it.
struct ImageLedger {
    let classified: Bool
    let isVehicle: Bool
    let isPersonal: Bool
    let labels: [String]
    let phashHex: String?
    let vehicleId: String?
    let sessionDate: String?
    let analyzedAt: Date?
}

// MARK: - The store

final class LocalStore {
    static let shared = LocalStore()
    private let dbQueue: DatabaseQueue

    private init() {
        let fm = FileManager.default
        let dir = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask,
                               appropriateFor: nil, create: true)) ?? fm.temporaryDirectory
        let path = dir.appendingPathComponent("nuke-local.sqlite").path
        // Assign dbQueue exactly once (a `let`): resolve the queue first, then migrate.
        let queue: DatabaseQueue
        do {
            queue = try DatabaseQueue(path: path)
        } catch {
            // Never crash the app over the store; an in-memory DB keeps it alive.
            NSLog("LocalStore: file DB open failed (%@) — using in-memory", String(describing: error))
            queue = try! DatabaseQueue()   // in-memory; only fails on catastrophic OOM
        }
        dbQueue = queue
        do { try Self.migrator.migrate(queue) }
        catch { NSLog("LocalStore: migrate failed: %@", String(describing: error)) }
    }

    // MARK: Schema

    private static var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("v1_identity_first") { db in
            try db.create(table: "image_identity") { t in
                t.column("phashHex", .text).primaryKey()
                t.column("contentSha256", .text)
                t.column("firstSeenAt", .datetime).notNull()
            }
            try db.create(table: "appearance") { t in
                t.column("localIdentifier", .text).primaryKey()
                t.column("phashHex", .text).indexed()
                t.column("sourceType", .text).notNull()
                t.column("takenAt", .datetime)
                t.column("latitude", .double)
                t.column("longitude", .double)
                t.column("cameraMake", .text)
                t.column("cameraModel", .text)
                t.column("appleMLLabelsJSON", .text)
                t.column("isVehicle", .boolean)     // T0 verdict — vehicle/work photo
                t.column("isPersonal", .boolean)    // T0 verdict — personal (not-vehicle OR prominent face)
                t.column("analyzedAt", .datetime)
                t.column("createdAt", .datetime).notNull()
            }
            try db.create(table: "vehicle_image") { t in
                t.column("phashHex", .text).primaryKey()
                t.column("localIdentifier", .text).indexed()
                t.column("vehicleId", .text)
                t.column("sessionDate", .text)
            }
        }
        m.registerMigration("v2_has_person") { db in
            try db.alter(table: "appearance") { t in t.add(column: "hasPerson", .boolean) }
            // The personal verdict rule changed (no longer auto-hides untagged work
            // photos — the arbitrary over-blur). Reset existing verdicts so every photo
            // re-classifies under the new rule on next view.
            try db.execute(sql: "UPDATE appearance SET isPersonal = NULL, isVehicle = NULL")
        }
        return m
    }

    // MARK: Write — the local twin of prod ingest_image_identity_first()

    /// Record (or update) one on-device photo's facts. Idempotent on the keys.
    /// `phashHex`/`vehicleId` may be nil and filled later as analysis resolves.
    func ingest(localIdentifier: String,
                sourceType: String = "local_filesystem",
                phashHex: String? = nil,
                takenAt: Date? = nil,
                latitude: Double? = nil,
                longitude: Double? = nil,
                cameraMake: String? = nil,
                cameraModel: String? = nil,
                appleMLLabels: [String]? = nil,
                vehicleId: String? = nil,
                sessionDate: String? = nil,
                now: Date = Date()) {
        var labelsJSON: String?
        if let appleMLLabels, let data = try? JSONEncoder().encode(appleMLLabels) {
            labelsJSON = String(data: data, encoding: .utf8)
        }
        do {
            try dbQueue.write { db in
                if let phashHex {
                    try LocalImageIdentity(phashHex: phashHex, contentSha256: nil, firstSeenAt: now)
                        .insert(db, onConflict: .ignore)
                }
                try LocalAppearance(
                    localIdentifier: localIdentifier, phashHex: phashHex, sourceType: sourceType,
                    takenAt: takenAt, latitude: latitude, longitude: longitude,
                    cameraMake: cameraMake, cameraModel: cameraModel,
                    appleMLLabelsJSON: labelsJSON,
                    analyzedAt: appleMLLabels == nil ? nil : now, createdAt: now
                ).insert(db, onConflict: .replace)
                if let phashHex {
                    try LocalVehicleImage(phashHex: phashHex, localIdentifier: localIdentifier,
                                          vehicleId: vehicleId, sessionDate: sessionDate)
                        .insert(db, onConflict: .replace)
                }
            }
        } catch {
            NSLog("LocalStore.ingest failed: %@", String(describing: error))
        }
    }

    // MARK: Read — the glasses resolve (Library badges), offline

    /// Resolve a batch of Library cells → what we know. This is what the empty
    /// `LibraryOverlayStore.note()` seam will call. Pure local read, no network.
    func decorations(for localIdentifiers: [String]) -> [String: LibraryDecoration] {
        guard !localIdentifiers.isEmpty else { return [:] }
        var out: [String: LibraryDecoration] = [:]
        do {
            try dbQueue.read { db in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT a.localIdentifier AS lid, a.appleMLLabelsJSON AS labels, v.vehicleId AS vid
                    FROM appearance a
                    LEFT JOIN vehicle_image v ON v.localIdentifier = a.localIdentifier
                    WHERE a.localIdentifier IN (\(databaseQuestionMarks(count: localIdentifiers.count)))
                    """, arguments: StatementArguments(localIdentifiers))
                for row in rows {
                    let lid: String = row["lid"]
                    let vid: String? = row["vid"]
                    let labels: String? = row["labels"]
                    let glyph = vid != nil ? "car.fill" : (labels != nil ? "sparkles" : "photo")
                    out[lid] = LibraryDecoration(known: true, glyph: glyph)
                }
            }
        } catch {
            NSLog("LocalStore.decorations failed: %@", String(describing: error))
        }
        return out
    }

    /// Day rollup for the receipt window — image counts per day (newest first),
    /// computed from the local appearances. Reads local only.
    func dayCounts() -> [(day: String, count: Int)] {
        var out: [(String, Int)] = []
        do {
            try dbQueue.read { db in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT strftime('%Y-%m-%d', takenAt) AS day, COUNT(*) AS n
                    FROM appearance WHERE takenAt IS NOT NULL
                    GROUP BY day ORDER BY day DESC
                    """)
                out = rows.map { ($0["day"] as String? ?? "—", ($0["n"] as Int?) ?? 0) }
            }
        } catch {
            NSLog("LocalStore.dayCounts failed: %@", String(describing: error))
        }
        return out
    }

    // MARK: Cheap on-device organization — the Apple-tag classification verdict

    /// Record one photo's T0 verdict (vehicle/personal + labels). Upsert in place so
    /// it never clobbers other columns (taken_at/GPS) an ingest may have written.
    func classify(localIdentifier: String, isVehicle: Bool, isPersonal: Bool, hasPerson: Bool, labels: [String], now: Date = Date()) {
        let labelsJSON = (try? JSONEncoder().encode(labels)).flatMap { String(data: $0, encoding: .utf8) }
        do {
            try dbQueue.write { db in
                try db.execute(sql: """
                    INSERT INTO appearance (localIdentifier, sourceType, isVehicle, isPersonal, hasPerson, appleMLLabelsJSON, analyzedAt, createdAt)
                    VALUES (?, 'local_filesystem', ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(localIdentifier) DO UPDATE SET
                        isVehicle = excluded.isVehicle,
                        isPersonal = excluded.isPersonal,
                        hasPerson = excluded.hasPerson,
                        appleMLLabelsJSON = excluded.appleMLLabelsJSON,
                        analyzedAt = excluded.analyzedAt
                    """, arguments: [localIdentifier, isVehicle, isPersonal, hasPerson, labelsJSON, now, now])
            }
        } catch { NSLog("LocalStore.classify failed: %@", String(describing: error)) }
    }

    /// Read the cached verdicts for a batch of cells (only rows already classified).
    func classification(for localIdentifiers: [String]) -> [String: (isPersonal: Bool, isVehicle: Bool, hasPerson: Bool, labels: [String])] {
        guard !localIdentifiers.isEmpty else { return [:] }
        var out: [String: (isPersonal: Bool, isVehicle: Bool, hasPerson: Bool, labels: [String])] = [:]
        do {
            try dbQueue.read { db in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT localIdentifier AS lid, isPersonal AS p, isVehicle AS v, hasPerson AS hp, appleMLLabelsJSON AS labels
                    FROM appearance
                    WHERE isPersonal IS NOT NULL AND localIdentifier IN (\(databaseQuestionMarks(count: localIdentifiers.count)))
                    """, arguments: StatementArguments(localIdentifiers))
                for r in rows {
                    let lid: String = r["lid"]
                    let p: Bool = r["p"] ?? false
                    let v: Bool = r["v"] ?? false
                    let hp: Bool = r["hp"] ?? false
                    let labelsStr: String? = r["labels"]
                    let labels = labelsStr.flatMap { try? JSONDecoder().decode([String].self, from: Data($0.utf8)) } ?? []
                    out[lid] = (p, v, hp, labels)
                }
            }
        } catch { NSLog("LocalStore.classification failed: %@", String(describing: error)) }
        return out
    }

    /// The full ledger for one image — classification + labels + identity + binding.
    /// Powers the info page (the back of the photo). nil if the row doesn't exist yet.
    func ledger(for localIdentifier: String) -> ImageLedger? {
        do {
            return try dbQueue.read { db -> ImageLedger? in
                guard let r = try Row.fetchOne(db, sql: """
                    SELECT a.isVehicle AS v, a.isPersonal AS p, a.appleMLLabelsJSON AS labels,
                           a.phashHex AS ph, a.analyzedAt AS an,
                           vi.vehicleId AS vid, vi.sessionDate AS day
                    FROM appearance a
                    LEFT JOIN vehicle_image vi ON vi.localIdentifier = a.localIdentifier
                    WHERE a.localIdentifier = ?
                    """, arguments: [localIdentifier]) else { return nil }
                let vOpt: Bool? = r["v"]
                let pOpt: Bool? = r["p"]
                let labelsStr: String? = r["labels"]
                let labels = labelsStr.flatMap { try? JSONDecoder().decode([String].self, from: Data($0.utf8)) } ?? []
                return ImageLedger(
                    classified: vOpt != nil,
                    isVehicle: vOpt ?? false,
                    isPersonal: pOpt ?? false,
                    labels: labels,
                    phashHex: r["ph"],
                    vehicleId: r["vid"],
                    sessionDate: r["day"],
                    analyzedAt: r["an"]
                )
            }
        } catch {
            NSLog("LocalStore.ledger failed: %@", String(describing: error))
            return nil
        }
    }
}
