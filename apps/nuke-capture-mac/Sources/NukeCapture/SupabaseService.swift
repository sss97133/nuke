// SupabaseService.swift — auth + storage + vehicle_images writes.
//
// Thin wrapper around supabase-swift. The row shape is cloned from
// scripts/photo-sync-daemon.mjs uploadPhoto() so downstream behavior (hero
// trust, AI pipeline triggers, /inbox) is identical — only `source` differs
// ('capture_relay' vs 'iphoto') so provenance survives the migration.
//
// Session persistence: supabase-swift's default AuthLocalStorage on Apple
// platforms is KeychainLocalStorage (verified in the SDK:
// Sources/Auth/Storage/AuthLocalStorage.swift) — sign in once, the session
// lives in the user's Keychain and auto-refreshes.

import Foundation
import Supabase

/// One row in public.vehicle_images — mirrors photo-sync-daemon.mjs.
/// Optionals are omitted from the JSON when nil (Encodable default), so the
/// DB applies its own defaults (vehicle_id NULL → server pipeline files it).
struct VehicleImageRow: Encodable {
    let image_url: String
    let storage_path: String
    let source: String                  // 'capture_relay'
    let mime_type: String
    let file_name: String
    let file_size: Int
    let is_external: Bool               // false — we hold the bytes
    let ai_processing_status: String    // 'pending' → INSERT trigger + drain cron
    let user_id: String
    let documented_by_user_id: String
    let latitude: Double?
    let longitude: Double?
    let taken_at: String?               // asset.creationDate, ISO-8601
    let exif_data: ExifData

    struct ExifData: Encodable {
        let uuid: String                // PHAsset.localIdentifier
        let original_filename: String
        let synced_by: String           // 'capture-relay'
    }
}

/// Metadata carried from PhotoKit to the upload.
struct PhotoMeta {
    let assetIdentifier: String
    let filename: String
    let creationDate: Date?
    let latitude: Double?
    let longitude: Double?
}

enum SupabaseService {
    /// Anon-key client: all writes ride the signed-in user's JWT, RLS scopes
    /// storage objects and rows to that user. Never the service-role key.
    static let client = SupabaseClient(
        supabaseURL: Config.supabaseURL,
        supabaseKey: Config.supabaseAnonKey
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

    /// Sign in with Apple — exchanges the ASAuthorizationAppleIDCredential's
    /// identity token for a Supabase session (supabase-swift 2.x
    /// `signInWithIdToken`, verified against the 2.47.0 checkout).
    ///
    /// `nonce` is the RAW nonce whose SHA-256 hash was set on the Apple
    /// request — GoTrue re-hashes it and compares against the ID token's
    /// `nonce` claim (replay protection). Server-side this needs the app's
    /// bundle id listed in the Apple provider's Client IDs; no Services ID /
    /// secret for the native flow. See apps/SIGN_IN_WITH_APPLE_SETUP.md.
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
    /// Mirrors the daemon: a storage "already exists" is tolerated (re-runs
    /// after a partial failure must be able to re-insert the row).
    static func uploadPhoto(data: Data, meta: PhotoMeta, userId: String) async throws {
        let path = Config.storagePath(userId: userId, filename: meta.filename)
        let mime = mimeType(forFilename: meta.filename)

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

        let publicURL = try client.storage
            .from(Config.storageBucket)
            .getPublicURL(path: path)

        let row = VehicleImageRow(
            image_url: publicURL.absoluteString,
            storage_path: path,
            source: Config.sourceTag,
            mime_type: mime,
            file_name: meta.filename,
            file_size: data.count,
            is_external: false,
            ai_processing_status: "pending",
            user_id: userId,
            documented_by_user_id: userId,
            latitude: meta.latitude,
            longitude: meta.longitude,
            taken_at: meta.creationDate.map { isoFormatter.string(from: $0) },
            exif_data: .init(
                uuid: meta.assetIdentifier,
                original_filename: meta.filename,
                synced_by: "capture-relay"
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
