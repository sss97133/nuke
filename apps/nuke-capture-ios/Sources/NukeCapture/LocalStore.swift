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
import CryptoKit
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
    let read: Int            // rows with a cached cloud BYOK verdict ("Read by Nuke")
}

/// One day's receipt — the day-level synthesis the drill renders ABOVE its photos.
/// Everything here is computed from LocalStore rows only (network-off by design):
/// the measured layer (EXIF times → span/bursts, GPS → located count) is fact from
/// the files; the read layer (intents, labor minutes, agent vehicle) exists only
/// where cloud verdicts were cached down — absent stays absent.
struct LocalDayReceipt {
    let day: String                 // 'yyyy-MM-dd' (device-zone bucket, same key as DayRollup)
    let count: Int                  // dated frames this day
    let classified: Int             // rows with a T0 verdict
    let vehicles: Int               // T0 vehicle/work rows
    let read: Int                   // rows with a cached cloud BYOK verdict
    let firstShot: Date?            // EXIF takenAt of the day's first/last frame
    let lastShot: Date?
    let bursts: Int                 // shoot clusters (>45 min gap splits), all frames
    let laborFrames: Int            // cached verdicts: intent='labor', confidence ≥ 0.6
    let laborMinutes: Int?          // web-formula estimate over labor frames; nil when none
    let intents: [(String, Int)]    // cached intent counts, desc
    let agentVehicleId: String?     // modal cloudVehicleId — the agent's read, NOT a binding
    let agentVehicleFrames: Int
    let locatedCount: Int           // frames carrying GPS
    let medianLat: Double?
    let medianLon: Double?
}

/// One row of the offline garage mirror. Mirrors prod `get_user_garage` exactly
/// (same field set as ProfileTab's `GarageVehicle`) so the cache can round-trip
/// straight into that view model with no lossy translation.
struct LocalGarageVehicle: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "garage_vehicle"
    var userId: String              // the profile this row belongs to (own or another's)
    var vehicleId: String
    var year: Int?
    var make: String?
    var model: String?
    var trimName: String?
    var imageUrl: String?
    var currentValue: Double?
    var imageCount: Int
    var relationship: String
    var cachedAt: Date              // when WE last pulled this row down
    var vin: String?
    var relationshipEvidenceJSON: String?

    var projection: GarageVehicle {
        if let json = relationshipEvidenceJSON,
           let row = try? JSONDecoder().decode(GarageVehicle.self, from: Data(json.utf8)) { return row }
        return GarageVehicle(vehicle_id: vehicleId, year: year, make: make, model: model,
            trim_name: trimName, image_url: imageUrl, current_value: currentValue,
            image_count: imageCount, relationship: relationship, vin: vin)
    }
}

/// Shared transport and offline projection. An account statement is a separate
/// dimension from physical identity, title verification and authorization.
struct GarageRelationshipStatement: Codable, Hashable, Sendable {
    let roles: [String]
    let ownership_denied: Bool
    let title_status: String
    let disputed: Bool
    let start_date: String?
    let end_date: String?
}

struct GarageOwnerCorrection: Decodable, Sendable {
    struct Correction: Decodable, Sendable {
        let relationship: GarageRelationshipStatement?
        let cover_image_id: String?
    }
    let id: String
    let vehicle_id: String
    let correction: Correction
    let observed_at: String
    let cover_image_url: String?
}

struct GarageVehicle: Codable, Identifiable, Hashable, Sendable {
    let vehicle_id: String
    let year: Int?
    let make: String?
    var model: String?
    let trim_name: String?
    var image_url: String?
    let current_value: Double?
    let image_count: Int
    var relationship: String
    var vin: String? = nil
    var relationshipStatement: GarageRelationshipStatement? = nil
    var statementConflict: Bool? = nil
    var relationshipEvidenceIds: [String]? = nil
    var relationshipObservedAt: String? = nil

    var id: String { vehicle_id }
    var title: String {
        [year.map(String.init), make, model, trim_name].compactMap { $0 }
            .filter { !$0.isEmpty }.joined(separator: " ")
    }
    var relationshipLabel: String {
        switch relationship {
        case "owner": return "Owned"
        case "previously_owned": return "Previously owned"
        case "consignment": return "Consignment"
        case "business_handling": return "Business handling"
        case "sales_representative": return "Sales representative"
        case "claimed_interest": return "Claimed interest"
        case "shared_interest": return "Shared interest"
        case "transfer_pending": return "Transfer pending"
        case "relationship_review": return "Relationship review"
        default: return relationship.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
    var relationshipDetail: String? {
        if statementConflict == true { return "Conflicting account statements" }
        guard let r = relationshipStatement else { return nil }
        let pieces = [r.ownership_denied ? "Personal ownership rejected" : nil,
            r.disputed ? "Disputed interest" : nil,
            r.title_status == "not_in_name" ? "Title not in your name" : nil,
            r.title_status == "transfer_pending" ? "Title transfer pending" : nil]
            .compactMap { $0 }
        let roles = r.roles.map { $0.replacingOccurrences(of: "_", with: " ") }.joined(separator: ", ")
        return ([pieces.isEmpty ? "Account stated" : pieces.joined(separator: " · "),
            roles.isEmpty ? nil : roles].compactMap { $0 }).joined(separator: " · ")
    }
    var relationshipPeriod: String? {
        guard let r = relationshipStatement else { return nil }
        let end = r.end_date ?? (r.roles.contains("owner_past") ? "End unknown" : "End unspecified")
        return "\(r.start_date ?? "Start unknown") → \(end)"
    }

    static func applying(_ corrections: [GarageOwnerCorrection], to vehicles: [GarageVehicle],
                         today: String = String(ISO8601DateFormatter().string(from: Date()).prefix(10))) -> [GarageVehicle] {
        let groups = Dictionary(grouping: corrections, by: \.vehicle_id)
        return vehicles.map { vehicle in
            var result = vehicle
            let rows = groups[vehicle.id] ?? []
            if !rows.isEmpty { result.relationshipEvidenceIds = rows.map(\.id).sorted() }
            let covers = rows.filter { $0.correction.cover_image_id != nil }
            if !covers.isEmpty { result.image_url = covers.count == 1 ? covers[0].cover_image_url : nil }
            let relationships = rows.compactMap { $0.correction.relationship }
            if relationships.count > 1 {
                result.relationship = "relationship_review"
                result.relationshipStatement = nil; result.statementConflict = true
                result.relationshipObservedAt = nil
            } else if let r = relationships.first {
                result.relationshipStatement = r; result.statementConflict = false
                result.relationshipObservedAt = rows.first { $0.correction.relationship != nil }?.observed_at
                let roles = r.roles.filter { ["owner_current", "owner_past", "shared_interest", "claimed_interest",
                    "consignment", "business_handling", "sales_representative", "transfer_pending"].contains($0) }
                switch roles.first {
                case "owner_current": result.relationship = "owner"
                case "owner_past": result.relationship = "previously_owned"
                case let role?: result.relationship = role
                default: result.relationship = "relationship_review"
                }
                if r.ownership_denied && roles.contains(where: { $0 == "owner_current" || $0 == "owner_past" }) {
                    result.relationship = "relationship_review"
                }
                if result.relationship == "owner" && (r.disputed || r.title_status == "transfer_pending" ||
                    (r.start_date.map { $0 > today } ?? false)) { result.relationship = "claimed_interest" }
            }
            return result
        }
    }
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
    // The file's TRUE capture time (EXIF DateTimeOriginal) — the only trusted date
    // (HARD_RULES §7). nil until ingest() has run for this photo; the info sheet falls
    // back to PHAsset.creationDate ONLY tagged "(device, unverified)".
    var takenAt: Date? = nil
    // The cloud BYOK verdict, cached from prod (nil until pulled down). Rendered as the
    // rich "what the agent read" layer over the cheap on-device T0 labels.
    var cloudNarrative: String? = nil
    var cloudIntent: String? = nil
    var cloudScene: String? = nil
    var cloudConfidence: Double? = nil
    var cloudBuildPhase: String? = nil
    var cloudAgentModel: String? = nil
    var cloudAnalyzedAt: Date? = nil
}

/// PhotoKit's grouping, retained independently of any vehicle assignment. IDs are
/// local to this library; overlapping albums keep their own memberships and names.
struct LocalAlbumPhoto: Codable, Equatable, Sendable {
    let localIdentifier: String
    let sourceVersion: String?
}

struct LocalPhotoAlbum: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String?
    let folderPath: [String]
    let sourceKind: String
    let photos: [LocalAlbumPhoto]
}

struct LocalAlbumCatalog: Codable, Sendable {
    let accessScope: String
    let observedAt: Date
    let albums: [LocalPhotoAlbum]
    let photos: [LocalAlbumPhoto]?

    init(accessScope: String, observedAt: Date, albums: [LocalPhotoAlbum], photos: [LocalAlbumPhoto]? = nil) {
        self.accessScope = accessScope; self.observedAt = observedAt
        self.albums = albums; self.photos = photos
    }
}

/// An independent, versioned read of the original bytes. VIN-shaped OCR text is
/// evidence to review, never a canonical vehicle, ownership or performed-work claim.
struct LocalAlbumImageReview: Codable, FetchableRecord, PersistableRecord, Sendable {
    static let databaseTableName = "photo_album_image_review"
    let id: String
    let localIdentifier: String
    let sourceVersion: String?
    let inputSHA256: String
    let methodVersion: String
    let analyzedAt: Date
    let isVehicle: Bool
    let hasPerson: Bool
    let labelsJSON: String
    let vinCandidatesJSON: String
    let textLinesJSON: String

    var vinCandidates: [String] {
        (try? JSONDecoder().decode([String].self, from: Data(vinCandidatesJSON.utf8))) ?? []
    }

    var textLines: [String] {
        (try? JSONDecoder().decode([String].self, from: Data(textLinesJSON.utf8))) ?? []
    }
}

struct LocalAlbumCoverage: Sendable {
    let total: Int
    let reviewed: Int
    let vehicleFrames: Int
    let otherFrames: Int
    let vinReadings: [String]
    let cachedDeepReads: Int
}

/// Cloud intake transports the observed grouping separately from byte witnesses.
/// The source JSON is stable across retries; no labels, OCR or pixels are exported.
struct NativeAlbumCaptureRequest: Sendable {
    let userId: String
    let catalogRowId: Int64
    let albumId: String
    let requestId: String
    let payloadJSON: String
    let photos: [LocalAlbumPhoto]
}

struct NativeAlbumByteWitness: Encodable, Sendable {
    let local_id: String
    let source_version: String
    let input_sha256: String
    let method_version: String
    let read_id: String
}

struct NativeAlbumLinkBatch: Sendable {
    let capture: NativeAlbumCaptureRequest
    let witnesses: [NativeAlbumByteWitness]
    let lastReadRowId: Int64
}

/// Derived solely from the retained source snapshot and independent current
/// reads. Serial matches are candidates; an album never binds all its members.
struct LocalProfilePhotoEvidence: Sendable {
    let photo: LocalAlbumPhoto
    let review: LocalAlbumImageReview?
    let candidateVehicleIds: [String]
    let takenAt: Date?
}

struct LocalProfileEvidence: Sendable {
    let catalog: LocalAlbumCatalog
    let photos: [LocalProfilePhotoEvidence]
    let vehicles: [GarageVehicle]
    var reviewed: Int { photos.filter { $0.review != nil }.count }
    var vehicleFrames: Int { photos.filter { $0.review?.isVehicle == true }.count }
    var matched: Int { photos.filter { $0.candidateVehicleIds.count == 1 }.count }
    var conflicted: Int { photos.filter { $0.candidateVehicleIds.count > 1 }.count }
    var unresolved: Int { photos.filter { $0.review?.isVehicle == true && $0.candidateVehicleIds.isEmpty }.count }
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

    /// Isolated stores exercise the real migrations and readers without an account
    /// or a network connection (also useful for a device-local recovery).
    init(databaseQueue: DatabaseQueue) throws {
        dbQueue = databaseQueue
        try Self.migrator.migrate(databaseQueue)
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
        m.registerMigration("v4_cloud_verdict") { db in
            // The CLOUD BYOK deep-analysis verdict, ESCALATED DOWN and cached on-device
            // (data-scope axis: global cloud → local instance). Joined by the exact uuid
            // bridge (appearance.localIdentifier == vehicle_images.exif_data.uuid). Caching
            // it here is what lets the rich analysis render with the network OFF — the
            // analysis ALREADY done in prod just arrives on the photo; nothing re-computes.
            // A FOURTH disjoint writer (cacheCloudVerdict) owns these columns ONLY; it never
            // touches EXIF (ingest), T0 (classify), or the owner verdict.
            try db.alter(table: "appearance") { t in
                t.add(column: "cloudNarrative", .text)
                t.add(column: "cloudIntent", .text)
                t.add(column: "cloudScene", .text)
                t.add(column: "cloudConfidence", .double)
                t.add(column: "cloudBuildPhase", .text)
                t.add(column: "cloudVehicleId", .text)   // cached, NOT a binding — never render as "Vehicle" without the confirmed-membership gate (HARD_RULES §10)
                t.add(column: "cloudAgentModel", .text)
                t.add(column: "cloudAnalyzedAt", .datetime)
                t.add(column: "cloudCachedAt", .datetime)   // when WE last pulled it down
            }
        }
        m.registerMigration("v5_garage_cache") { db in
            // Offline mirror of get_user_garage — "my garage" on airplane mode.
            // Unlike `appearance` (many disjoint writers sharing one row), this
            // table has exactly ONE writer (cacheGarage), and each successful
            // live call is the COMPLETE, current list for that user — a vehicle
            // that drops out of the response (sold, re-attributed away) must not
            // linger as a ghost row here. So the writer clears-and-replaces the
            // user's rows in one transaction, not an UPSERT of individual columns.
            // This does not conflict with the SUPERSEDE-never-overwrite rule
            // above: that rule protects shared rows across independent writers;
            // here there is only one writer and one source of truth per read.
            try db.create(table: "garage_vehicle") { t in
                t.column("userId", .text).notNull()
                t.column("vehicleId", .text).notNull()
                t.column("year", .integer)
                t.column("make", .text)
                t.column("model", .text)
                t.column("trimName", .text)
                t.column("imageUrl", .text)
                t.column("currentValue", .double)
                t.column("imageCount", .integer).notNull()
                t.column("relationship", .text).notNull()
                t.column("cachedAt", .datetime).notNull()
                t.primaryKey(["userId", "vehicleId"])
            }
        }
        m.registerMigration("v6_photo_album_passes") { db in
            // Human/source grouping and agent reads have different grains and writers.
            // Both logs append; neither can overwrite a prior grouping or owner verdict.
            try db.create(table: "photo_album_catalog") { t in
                t.column("id", .text).primaryKey()
                t.column("digest", .text).notNull()
                t.column("payload", .text).notNull()
                t.column("observedAt", .datetime).notNull()
            }
            try db.create(table: "photo_album_image_review") { t in
                t.column("id", .text).primaryKey()
                t.column("localIdentifier", .text).notNull()
                t.column("sourceVersion", .text)
                t.column("inputSHA256", .text).notNull()
                t.column("methodVersion", .text).notNull()
                t.column("analyzedAt", .datetime).notNull()
                t.column("isVehicle", .boolean).notNull()
                t.column("hasPerson", .boolean).notNull()
                t.column("labelsJSON", .text).notNull()
                t.column("vinCandidatesJSON", .text).notNull()
                t.column("textLinesJSON", .text).notNull()
            }
            try db.create(index: "photo_album_image_review_source", on: "photo_album_image_review",
                          columns: ["localIdentifier", "sourceVersion", "methodVersion"])
        }
        m.registerMigration("v7_profile_relationship_evidence") { db in
            try db.alter(table: "garage_vehicle") { t in
                t.add(column: "vin", .text)
                t.add(column: "relationshipEvidenceJSON", .text)
            }
        }
        m.registerMigration("v8_native_album_sync_receipts") { db in
            try db.create(table: "native_album_installation") { t in t.column("id", .text).primaryKey() }
            try db.execute(sql: "INSERT INTO native_album_installation(id) VALUES (?)", arguments: [UUID().uuidString])
            try db.create(table: "native_album_account_cursor") { t in
                t.column("userId", .text).primaryKey()
                t.column("catalogRowId", .integer).notNull()
            }
            try db.create(table: "native_album_sync_receipt") { t in
                t.column("userId", .text).notNull()
                t.column("albumId", .text).notNull()
                t.column("catalogRowId", .integer).notNull()
                t.column("captureId", .text).notNull()
                t.column("setId", .text).notNull()
                t.column("payloadJSON", .text).notNull()
                t.column("readAfterRowId", .integer).notNull().defaults(to: 0)
                t.column("linkAttemptAt", .datetime)
                t.primaryKey(["userId", "albumId"])
            }
        }
        return m
    }

    // MARK: Album human pass and independent on-device pass

    /// Append only when the visible source state changes. Reappearing older states
    /// get a new event, so A → B → A never leaves B as the current catalog.
    func recordAlbumCatalog(_ catalog: LocalAlbumCatalog) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        struct State: Encodable { let accessScope: String; let albums: [LocalPhotoAlbum]; let photos: [LocalAlbumPhoto]? }
        let state = try encoder.encode(State(accessScope: catalog.accessScope, albums: catalog.albums, photos: catalog.photos))
        let digest = Self.albumDigest(state)
        let payload = String(decoding: try encoder.encode(catalog), as: UTF8.self)
        try dbQueue.write { db in
            let last = try String.fetchOne(db, sql: "SELECT digest FROM photo_album_catalog ORDER BY rowid DESC LIMIT 1")
            guard last != digest else { return }
            try db.execute(sql: "INSERT INTO photo_album_catalog (id, digest, payload, observedAt) VALUES (?, ?, ?, ?)",
                           arguments: [UUID().uuidString, digest, payload, catalog.observedAt])
        }
    }

    func latestAlbumCatalog() throws -> LocalAlbumCatalog? {
        try dbQueue.read { db in
            guard let payload = try String.fetchOne(db, sql: "SELECT payload FROM photo_album_catalog ORDER BY rowid DESC LIMIT 1") else { return nil }
            return try JSONDecoder().decode(LocalAlbumCatalog.self, from: Data(payload.utf8))
        }
    }

    /// Begin a new account at the currently visible source state. Subsequent
    /// offline catalog events drain in order; another account's old history is
    /// not automatically exported. Limited access never deletes known albums.
    func nextNativeAlbumCapture(userId: String) throws -> NativeAlbumCaptureRequest? {
        try dbQueue.write { db in
            guard let latest = try Int64.fetchOne(db, sql: "SELECT rowid FROM photo_album_catalog ORDER BY rowid DESC LIMIT 1"),
                  let installation = try String.fetchOne(db, sql: "SELECT id FROM native_album_installation LIMIT 1") else { return nil }
            try db.execute(sql: "INSERT OR IGNORE INTO native_album_account_cursor(userId,catalogRowId) VALUES (?,?)",
                           arguments: [userId, latest - 1])
            for _ in 0..<32 {
                let after = try Int64.fetchOne(db, sql: "SELECT catalogRowId FROM native_album_account_cursor WHERE userId=?", arguments: [userId]) ?? 0
                guard let row = try Row.fetchOne(db, sql: "SELECT rowid,id,payload FROM photo_album_catalog WHERE rowid>? ORDER BY rowid LIMIT 1", arguments: [after]) else { return nil }
                let rowId: Int64 = row["rowid"], catalogId: String = row["id"], payload: String = row["payload"]
                let catalog = try JSONDecoder().decode(LocalAlbumCatalog.self, from: Data(payload.utf8))
                if catalog.accessScope == "full" {
                    let albums = catalog.albums
                    let known = try Row.fetchAll(db, sql: "SELECT * FROM native_album_sync_receipt WHERE userId=?", arguments: [userId])
                    let byId = Dictionary(known.map { ($0["albumId"] as String, $0) }, uniquingKeysWith: { first, _ in first })
                    let visible = Set(albums.map(\.id))
                    var states: [(LocalPhotoAlbum, Bool)] = albums.map { ($0, true) }
                    for old in known where !visible.contains(old["albumId"]) {
                        let previous = try Self.nativeCapture(from: old, userId: userId)
                        let source = try Self.nativeSourceJSON(previous.payloadJSON)
                        states.append((LocalPhotoAlbum(id: previous.albumId, name: source["name"] as? String,
                            folderPath: source["folder_path"] as? [String] ?? [], sourceKind: source["source_kind"] as? String ?? "unknown", photos: []), false))
                    }
                    for (album, present) in states.sorted(by: { $0.0.id < $1.0.id }) {
                        let source: [String: Any] = ["local_id": album.id, "name": album.name as Any? ?? NSNull(),
                            "folder_path": album.folderPath, "source_kind": album.sourceKind, "present": present,
                            "photos": album.photos.map { ["local_id": $0.localIdentifier, "source_version": $0.sourceVersion as Any? ?? NSNull()] }]
                        let prior = byId[album.id]
                        if let prior {
                            let oldJSON: String = prior["payloadJSON"]
                            if try Self.nativeJSON(Self.nativeSourceJSON(oldJSON)) == Self.nativeJSON(source) { continue }
                        }
                        let requestId = Self.nativeRequestId(userId + ":" + catalogId + ":" + album.id)
                        let previous: String? = prior?["captureId"]
                        let date = ISO8601DateFormatter(); date.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                        let json: [String: Any] = ["contract": "photokit_album_v1", "request_id": requestId,
                            "previous_capture_id": previous as Any? ?? NSNull(), "installation_id": installation,
                            "observed_at": date.string(from: catalog.observedAt), "access_scope": "full", "album": source]
                        return NativeAlbumCaptureRequest(userId: userId, catalogRowId: rowId, albumId: album.id,
                            requestId: requestId, payloadJSON: try Self.nativeJSON(json), photos: album.photos)
                    }
                }
                try db.execute(sql: "UPDATE native_album_account_cursor SET catalogRowId=? WHERE userId=?", arguments: [rowId, userId])
            }
            return nil
        }
    }

    func acknowledgeNativeAlbumCapture(_ request: NativeAlbumCaptureRequest, setId: String, captureId: String) throws {
        guard captureId.lowercased() == request.requestId.lowercased() else { throw CocoaError(.coderInvalidValue) }
        try dbQueue.write { db in
            try db.execute(sql: """
                INSERT INTO native_album_sync_receipt(userId,albumId,catalogRowId,captureId,setId,payloadJSON,readAfterRowId)
                VALUES (?,?,?,?,?,?,0) ON CONFLICT(userId,albumId) DO UPDATE SET
                catalogRowId=excluded.catalogRowId,captureId=excluded.captureId,setId=excluded.setId,
                payloadJSON=excluded.payloadJSON,readAfterRowId=0,linkAttemptAt=NULL
                """, arguments: [request.userId, request.albumId, request.catalogRowId, captureId, setId, request.payloadJSON])
        }
    }

    /// Rotate source groups and current original reads in bounded batches. Pending
    /// uploads are retried after the tail wraps; failed network calls never advance.
    func nextNativeAlbumLinks(userId: String, methodVersion: String, limit: Int = 200) throws -> NativeAlbumLinkBatch? {
        try dbQueue.write { db in
            let receipts = try Row.fetchAll(db, sql: "SELECT * FROM native_album_sync_receipt WHERE userId=? ORDER BY linkAttemptAt,albumId", arguments: [userId])
            for receipt in receipts {
                let capture = try Self.nativeCapture(from: receipt, userId: userId)
                let photos = Dictionary(capture.photos.map { ($0.localIdentifier, $0) }, uniquingKeysWith: { first, _ in first })
                var after: Int64 = receipt["readAfterRowId"]
                var witnesses: [NativeAlbumByteWitness] = []
                var last = after
                let rows = try Row.fetchAll(db, sql: "SELECT rowid,* FROM photo_album_image_review WHERE rowid>? AND methodVersion=? ORDER BY rowid LIMIT 1000", arguments: [after, methodVersion])
                for row in rows {
                    last = row["rowid"]
                    let review = try LocalAlbumImageReview(row: row)
                    guard review.isVehicle, !review.hasPerson, let version = review.sourceVersion,
                          photos[review.localIdentifier]?.sourceVersion == version else { continue }
                    let verdict = try String.fetchOne(db, sql: "SELECT ownerVerdict FROM appearance WHERE localIdentifier=?", arguments: [review.localIdentifier])
                    guard verdict != "rejected", verdict != "personal" else { continue }
                    witnesses.append(NativeAlbumByteWitness(local_id: review.localIdentifier, source_version: version,
                        input_sha256: review.inputSHA256, method_version: review.methodVersion, read_id: review.id))
                    if witnesses.count >= min(200, max(1, limit)) { break }
                }
                if !witnesses.isEmpty { return NativeAlbumLinkBatch(capture: capture, witnesses: witnesses, lastReadRowId: last) }
                if rows.isEmpty { after = 0 } else { after = last }
                try db.execute(sql: "UPDATE native_album_sync_receipt SET readAfterRowId=?,linkAttemptAt=? WHERE userId=? AND albumId=?",
                               arguments: [after, Date(), userId, capture.albumId])
            }
            return nil
        }
    }

    func acknowledgeNativeAlbumLinks(_ batch: NativeAlbumLinkBatch) throws {
        try dbQueue.write { db in
            try db.execute(sql: "UPDATE native_album_sync_receipt SET readAfterRowId=?,linkAttemptAt=? WHERE userId=? AND albumId=? AND captureId=?",
                arguments: [batch.lastReadRowId, Date(), batch.capture.userId, batch.capture.albumId, batch.capture.requestId])
        }
    }

    private static func nativeCapture(from row: Row, userId: String) throws -> NativeAlbumCaptureRequest {
        let payload: String = row["payloadJSON"]
        let source = try nativeSourceJSON(payload)
        let photos = (source["photos"] as? [[String: Any]] ?? []).compactMap { p -> LocalAlbumPhoto? in
            guard let id = p["local_id"] as? String else { return nil }
            return LocalAlbumPhoto(localIdentifier: id, sourceVersion: p["source_version"] as? String)
        }
        return NativeAlbumCaptureRequest(userId: userId, catalogRowId: row["catalogRowId"], albumId: row["albumId"],
            requestId: row["captureId"], payloadJSON: payload, photos: photos)
    }

    private static func nativeJSON(_ object: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
    }

    private static func nativeSourceJSON(_ payload: String) throws -> [String: Any] {
        guard let json = try JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any],
              let source = json["album"] as? [String: Any] else { throw CocoaError(.coderReadCorrupt) }
        return source
    }

    private static func nativeRequestId(_ seed: String) -> String {
        let hex = albumDigest(Data(seed.utf8))
        return "\(hex.prefix(8))-\(hex.dropFirst(8).prefix(4))-\(hex.dropFirst(12).prefix(4))-\(hex.dropFirst(16).prefix(4))-\(hex.dropFirst(20).prefix(12))"
    }

    func recordAlbumImageReview(_ review: LocalAlbumImageReview) throws {
        try dbQueue.write { db in try review.insert(db, onConflict: .ignore) }
    }

    /// Unknown source versions must be reread; a previous result cannot establish
    /// that the current bytes are unchanged. A method change also invalidates reuse.
    func albumImageReview(for photo: LocalAlbumPhoto, methodVersion: String) throws -> LocalAlbumImageReview? {
        guard let version = photo.sourceVersion else { return nil }
        return try dbQueue.read { db in
            try LocalAlbumImageReview.fetchOne(db, sql: """
                SELECT * FROM photo_album_image_review
                WHERE localIdentifier = ? AND sourceVersion = ? AND methodVersion = ?
                ORDER BY rowid DESC LIMIT 1
                """, arguments: [photo.localIdentifier, version, methodVersion])
        }
    }

    func albumCoverage(_ album: LocalPhotoAlbum, methodVersion: String) throws -> LocalAlbumCoverage {
        let photos = Dictionary(album.photos.map { ($0.localIdentifier, $0) }, uniquingKeysWith: { first, _ in first })
        return try dbQueue.read { db in
            var current: [String: LocalAlbumImageReview] = [:]
            var deepReads = 0
            for chunk in Array(photos.keys).chunked(400) where !chunk.isEmpty {
                let rows = try LocalAlbumImageReview.fetchAll(db, sql: """
                    SELECT * FROM photo_album_image_review
                    WHERE methodVersion = ? AND localIdentifier IN (\(databaseQuestionMarks(count: chunk.count)))
                    ORDER BY rowid
                    """, arguments: StatementArguments([methodVersion] + chunk))
                for row in rows where row.sourceVersion != nil && row.sourceVersion == photos[row.localIdentifier]?.sourceVersion {
                    current[row.localIdentifier] = row
                }
                deepReads += try Int.fetchOne(db, sql: """
                    SELECT COUNT(*) FROM appearance
                    WHERE cloudNarrative IS NOT NULL AND localIdentifier IN (\(databaseQuestionMarks(count: chunk.count)))
                    """, arguments: StatementArguments(chunk)) ?? 0
            }
            return LocalAlbumCoverage(total: photos.count, reviewed: current.count,
                vehicleFrames: current.values.filter(\.isVehicle).count,
                otherFrames: current.values.filter { !$0.isVehicle }.count,
                vinReadings: Array(Set(current.values.flatMap(\.vinCandidates))).sorted(), cachedDeepReads: deepReads)
        }
    }

    func profileEvidence(userId: String, methodVersion: String) throws -> LocalProfileEvidence? {
        guard let catalog = try latestAlbumCatalog() else { return nil }
        let source = catalog.photos ?? catalog.albums.flatMap(\.photos)
        let photos = Dictionary(source.map { ($0.localIdentifier, $0) }, uniquingKeysWith: { first, _ in first })
        let known = cachedGarage(userId: userId)?.vehicles.map(\.projection) ?? []
        return try dbQueue.read { db in
            var reviews: [String: LocalAlbumImageReview] = [:]
            var clocks: [String: Date] = [:]
            for chunk in Array(photos.keys).chunked(400) where !chunk.isEmpty {
                for row in try LocalAlbumImageReview.fetchAll(db, sql: """
                    SELECT * FROM photo_album_image_review
                    WHERE methodVersion = ? AND localIdentifier IN (\(databaseQuestionMarks(count: chunk.count)))
                    ORDER BY rowid
                    """, arguments: StatementArguments([methodVersion] + chunk))
                    where row.sourceVersion != nil && row.sourceVersion == photos[row.localIdentifier]?.sourceVersion {
                    reviews[row.localIdentifier] = row
                }
                for row in try Row.fetchAll(db, sql: """
                    SELECT localIdentifier, takenAt FROM appearance
                    WHERE localIdentifier IN (\(databaseQuestionMarks(count: chunk.count))) AND takenAt IS NOT NULL
                    """, arguments: StatementArguments(chunk)) {
                    clocks[row["localIdentifier"] as String] = row["takenAt"] as Date
                }
            }
            let evidence = photos.values.map { photo -> LocalProfilePhotoEvidence in
                let review = reviews[photo.localIdentifier]
                let tokens = review.map { Self.serialTokens($0.vinCandidates + $0.textLines) } ?? []
                let matches = known.filter { v in
                    guard let vin = v.vin?.uppercased(), vin.count >= 10, vin.count <= 17 else { return false }
                    return tokens.contains(vin)
                }.map(\.vehicle_id).sorted()
                return LocalProfilePhotoEvidence(photo: photo, review: review,
                    candidateVehicleIds: matches, takenAt: clocks[photo.localIdentifier])
            }.sorted { $0.photo.localIdentifier < $1.photo.localIdentifier }
            return LocalProfileEvidence(catalog: catalog, photos: evidence, vehicles: known)
        }
    }

    /// Exact complete tokens only: no fuzzy recovery, album-title identity,
    /// same-model grouping or inheritance from an image's assigned vehicle.
    private static func serialTokens(_ lines: [String]) -> Set<String> {
        var result = Set<String>()
        for line in lines {
            let words = line.uppercased().components(separatedBy: CharacterSet.alphanumerics.inverted)
            for word in words where (10...17).contains(word.count) { result.insert(word) }
            let compact = line.uppercased().filter { !$0.isWhitespace && $0 != "-" }
            if (10...17).contains(compact.count), compact.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) {
                result.insert(compact)
            }
        }
        return result
    }

    static func albumDigest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
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
                           SUM(CASE WHEN isVehicle = 1 THEN 1 ELSE 0 END) AS vehicles,
                           SUM(CASE WHEN cloudNarrative IS NOT NULL THEN 1 ELSE 0 END) AS read
                    FROM appearance WHERE takenAt IS NOT NULL
                    GROUP BY day ORDER BY day DESC
                    """)
                out = rows.map {
                    DayRollup(day: $0["day"] as String? ?? "—",
                              count: ($0["n"] as Int?) ?? 0,
                              classified: ($0["classified"] as Int?) ?? 0,
                              vehicles: ($0["vehicles"] as Int?) ?? 0,
                              read: ($0["read"] as Int?) ?? 0)
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

    /// The day-level receipt: measured layer from EXIF/GPS, read layer from cached
    /// cloud verdicts. Pure local read (zero network). Uses the IDENTICAL
    /// `strftime('%Y-%m-%d', takenAt, 'localtime')` day key as dayCounts()/
    /// localIdentifiers(onDay:), so the receipt describes exactly the frames the
    /// drill shows. Labor minutes mirror the web's recompute_worth_minutes v3
    /// formula (>45 min gap splits a burst; per burst max(span, n×5) + 10 min;
    /// day capped at 480) over cached intent='labor' frames at confidence ≥ 0.6 —
    /// an ESTIMATE: the cache carries the verdict's overall confidence, not prod's
    /// intent_confidence, so the caller must label it as estimated, never signed.
    func dayReceipt(onDay ymd: String) -> LocalDayReceipt? {
        struct Frame {
            let takenAt: Date
            let isVehicle: Bool?
            let lat: Double?
            let lon: Double?
            let intent: String?
            let confidence: Double?
            let vehicleId: String?
            let read: Bool
        }
        var frames: [Frame] = []
        do {
            try dbQueue.read { db in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT takenAt AS tk, isVehicle AS v, latitude AS lat, longitude AS lon,
                           cloudIntent AS ci, cloudConfidence AS cc, cloudVehicleId AS cv,
                           (cloudNarrative IS NOT NULL) AS rd
                    FROM appearance
                    WHERE takenAt IS NOT NULL AND strftime('%Y-%m-%d', takenAt, 'localtime') = ?
                    ORDER BY takenAt ASC
                    """, arguments: [ymd])
                for r in rows {
                    guard let tk: Date = r["tk"] else { continue }
                    frames.append(Frame(takenAt: tk, isVehicle: r["v"], lat: r["lat"], lon: r["lon"],
                                        intent: r["ci"], confidence: r["cc"], vehicleId: r["cv"],
                                        read: (r["rd"] as Bool?) ?? false))
                }
            }
        } catch {
            NSLog("LocalStore.dayReceipt failed: %@", String(describing: error))
            return nil
        }
        guard !frames.isEmpty else { return nil }

        // Measured: shoot bursts over ALL frames (>45 min gap splits — same split the web uses).
        let gap: TimeInterval = 45 * 60
        var bursts = 1
        for (a, b) in zip(frames, frames.dropFirst()) where b.takenAt.timeIntervalSince(a.takenAt) > gap {
            bursts += 1
        }

        // Read: the web labor formula over cached labor frames (estimate — see doc comment).
        let labor = frames.filter { $0.intent == "labor" && ($0.confidence ?? 0) >= 0.6 }
        var laborMinutes: Int?
        if !labor.isEmpty {
            var total = 0
            var burst: [Frame] = []
            func close() {
                guard let first = burst.first, let last = burst.last else { return }
                let span = Int((last.takenAt.timeIntervalSince(first.takenAt) / 60).rounded())
                total += max(span, burst.count * 5) + 10
                burst = []
            }
            for f in labor {
                if let prev = burst.last, f.takenAt.timeIntervalSince(prev.takenAt) > gap { close() }
                burst.append(f)
            }
            close()
            laborMinutes = min(480, total)
        }

        var intentCounts: [String: Int] = [:]
        for f in frames { if let i = f.intent { intentCounts[i, default: 0] += 1 } }
        var vehicleCounts: [String: Int] = [:]
        for f in frames { if let v = f.vehicleId { vehicleCounts[v, default: 0] += 1 } }
        let topVehicle = vehicleCounts.max { ($0.value, $1.key) < ($1.value, $0.key) }

        let located = frames.compactMap { f in (f.lat != nil && f.lon != nil) ? (f.lat!, f.lon!) : nil }
        let medLat = located.isEmpty ? nil : located.map(\.0).sorted()[located.count / 2]
        let medLon = located.isEmpty ? nil : located.map(\.1).sorted()[located.count / 2]

        return LocalDayReceipt(
            day: ymd,
            count: frames.count,
            classified: frames.filter { $0.isVehicle != nil }.count,
            vehicles: frames.filter { $0.isVehicle == true }.count,
            read: frames.filter(\.read).count,
            firstShot: frames.first?.takenAt,
            lastShot: frames.last?.takenAt,
            bursts: bursts,
            laborFrames: labor.count,
            laborMinutes: laborMinutes,
            intents: intentCounts.sorted { ($0.value, $1.key) > ($1.value, $0.key) },
            agentVehicleId: topVehicle?.key,
            agentVehicleFrames: topVehicle?.value ?? 0,
            locatedCount: located.count,
            medianLat: medLat,
            medianLon: medLon)
    }

    /// Resolve a vehicleId to its canonical display name via the offline garage
    /// mirror ("1972 Chevrolet K5 Blazer"). Read-only; nil when the mirror has
    /// never cached this vehicle (caller omits the line — never a fake label).
    func garageVehicleLabel(vehicleId: String) -> String? {
        do {
            return try dbQueue.read { db -> String? in
                guard let r = try Row.fetchOne(db, sql: """
                    SELECT year, make, model FROM garage_vehicle WHERE vehicleId = ? LIMIT 1
                    """, arguments: [vehicleId]) else { return nil }
                let year: Int? = r["year"]
                let make: String? = r["make"]
                let model: String? = r["model"]
                let parts = [year.map(String.init), make, model].compactMap { $0 }
                return parts.isEmpty ? nil : parts.joined(separator: " ")
            }
        } catch {
            NSLog("LocalStore.garageVehicleLabel failed: %@", String(describing: error))
            return nil
        }
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

    // MARK: Cloud verdict — the FOURTH disjoint writer (BYOK analysis, escalated down)

    /// Cache one photo's prod BYOK verdict on-device so the back-of-the-photo renders
    /// it OFFLINE. Owns ONLY the cloud* columns — never EXIF/T0/owner. The verdict is a
    /// cloud-sourced projection, so the latest pull supersedes the prior cloud value in
    /// place (same source refreshing itself); it can never wipe a column another writer
    /// owns. Upserts a minimal row if the photo wasn't ingested yet.
    func cacheCloudVerdict(localIdentifier: String,
                           narrative: String?, intent: String?, scene: String?,
                           confidence: Double?, buildPhase: String?, vehicleId: String?,
                           agentModel: String?, analyzedAt: Date?, now: Date = Date()) {
        do {
            try dbQueue.write { db in
                try db.execute(sql: """
                    INSERT INTO appearance (localIdentifier, sourceType, createdAt,
                        cloudNarrative, cloudIntent, cloudScene, cloudConfidence,
                        cloudBuildPhase, cloudVehicleId, cloudAgentModel, cloudAnalyzedAt, cloudCachedAt)
                    VALUES (?, 'local_filesystem', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(localIdentifier) DO UPDATE SET
                        cloudNarrative  = excluded.cloudNarrative,
                        cloudIntent     = excluded.cloudIntent,
                        cloudScene      = excluded.cloudScene,
                        cloudConfidence = excluded.cloudConfidence,
                        cloudBuildPhase = excluded.cloudBuildPhase,
                        cloudVehicleId  = excluded.cloudVehicleId,
                        cloudAgentModel = excluded.cloudAgentModel,
                        cloudAnalyzedAt = excluded.cloudAnalyzedAt,
                        cloudCachedAt   = excluded.cloudCachedAt
                    """, arguments: [localIdentifier, now, narrative, intent, scene, confidence,
                                     buildPhase, vehicleId, agentModel, analyzedAt, now])
            }
        } catch { NSLog("LocalStore.cacheCloudVerdict failed: %@", String(describing: error)) }
    }

    /// Ingested photos we have NOT yet checked for a cloud verdict (newest first), so the
    /// backfill pulls "Read by Nuke" down in bounded batches. `cloudCachedAt` is the
    /// checked-marker (set by cacheCloudVerdict on a hit, by markCloudChecked on a miss).
    func localIdentifiersMissingCloudVerdict(limit: Int) -> [String] {
        var out: [String] = []
        do {
            try dbQueue.read { db in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT localIdentifier AS lid FROM appearance
                    WHERE takenAt IS NOT NULL AND cloudCachedAt IS NULL
                    ORDER BY takenAt DESC LIMIT ?
                    """, arguments: [limit])
                for r in rows { let lid: String = r["lid"]; out.append(lid) }
            }
        } catch { NSLog("LocalStore.localIdentifiersMissingCloudVerdict failed: %@", String(describing: error)) }
        return out
    }

    /// Mark a batch checked WITHOUT a verdict (none in prod) — sets only cloudCachedAt
    /// where it's null, so these aren't re-queried. Touches no other writer's columns.
    func markCloudChecked(_ localIdentifiers: [String], now: Date = Date()) {
        guard !localIdentifiers.isEmpty else { return }
        var args: [DatabaseValueConvertible] = [now]
        for lid in localIdentifiers { args.append(lid) }
        do {
            try dbQueue.write { db in
                try db.execute(sql: """
                    UPDATE appearance SET cloudCachedAt = ?
                    WHERE cloudCachedAt IS NULL AND localIdentifier IN (\(databaseQuestionMarks(count: localIdentifiers.count)))
                    """, arguments: StatementArguments(args))
            }
        } catch { NSLog("LocalStore.markCloudChecked failed: %@", String(describing: error)) }
    }

    /// How many photos carry a cached cloud verdict ("Read by Nuke"). Pure local read.
    func cloudVerdictCount() -> Int {
        var n = 0
        do {
            try dbQueue.read { db in
                n = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM appearance WHERE cloudNarrative IS NOT NULL") ?? 0
            }
        } catch { NSLog("LocalStore.cloudVerdictCount failed: %@", String(describing: error)) }
        return n
    }

    // MARK: Garage cache — offline mirror of get_user_garage (write-through)

    /// Write-through cache: call this with the exact rows a live `get_user_garage`
    /// call just returned. Replaces this user's prior cached rows in one
    /// transaction (see the v5 migration note on why full-replace is correct here,
    /// unlike the disjoint-column pattern used elsewhere in this file).
    func cacheGarage(userId: String,
                     vehicles: [GarageVehicle],
                     now: Date = Date()) {
        do {
            try dbQueue.write { db in
                try db.execute(sql: "DELETE FROM garage_vehicle WHERE userId = ?", arguments: [userId])
                for v in vehicles {
                    let payload = String(decoding: try JSONEncoder().encode(v), as: UTF8.self)
                    try LocalGarageVehicle(userId: userId, vehicleId: v.vehicle_id, year: v.year,
                                           make: v.make, model: v.model, trimName: v.trim_name,
                                           imageUrl: v.image_url, currentValue: v.current_value,
                                           imageCount: v.image_count, relationship: v.relationship,
                                           cachedAt: now, vin: v.vin, relationshipEvidenceJSON: payload)
                        .insert(db)
                }
            }
        } catch { NSLog("LocalStore.cacheGarage failed: %@", String(describing: error)) }
    }

    /// Read the offline garage mirror for the network-down fallback. Returns nil
    /// when nothing has ever been cached for this user (so the caller can still
    /// show the honest "couldn't load" card rather than a fake empty garage).
    /// `cachedAt` is the OLDEST row's stamp (a conservative "may be out of date
    /// since at least this long ago" — a partial re-cache never looks fresher
    /// than its stalest member).
    func cachedGarage(userId: String) -> (vehicles: [LocalGarageVehicle], cachedAt: Date)? {
        do {
            return try dbQueue.read { db -> (vehicles: [LocalGarageVehicle], cachedAt: Date)? in
                // ORDER BY rowid: rows are inserted in the live RPC's own order on
                // each cacheGarage() call, so this reproduces that order instead of
                // SQLite's unspecified default — the offline list reads the same
                // as the live one did, not reshuffled.
                let rows = try LocalGarageVehicle.fetchAll(db, sql: """
                    SELECT userId, vehicleId, year, make, model, trimName, imageUrl,
                           currentValue, imageCount, relationship, cachedAt, vin, relationshipEvidenceJSON
                    FROM garage_vehicle WHERE userId = ? ORDER BY rowid ASC
                    """, arguments: [userId])
                guard !rows.isEmpty, let oldest = rows.map(\.cachedAt).min() else { return nil }
                return (rows, oldest)
            }
        } catch {
            NSLog("LocalStore.cachedGarage failed: %@", String(describing: error))
            return nil
        }
    }

    // MARK: Tag push — read side of LocalTagPush (lives here for dbQueue access)

    /// One classified appearance row destined for the cloud.
    struct TagSyncRow {
        let localIdentifier: String
        let labels: [String]
        let isVehicle: Bool?
        let isPersonal: Bool?
        let ownerVerdict: String?
    }

    /// Classified appearance rows (T0 labels present), paged by rowid for a resumable push.
    func appearanceTagsForSync(limit: Int, afterRowId: Int64 = 0) -> (rows: [TagSyncRow], lastRowId: Int64) {
        var out: [TagSyncRow] = []
        var last = afterRowId
        do {
            try dbQueue.read { db in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT rowid AS rid, localIdentifier AS lid, appleMLLabelsJSON AS labels,
                           isVehicle AS v, isPersonal AS p, ownerVerdict AS ov
                    FROM appearance
                    WHERE appleMLLabelsJSON IS NOT NULL AND rowid > ?
                    ORDER BY rowid ASC LIMIT ?
                    """, arguments: [afterRowId, limit])
                for r in rows {
                    last = r["rid"]
                    let lid: String = r["lid"]
                    let labelsStr: String? = r["labels"]
                    let labels = labelsStr.flatMap { try? JSONDecoder().decode([String].self, from: Data($0.utf8)) } ?? []
                    out.append(TagSyncRow(localIdentifier: lid,
                                          labels: labels,
                                          isVehicle: r["v"],
                                          isPersonal: r["p"],
                                          ownerVerdict: r["ov"]))
                }
            }
        } catch { NSLog("LocalStore.appearanceTagsForSync failed: %@", String(describing: error)) }
        return (out, last)
    }

    /// The full ledger for one image — classification + labels + identity + binding +
    /// the cached cloud verdict. Powers the info page (the back of the photo). nil if
    /// the row doesn't exist yet.
    func ledger(for localIdentifier: String) -> ImageLedger? {
        do {
            return try dbQueue.read { db -> ImageLedger? in
                guard let r = try Row.fetchOne(db, sql: """
                    SELECT a.isVehicle AS v, a.isPersonal AS p, a.appleMLLabelsJSON AS labels,
                           a.phashHex AS ph, a.analyzedAt AS an, a.takenAt AS tk,
                           a.cloudNarrative AS cn, a.cloudIntent AS ci, a.cloudScene AS cs,
                           a.cloudConfidence AS cc, a.cloudBuildPhase AS cb, a.cloudAgentModel AS cm,
                           a.cloudAnalyzedAt AS ca,
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
                    analyzedAt: r["an"],
                    takenAt: r["tk"],
                    cloudNarrative: r["cn"],
                    cloudIntent: r["ci"],
                    cloudScene: r["cs"],
                    cloudConfidence: r["cc"],
                    cloudBuildPhase: r["cb"],
                    cloudAgentModel: r["cm"],
                    cloudAnalyzedAt: r["ca"]
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
