// SupabaseService.swift — auth + storage + vehicle_images writes.
//
// PORTED from apps/nuke-capture-mac/Sources/NukeCapture/SupabaseService.swift.
// The row shape is byte-for-byte the same as the Mac relay (which cloned it
// from scripts/photo-sync-daemon.mjs uploadPhoto()) so downstream behavior
// (hero trust, AI pipeline triggers, /inbox) is identical. Only the
// provenance tags differ: source = 'capture_relay_ios',
// exif_data.synced_by = 'capture-relay-ios'.
//
// Session persistence: supabase-swift's default AuthLocalStorage on Apple
// platforms is KeychainLocalStorage — sign in once, the session lives in the
// device Keychain and auto-refreshes.

import AuthenticationServices
import CryptoKit
import Foundation
import Supabase

/// One row in public.vehicle_images — mirrors the Mac relay / daemon exactly.
/// Optionals are omitted from the JSON when nil (Encodable default), so the
/// DB applies its own defaults (vehicle_id NULL → server pipeline files it).
struct VehicleImageRow: Encodable {
    let image_url: String               // public URL for pixel rows; "" sentinel for metadata-only (column is NOT NULL)
    let storage_path: String?           // nil for metadata-only rows (no object uploaded)
    let source: String                  // 'capture_relay_ios'
    let mime_type: String
    let file_name: String
    let file_size: Int                  // real original byte count (alibi substrate) even when pixels are skipped
    let is_external: Bool               // false — we hold the bytes
    let ai_processing_status: String    // 'pending' (pixel) → INSERT trigger + drain cron; 'skipped' (metadata-only) → bypasses it
    let user_id: String
    let documented_by_user_id: String
    let latitude: Double?
    let longitude: Double?
    let taken_at: String?               // embedded EXIF DateTimeOriginal (raw truth), ISO-8601; falls back to creationDate only if EXIF date absent
    let file_hash: String?              // SHA-256 hex of the uploaded bytes (nil for metadata-only)
    let apple_ml_labels: [String]?      // on-device Apple Vision labels → feeds the server L2 gate (both row kinds)
    let exif_data: ExifData

    struct ExifData: Encodable {
        let uuid: String                // PHAsset.localIdentifier
        let original_filename: String
        let synced_by: String           // 'capture-relay-ios'
        let camera_make: String?        // TIFF Make (nil = stripped/foreign)
        let camera_model: String?       // TIFF Model
        let source_type: String         // PHAsset.sourceType description
        let owner_verified: Bool        // true when camera_make == "Apple"
    }
}

/// Metadata carried from PhotoKit to the upload.
struct PhotoMeta {
    let assetIdentifier: String
    let filename: String
    let creationDate: Date?
    let exifCaptureDate: Date?          // embedded EXIF DateTimeOriginal — the raw truth; preferred over creationDate
    let latitude: Double?
    let longitude: Double?
    let cameraMake: String?             // from TIFF EXIF
    let cameraModel: String?
    let sourceType: String              // PHAsset.sourceType description
}

enum SupabaseService {
    /// Anon-key client: all writes ride the signed-in user's JWT, RLS scopes
    /// storage objects and rows to that user. Never the service-role key.
    static let client = SupabaseClient(
        supabaseURL: Config.supabaseURL,
        supabaseKey: Config.supabaseAnonKey,
        // Opt into the SDK's corrected initial-session behavior (supabase-swift
        // PR #822): always emit the locally stored session on startup, even if
        // expired (the SDK refreshes on first authenticated call). Silences the
        // runtime reportIssue warning. SessionStore already tolerates an expired
        // session, so no isExpired gating is needed here.
        options: SupabaseClientOptions(
            auth: SupabaseClientOptions.AuthOptions(emitLocalSessionAsInitialSession: true)
        )
    )

    // ─── Auth ────────────────────────────────────────────────────────────────

    /// Signed-in user id, if a Keychain session exists (possibly expired —
    /// the SDK refreshes on first authenticated call).
    static var currentUserId: String? {
        client.auth.currentUser?.id.uuidString.lowercased()
    }

    static var currentUserEmail: String? {
        client.auth.currentUser?.email
    }

    static func signIn(email: String, password: String) async throws {
        try await client.auth.signIn(email: email, password: password)
    }

    /// Create a new account with email/password. Sign-in IS sign-up on the
    /// server (a handle_new_user() trigger auto-creates the profile on first
    /// auth), so the client only needs to call signUp — no separate
    /// profile-creation step. Depending on the Supabase project's email-
    /// confirmation setting, the user may be signed in immediately (confirm
    /// disabled) or must confirm via email first; SessionStore observes the
    /// auth change either way.
    static func signUp(email: String, password: String) async throws {
        try await client.auth.signUp(email: email, password: password)
    }

    // ─── Third-party OAuth (Google, GitHub) ──────────────────────────────────
    //
    // supabase-swift's signInWithOAuth(provider:redirectTo:configure:) drives
    // an ASWebAuthenticationSession to the provider's consent page and back
    // through the redirect URL, then exchanges the result for a session (PKCE
    // flow). Both providers are gated behind Config flags (default OFF) until
    // the corresponding Supabase auth provider is enabled and
    // Config.oauthRedirectURL is in the project's redirect allow-list — see
    // the Config flag docs for the full runtime dependency.

    /// Sign in with Google via the hosted OAuth consent flow.
    static func signInWithGoogle() async throws {
        try await client.auth.signInWithOAuth(
            provider: .google,
            redirectTo: Config.oauthRedirectURL
        )
    }

    /// Sign in with GitHub via the hosted OAuth consent flow.
    static func signInWithGitHub() async throws {
        try await client.auth.signInWithOAuth(
            provider: .github,
            redirectTo: Config.oauthRedirectURL
        )
    }

    /// Sign in with Apple — exchanges the ASAuthorizationAppleIDCredential's
    /// identity token for a Supabase session (supabase-swift 2.x
    /// `signInWithIdToken`, verified against the 2.47.0 checkout).
    ///
    /// `nonce` is the RAW nonce whose SHA-256 hash was set on the
    /// ASAuthorizationAppleIDRequest — Apple embeds the hash in the ID
    /// token's `nonce` claim and GoTrue re-hashes this raw value to compare
    /// (replay protection). Server-side this only needs the app's bundle id
    /// (ag.nuke.capture) listed in the Apple provider's Client IDs — no
    /// Services ID / secret needed for the native flow. See
    /// apps/SIGN_IN_WITH_APPLE_SETUP.md.
    static func signInWithApple(idToken: String, nonce: String) async throws {
        try await client.auth.signInWithIdToken(
            credentials: OpenIDConnectCredentials(
                provider: .apple,
                idToken: idToken,
                nonce: nonce
            )
        )
    }

    static func signOut() async throws {
        try await client.auth.signOut()
    }

    // ─── Account deletion (App Store rule 5.1.1(v)) ──────────────────────────
    //
    // Apple requires apps with account creation/sign-in to offer in-app
    // account DELETION (not just deactivation). The client cannot delete an
    // auth.users row with the anon key — deletion is server authority. This
    // calls a `request_account_deletion` RPC, which the server must implement
    // (SECURITY DEFINER function or edge function that deletes/queues the
    // signed-in user's account and data).
    //
    // ⚠ If that RPC does not exist in production yet, this throws a PostgREST
    // "function not found" error, which the UI surfaces verbatim. Creating it
    // is a PRE-SUBMISSION TODO — see apps/APP_STORE_LAUNCH.md §2. We do NOT
    // invent server behavior here; the app only makes the documented call.
    static func requestAccountDeletion() async throws {
        try await client.rpc("request_account_deletion").execute()
        // Server accepted the deletion request — drop the local session too.
        try await client.auth.signOut()
    }

    // ─── Confirmed sites → prod user_sites (owner-ALL RLS) ───────────────────
    //
    // Ignition's confirmed sites sync to public.user_sites so the user's
    // grants are visible server-side. The device-local SiteStore stays the
    // cache and the actual upload gate; this write failing never blocks the
    // flow (logged, retried implicitly next ignition — the table tolerates
    // re-inserts, rows are owner-scoped).

    private struct UserSiteRow: Encodable {
        let user_id: String
        let name: String
        let lat: Double
        let lon: Double
        let radius_m: Int
        let source: String
        let confirmed_at: String
    }

    /// Fetch the signed-in user's confirmed sites from the server.
    /// RLS scopes the SELECT to the current user — no explicit user_id filter needed.
    /// Returns [] on error (caller merges into local store silently).
    static func fetchUserSites() async -> [Site] {
        do {
            struct ServerSiteRow: Decodable {
                let name: String
                let lat: Double
                let lon: Double
                let radius_m: Int
            }
            let rows: [ServerSiteRow] = try await client
                .from("user_sites")
                .select("name, lat, lon, radius_m")
                .execute()
                .value
            return rows.map { Site(name: $0.name, latitude: $0.lat, longitude: $0.lon, radiusMeters: Double($0.radius_m)) }
        } catch {
            NSLog("NukeCapture: fetchUserSites failed: %@", String(describing: error))
            return []
        }
    }

    static func pushUserSite(_ site: Site) async {
        guard let userId = currentUserId else { return }   // explore/debug: no JWT, no row
        let row = UserSiteRow(
            user_id: userId,
            name: site.name,
            lat: site.latitude,
            lon: site.longitude,
            radius_m: Int(site.radiusMeters.rounded()),
            source: "ignition",
            confirmed_at: isoFormatter.string(from: Date())
        )
        do {
            try await client.from("user_sites").insert(row).execute()
        } catch {
            NSLog("NukeCapture: user_sites insert failed: %@", String(describing: error))
        }
    }

    // ─── Organization membership (the contributor path) ─────────────────────
    //
    // organization_contributors is the LIVE user↔org membership table (role +
    // status='active'). vehicle_images RLS already lets any authed user attach
    // an image to any vehicle, so an org contributor needs NO server change to
    // upload — this read only tells the app whether this device is contributing
    // to an org pool, i.e. whether to run the CONTRIBUTOR safety gate
    // (VisionEngine.contributorVerdict) before uploads leave the phone.

    struct OrgMembership: Decodable, Sendable {
        let organization_id: String
        let role: String
        let status: String
    }

    /// Active org memberships for the signed-in user. Explicitly filtered by
    /// user_id (never relies on RLS alone). [] when not signed in or on error —
    /// the caller treats empty as "not a contributor; owner-mode rules apply".
    static func fetchActiveOrgMemberships() async -> [OrgMembership] {
        guard let userId = currentUserId else { return [] }
        do {
            return try await client
                .from("organization_contributors")
                .select("organization_id, role, status")
                .eq("user_id", value: userId)
                .eq("status", value: "active")
                .execute()
                .value
        } catch {
            NSLog("NukeCapture: fetchActiveOrgMemberships failed: %@", String(describing: error))
            return []
        }
    }

    // ─── Reconcile (repair taken_at + GPS from the asset's true EXIF) ─────────
    //
    // Rows synced by older builds stored PHAsset.creationDate — the date the
    // photo was re-ADDED to the library (iCloud restore / device migration),
    // not the shutter date — as taken_at, and dropped GPS entirely. The asset's
    // embedded EXIF DateTimeOriginal + PHAsset.location are the source of truth.
    // SyncEngine re-reads them on-device and calls these to PATCH the
    // destination row, joined on the localIdentifier we stored at upload time
    // (exif_data.uuid). Idempotent — safe to re-run.

    struct ReconcileTarget: Decodable, Sendable {
        let id: String
        let exif_data: ExifUUID?
        struct ExifUUID: Decodable, Sendable { let uuid: String? }
    }

    /// Capture-relay rows for the signed-in user, oldest first. The caller
    /// re-reads each asset's true EXIF by `exif_data.uuid` and patches it.
    static func fetchReconcileTargets(limit: Int = 5000) async -> [ReconcileTarget] {
        guard let userId = currentUserId else { return [] }
        do {
            return try await client
                .from("vehicle_images")
                .select("id, exif_data")
                .eq("user_id", value: userId)
                .eq("exif_data->>synced_by", value: Config.syncedByTag)
                .order("created_at", ascending: true)
                .limit(limit)
                .execute()
                .value
        } catch {
            NSLog("NukeCapture: fetchReconcileTargets failed: %@", String(describing: error))
            return []
        }
    }

    /// Overwrite the authoritative scalar columns (taken_at + lat/lon) for one
    /// row from the asset's true EXIF. Nil fields are OMITTED (synthesized
    /// Encodable uses encodeIfPresent), never sent as null — so a missing
    /// EXIF date leaves the existing value untouched rather than wiping it.
    static func reconcilePhoto(id: String, takenAt: Date?, latitude: Double?, longitude: Double?) async throws {
        struct Patch: Encodable {
            let taken_at: String?
            let latitude: Double?
            let longitude: Double?
        }
        let patch = Patch(
            taken_at: takenAt.map { isoFormatter.string(from: $0) },
            latitude: latitude,
            longitude: longitude
        )
        try await client
            .from("vehicle_images")
            .update(patch)
            .eq("id", value: id)
            .execute()
    }

    // ─── Cloud BYOK verdict → escalated DOWN to the local store ──────────────
    // The rich prod analysis (narrative/intent/scene/phase) joined to a device photo
    // by the EXACT uuid bridge: exif_data.uuid == PHAsset.localIdentifier. Read-only,
    // owner-gated RPC (get_owner_image_verdicts) that PROJECTS the verdict — no
    // jsonb-blob egress, no storage re-download (HARD_RULES §6). The caller caches the
    // result in LocalStore so the back-of-the-photo renders it OFFLINE. The analysis
    // already ran in prod; this just brings it down. Nothing re-computes.

    struct CloudVerdict: Decodable, Sendable {
        let local_uuid: String
        let vehicle_id: String?
        let narrative: String?
        let intent: String?
        let scene_type: String?
        let confidence: Double?
        let build_phase: String?
        let agent_model: String?
        let analyzed_at: String?   // ISO8601 (fractional sec); parse via verdictDate()
    }

    /// Parse a verdict's `analyzed_at` (e.g. "2026-06-25T19:49:52.139Z"). Independent of
    /// the SDK's Postgres-date strategy — the field decodes as a plain String.
    static func verdictDate(_ s: String?) -> Date? {
        guard let s else { return nil }
        return isoFormatter.date(from: s)
    }

    /// BYOK verdicts for a batch of device photos (keyed by localIdentifier). Returns
    /// only those that HAVE a verdict in prod; offline / no session → [].
    static func fetchCloudVerdicts(forLocalIdentifiers ids: [String]) async -> [CloudVerdict] {
        guard !ids.isEmpty, currentUserId != nil else { return [] }
        do {
            return try await client
                .rpc("get_owner_image_verdicts", params: ["p_uuids": ids])
                .execute()
                .value
        } catch {
            NSLog("NukeCapture: fetchCloudVerdicts failed: %@", String(describing: error))
            return []
        }
    }

    // ─── Owner correction — recategorize a misattributed image (the operating verb) ──
    // The owner's "this isn't that truck" is the highest-trust signal there is, and the
    // scarce one (rare, but gold as training data). It FORKS, never hides: relink_testimony
    // supersedes the binding to the target vehicle, keeps lineage, and logs an audit row.
    // Owner-gated (the owner taps it, p_actor_user_id = currentUserId). Target must already
    // exist — the new-profile fork is a separate path (create_vehicle, pending).

    /// A garage vehicle as a relink target (the chooser unit). Mirrors get_user_garage.
    struct RelinkTarget: Decodable, Identifiable, Sendable {
        let vehicle_id: String
        let year: Int?
        let make: String?
        let model: String?
        let image_url: String?
        let relationship: String?
        var id: String { vehicle_id }
    }

    /// The owner's garage (built + owned + past), for the "move it to…" chooser.
    static func fetchGarage() async -> [RelinkTarget] {
        guard let uid = currentUserId else { return [] }
        do {
            return try await client
                .rpc("get_user_garage", params: ["p_user_id": uid])
                .execute()
                .value
        } catch {
            NSLog("NukeCapture: fetchGarage failed: %@", String(describing: error))
            return []
        }
    }

    private struct RelinkParams: Encodable {
        let p_observation_type: String
        let p_observation_id: String
        let p_target_vehicle_id: String
        let p_reason: String
        let p_actor_user_id: String
    }

    /// Move one image to the correct vehicle (owner correction). Throws on failure so
    /// the UI can show "didn't move" rather than a false success.
    static func relinkImage(imageId: String, toVehicleId: String, reason: String) async throws {
        guard let uid = currentUserId else {
            throw NSError(domain: "NukeCapture", code: 401,
                          userInfo: [NSLocalizedDescriptionKey: "not signed in"])
        }
        _ = try await client
            .rpc("relink_testimony", params: RelinkParams(
                p_observation_type: "image",
                p_observation_id: imageId.lowercased(),
                p_target_vehicle_id: toVehicleId.lowercased(),
                p_reason: reason,
                p_actor_user_id: uid))
            .execute()
    }

    // ─── Upload + insert (one photo) ─────────────────────────────────────────

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func mimeType(forFilename name: String) -> String {
        switch (name as NSString).pathExtension.lowercased() {
        case "png": return "image/png"
        case "heic": return "image/heic"
        case "webp": return "image/webp"
        default: return "image/jpeg"     // jpg/jpeg and the fallback
        }
    }

    /// Upload original bytes to storage, then insert the vehicle_images row.
    /// Mirrors the Mac relay: a storage "already exists" is tolerated (re-runs
    /// after a partial failure must be able to re-insert the row; and the Mac
    /// relay may have already uploaded the same iCloud photo to the same path).
    /// `uploadPixels == false` ⇒ METADATA-ONLY: the storage upload is skipped
    /// entirely (no bytes leave the phone, no public object created) and the row
    /// carries only the EXIF alibi signal. The on-device triage (owner mode) and
    /// the contributor firewall both decide this before calling.
    /// `appleMLLabels` is sent on BOTH paths so the server L2 vision gate stops
    /// being starved of the cheap on-device classification it needs.
    static func uploadPhoto(data: Data, meta: PhotoMeta, userId: String,
                            uploadPixels: Bool, appleMLLabels: [String]) async throws {
        let mime = mimeType(forFilename: meta.filename)

        // Metadata-only defaults: no object, empty-string URL sentinel (the
        // image_url column is NOT NULL in prod; "" passes the url_scheme check),
        // and ai_processing_status='skipped' so the INSERT trigger / orchestrator
        // queue (which require 'pending' AND a non-null image_url) skip it.
        var imageURL = ""
        var storagePath: String? = nil
        var fileHash: String? = nil
        var status = "skipped"

        if uploadPixels {
            let path = Config.storagePath(userId: userId, filename: meta.filename)
            do {
                try await client.storage
                    .from(Config.storageBucket)
                    .upload(path, data: data, options: FileOptions(contentType: mime, upsert: false))
            } catch {
                // Same tolerance as the daemon: object already in the bucket is
                // fine — we still want the DB row (it may have failed last run).
                let msg = String(describing: error).lowercased()
                guard msg.contains("already exists") || msg.contains("duplicate") else { throw error }
            }

            imageURL = try client.storage
                .from(Config.storageBucket)
                .getPublicURL(path: path).absoluteString
            storagePath = path
            // SHA-256 of the uploaded bytes — lowercase hex string.
            fileHash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            status = "pending"
        }

        let row = VehicleImageRow(
            image_url: imageURL,
            storage_path: storagePath,
            source: Config.sourceTag,
            mime_type: mime,
            file_name: meta.filename,
            file_size: data.count,
            is_external: false,
            ai_processing_status: status,
            user_id: userId,
            documented_by_user_id: userId,
            latitude: meta.latitude,
            longitude: meta.longitude,
            taken_at: (meta.exifCaptureDate ?? meta.creationDate).map { isoFormatter.string(from: $0) },
            file_hash: fileHash,
            apple_ml_labels: appleMLLabels.isEmpty ? nil : appleMLLabels,
            exif_data: .init(
                uuid: meta.assetIdentifier,
                original_filename: meta.filename,
                synced_by: Config.syncedByTag,
                camera_make: meta.cameraMake,
                camera_model: meta.cameraModel,
                source_type: meta.sourceType,
                owner_verified: meta.cameraMake == "Apple"
            )
        )

        do {
            try await client.from("vehicle_images").insert(row).execute()
        } catch {
            // Duplicate row (unique constraint) counts as success — parity
            // with the daemon's dup handling.
            let msg = String(describing: error).lowercased()
            guard msg.contains("duplicate") || msg.contains("unique") else { throw error }
        }
    }
}
