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
    let image_url: String
    let storage_path: String
    let source: String                  // 'capture_relay_ios'
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
    let file_hash: String?              // SHA-256 hex of the uploaded bytes
    let exif_data: ExifData

    struct ExifData: Encodable {
        let uuid: String                // PHAsset.localIdentifier
        let original_filename: String
        let synced_by: String           // 'capture-relay-ios'
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

        // SHA-256 of the uploaded bytes — lowercase hex string.
        let hashBytes = SHA256.hash(data: data)
        let fileHash = hashBytes.map { String(format: "%02x", $0) }.joined()

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
            file_hash: fileHash,
            exif_data: .init(
                uuid: meta.assetIdentifier,
                original_filename: meta.filename,
                synced_by: Config.syncedByTag
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
