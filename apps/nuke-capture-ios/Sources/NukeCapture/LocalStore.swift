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
//
//  SUPERSEDE, NEVER OVERWRITE (the project's load-bearing rule, applied here):
//  three writers own DISJOINT columns and must not clobber each other —
//    • ingest()          → EXIF/identity (takenAt/GPS/phash/labels/vehicleId/sessionDate), COALESCE-fill
//    • classify()        → auto verdict (isVehicle/isPersonal/hasPerson), DO UPDATE in place
//    • setOwnerVerdict() → ownerVerdict (owner-PROVEN, top of trust; never auto-clobbered, never reset)
//  Any new writer uses ON CONFLICT DO UPDATE SET on its OWN columns only — never
//  `.replace` (delete+reinsert nulls every other column). See docs/design/HARD_RULES.md.

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

/// One day's receipt line: the dated photos, and — when classified — how many read
/// as vehicle/work. `classified` is the honesty gate: render the vehicle count ONLY
/// when classified > 0, so "0 vehicle" from an un-sorted day is never implied.
struct DayRollup {
    let day: String          // 'yyyy-MM-dd'
    let count: Int           // dated appearances that day
    let classified: Int      // rows carrying a real T0 verdict (isVehicle IS NOT NULL)
    let vehicles: Int        // rows classified as vehicle/work (isVehicle = 1)
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
        m.registerMigration("v3_owner_verdict") { db in
            // Owner's explicit Approve/Reject (the Select tool). Beats the auto verdict
            // (proven > projected). 'approved' | 'rejected' | null.
            // ⚠️ AUTO verdict columns (isVehicle/isPersonal/hasPerson) MAY be reset on a rule
            // change (see v2). ownerVerdict MUST NEVER be blanket-reset — it is owner-proven
            // and unrecoverable; it sits at the top of the trust hierarchy.
            try db.alter(table: "appearance") { t in t.add(column: "ownerVerdict", .text) }
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
        let analyzedAt: Date? = appleMLLabels == nil ? nil : now
        do {
            try dbQueue.write { db in
                if let phashHex {
                    try LocalImageIdentity(phashHex: phashHex, contentSha256: nil, firstSeenAt: now)
                        .insert(db, onConflict: .ignore)
                }
                // ⚠️ NEVER `LocalAppearance(...).insert(onConflict: .replace)` here — REPLACE is
                // delete+reinsert and the struct omits the verdict columns, so it would NULL
                // isVehicle/isPersonal/hasPerson/ownerVerdict that classify()/setOwnerVerdict()
                // own (and ownerVerdict is owner-PROVEN — unrecoverable). ingest() writes ONLY
                // its own EXIF/identity columns, COALESCE so a nil arg never wipes a prior value.
                try db.execute(sql: """
                    INSERT INTO appearance (localIdentifier, phashHex, sourceType, takenAt, latitude, longitude, cameraMake, cameraModel, appleMLLabelsJSON, analyzedAt, createdAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(localIdentifier) DO UPDATE SET
                        phashHex          = COALESCE(excluded.phashHex, appearance.phashHex),
                        takenAt           = COALESCE(excluded.takenAt, appearance.takenAt),
                        latitude          = COALESCE(excluded.latitude, appearance.latitude),
                        longitude         = COALESCE(excluded.longitude, appearance.longitude),
                        cameraMake        = COALESCE(excluded.cameraMake, appearance.cameraMake),
                        cameraModel       = COALESCE(excluded.cameraModel, appearance.cameraModel),
                        appleMLLabelsJSON = COALESCE(excluded.appleMLLabelsJSON, appearance.appleMLLabelsJSON),
                        analyzedAt        = COALESCE(excluded.analyzedAt, appearance.analyzedAt)
                    """, arguments: [localIdentifier, phashHex, sourceType, takenAt, latitude, longitude,
                                     cameraMake, cameraModel, labelsJSON, analyzedAt, now])
                if let phashHex {
                    // Same discipline: fill, never wipe (a later call may add vehicleId/sessionDate).
                    try db.execute(sql: """
                        INSERT INTO vehicle_image (phashHex, localIdentifier, vehicleId, sessionDate)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(phashHex) DO UPDATE SET
                            localIdentifier = COALESCE(excluded.localIdentifier, vehicle_image.localIdentifier),
                            vehicleId       = COALESCE(excluded.vehicleId, vehicle_image.vehicleId),
                            sessionDate     = COALESCE(excluded.sessionDate, vehicle_image.sessionDate)
                        """, arguments: [phashHex, localIdentifier, vehicleId, sessionDate])
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

    /// Day rollup for the receipt window — per day (newest first): total dated photos,
    /// how many carry a T0 verdict, and how many read as vehicle/work. Counts only real
    /// classified rows (SUM(CASE …)); a day no one has sorted reports classified = 0, so
    /// the UI can stay silent rather than imply "0 vehicle". Reads local only.
    ///
    /// `takenAt` is stored UTC, so we bucket with the `'localtime'` modifier → the day
    /// in the DEVICE's current zone (an evening shot no longer rolls to the next UTC
    /// day). localIdentifiers(onDay:) uses the IDENTICAL expression so the drill opens
    /// exactly what the receipt counted. (Cross-timezone travel still buckets by the
    /// current device zone — acceptable; the alternative needs the per-photo EXIF offset.)
    func dayCounts() -> [DayRollup] {
        var out: [DayRollup] = []
        do {
            try dbQueue.read { db in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT strftime('%Y-%m-%d', takenAt, 'localtime') AS day,
                           COUNT(*) AS n,
                           SUM(CASE WHEN isVehicle IS NOT NULL THEN 1 ELSE 0 END) AS classified,
                           SUM(CASE WHEN isVehicle = 1 THEN 1 ELSE 0 END) AS vehicles
                    FROM appearance WHERE takenAt IS NOT NULL
                    GROUP BY day ORDER BY day DESC
                    """)
                out = rows.map {
                    DayRollup(day: $0["day"] as String? ?? "—",
                              count: ($0["n"] as Int?) ?? 0,
                              classified: ($0["classified"] as Int?) ?? 0,
                              vehicles: ($0["vehicles"] as Int?) ?? 0)
                }
            }
        } catch {
            NSLog("LocalStore.dayCounts failed: %@", String(describing: error))
        }
        return out
    }

    /// The local identifiers shot on one day (newest-first), for the day-receipt
    /// drill. Uses the IDENTICAL `strftime('%Y-%m-%d', takenAt, 'localtime')` key as
    /// dayCounts() so the day a row counts under is the day it opens under. Local read.
    func localIdentifiers(onDay ymd: String) -> [String] {
        var out: [String] = []
        do {
            try dbQueue.read { db in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT localIdentifier AS lid FROM appearance
                    WHERE takenAt IS NOT NULL AND strftime('%Y-%m-%d', takenAt, 'localtime') = ?
                    ORDER BY takenAt DESC
                    """, arguments: [ymd])
                for r in rows { let lid: String = r["lid"]; out.append(lid) }
            }
        } catch { NSLog("LocalStore.localIdentifiers(onDay:) failed: %@", String(describing: error)) }
        return out
    }

    /// Which of these already carry a real EXIF `takenAt` — so the ingest pass can
    /// skip the heavy original-data load on a re-run. Pure local read. Chunked so a
    /// whole-library batch never blows SQLITE_MAX_VARIABLE_NUMBER.
    func identifiersWithTakenAt(in localIdentifiers: [String]) -> Set<String> {
        guard !localIdentifiers.isEmpty else { return [] }
        var out: Set<String> = []
        do {
            try dbQueue.read { db in
                for chunk in localIdentifiers.chunked(900) {
                    let rows = try Row.fetchAll(db, sql: """
                        SELECT localIdentifier AS lid FROM appearance
                        WHERE takenAt IS NOT NULL AND localIdentifier IN (\(databaseQuestionMarks(count: chunk.count)))
                        """, arguments: StatementArguments(chunk))
                    for r in rows { let lid: String = r["lid"]; out.insert(lid) }
                }
            }
        } catch { NSLog("LocalStore.identifiersWithTakenAt failed: %@", String(describing: error)) }
        return out
    }

    /// Which of these are FULLY processed — true EXIF day AND a content phash AND a T0
    /// verdict — so the deep backfill walk can skip them. A row missing any of the three
    /// is reprocessed (the disjoint writers fill only the missing column). Chunked.
    func identifiersFullyProcessed(in localIdentifiers: [String]) -> Set<String> {
        guard !localIdentifiers.isEmpty else { return [] }
        var out: Set<String> = []
        do {
            try dbQueue.read { db in
                for chunk in localIdentifiers.chunked(900) {
                    let rows = try Row.fetchAll(db, sql: """
                        SELECT localIdentifier AS lid FROM appearance
                        WHERE takenAt IS NOT NULL AND phashHex IS NOT NULL AND isVehicle IS NOT NULL
                          AND localIdentifier IN (\(databaseQuestionMarks(count: chunk.count)))
                        """, arguments: StatementArguments(chunk))
                    for r in rows { let lid: String = r["lid"]; out.insert(lid) }
                }
            }
        } catch { NSLog("LocalStore.identifiersFullyProcessed failed: %@", String(describing: error)) }
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

    // MARK: Owner verdict — the Select tool (explicit Approve/Reject, overrides auto)

    /// Set the owner's explicit verdict for a batch (upserts even un-classified rows).
    func setOwnerVerdict(_ localIdentifiers: [String], verdict: String?, now: Date = Date()) {
        guard !localIdentifiers.isEmpty else { return }
        do {
            try dbQueue.write { db in
                for lid in localIdentifiers {
                    try db.execute(sql: """
                        INSERT INTO appearance (localIdentifier, sourceType, ownerVerdict, createdAt)
                        VALUES (?, 'local_filesystem', ?, ?)
                        ON CONFLICT(localIdentifier) DO UPDATE SET ownerVerdict = excluded.ownerVerdict
                        """, arguments: [lid, verdict, now])
                }
            }
        } catch { NSLog("LocalStore.setOwnerVerdict failed: %@", String(describing: error)) }
    }

    /// Owner verdicts for a batch: lid -> true (approved) / false (rejected).
    func ownerVerdicts(for localIdentifiers: [String]) -> [String: Bool] {
        guard !localIdentifiers.isEmpty else { return [:] }
        var out: [String: Bool] = [:]
        do {
            try dbQueue.read { db in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT localIdentifier AS lid, ownerVerdict AS ov FROM appearance
                    WHERE ownerVerdict IS NOT NULL AND localIdentifier IN (\(databaseQuestionMarks(count: localIdentifiers.count)))
                    """, arguments: StatementArguments(localIdentifiers))
                for r in rows {
                    let lid: String = r["lid"]
                    let ov: String? = r["ov"]
                    if let ov { out[lid] = (ov == "approved") }
                }
            }
        } catch { NSLog("LocalStore.ownerVerdicts failed: %@", String(describing: error)) }
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

private extension Array {
    /// Split into sub-arrays of at most `size` — keeps `IN (?,…)` parameter lists
    /// under SQLite's variable limit when querying a whole-library batch.
    func chunked(_ size: Int) -> [[Element]] {
        guard size > 0, count > size else { return [self] }
        return stride(from: 0, to: count, by: size).map { Array(self[$0 ..< Swift.min($0 + size, count)]) }
    }
}
