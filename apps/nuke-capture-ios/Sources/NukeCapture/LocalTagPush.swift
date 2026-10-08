//  LocalTagPush.swift
//  The reverse of runCloudBackfill: push the WHOLE library's on-device Apple Vision tags
//  (LocalStore `appearance`, keyed by PHAsset localIdentifier) UP to the cloud, where the
//  SECURITY DEFINER RPC `sync_local_vision_tags` lands them onto vehicle_images by
//  exif_data->>'uuid' == localIdentifier. Additive on the backend (apple_ml_labels filled
//  only-if-empty; full verdict namespaced under ai_scan_metadata.on_device_vision), so this
//  push is idempotent — safe to re-run; no on-device "pushed" flag needed.
//
//  The existing BGProcessingTask calls this legacy tag push. Native source album
//  intake below has its own account-scoped receipt and original-byte qualification.
//
//  Coverage note: the localIdentifier↔exif_data.uuid bridge reaches capture-relay rows today
//  (~5.5k). iphoto/user_upload cloud rows carry no uuid → they need the phash content bridge
//  (follow-up). This ships everything the uuid bridge can reach now.

import Foundation
import Supabase

// The read side (LocalStore.TagSyncRow + appearanceTagsForSync) lives in
// LocalStore.swift — it needs the store's private dbQueue.

extension SupabaseService {
    private struct LocalTagItem: Encodable {
        let local_id: String
        let labels: [String]
        let is_vehicle: Bool?
        let is_personal: Bool?
        let owner_verdict: String?
    }
    private struct TagSyncParams: Encodable { let p_batch: [LocalTagItem] }
    private struct TagSyncResult: Decodable { let received: Int; let matched: Int }

    /// Push a batch of on-device tags. Returns matched count, or nil when offline / no session
    /// (so the caller stops and retries on a later open — never burns a cursor advance offline).
    static func pushLocalVisionTags(_ rows: [LocalStore.TagSyncRow]) async -> Int? {
        guard (try? await client.auth.session) != nil else { return nil }
        let batch = rows.map {
            LocalTagItem(local_id: $0.localIdentifier, labels: $0.labels,
                         is_vehicle: $0.isVehicle, is_personal: $0.isPersonal, owner_verdict: $0.ownerVerdict)
        }
        do {
            let res: TagSyncResult = try await client
                .rpc("sync_local_vision_tags", params: TagSyncParams(p_batch: batch))
                .execute()
                .value
            return res.matched
        } catch {
            NSLog("SupabaseService.pushLocalVisionTags failed: %@", String(describing: error))
            return nil
        }
    }
}

/// Drives the whole-library tag push in bounded, resumable batches. Mirrors LibraryIngest.runCloudBackfill.
enum LocalTagPush {
    private static var running = false
    /// Persisted rowid high-water mark — without it, a >perRun library re-pushes the same
    /// head every run and the tail never syncs. Wraps to 0 at the tail so re-classified
    /// rows refresh on later walks (the push is idempotent server-side).
    private static let cursorKey = "LocalTagPush.cursor"

    static func run(perRun: Int = 4000, batchSize: Int = 200) async {
        guard !running else { return }
        running = true
        defer { running = false }

        let defaults = UserDefaults.standard
        var afterRowId = Int64(defaults.integer(forKey: cursorKey))
        var pushed = 0, matchedTotal = 0
        while pushed < perRun {
            let (rows, lastRowId) = LocalStore.shared.appearanceTagsForSync(limit: batchSize, afterRowId: afterRowId)
            if rows.isEmpty {
                defaults.set(0, forKey: cursorKey) // tail reached → next walk starts over
                break
            }
            guard let matched = await SupabaseService.pushLocalVisionTags(rows) else { break } // offline → resume here next run
            afterRowId = lastRowId
            defaults.set(Int(afterRowId), forKey: cursorKey) // advance only after a landed batch
            pushed += rows.count
            matchedTotal += matched
        }
        if pushed > 0 { NSLog("LocalTagPush: pushed %d appearance rows, %d matched cloud rows", pushed, matchedTotal) }
    }
}

/// Source grouping uses the existing cloud album owner. Only authenticated
/// receipts advance the local outbox; local analysis remains usable offline.
@MainActor enum NativeAlbumPush {
    private static var running = false

    private struct Params: Encodable {
        let p_native_album: AnyJSON
        let p_readings: [NativeAlbumByteWitness]
    }
    private struct Receipt: Decodable {
        let status: String
        let image_set_id: String?
        let capture_id: String?
        let is_current: Bool?
        let source_count: Int?
        let linked_count: Int?
        let unlinked_count: Int?
    }

    static func run(budget: Int = 8) async -> String? {
        guard !running, budget > 0, let userId = SupabaseService.currentUserId else { return nil }
        running = true
        defer { running = false }
        var captured = 0, linked = 0
        var pendingGroups = Set<String>()
        do {
            for _ in 0..<budget {
                guard !Task.isCancelled, SupabaseService.currentUserId == userId else { break }
                guard let request = try await Task.detached(operation: {
                    try LocalStore.shared.nextNativeAlbumCapture(userId: userId)
                }).value else { break }
                let receipt = try await send(request, readings: [])
                guard SupabaseService.currentUserId == userId else { break }
                guard receipt.status == "retained", receipt.is_current == true,
                      let setId = receipt.image_set_id, let captureId = receipt.capture_id else {
                    return "Album sync needs source-lineage review. Your local record is retained."
                }
                try await Task.detached {
                    try LocalStore.shared.acknowledgeNativeAlbumCapture(request, setId: setId, captureId: captureId)
                }.value
                captured += 1
                if (receipt.unlinked_count ?? 0) > 0 { pendingGroups.insert(request.albumId) }
            }
            let method = LibraryIngest.albumMethodVersion
            for _ in 0..<min(4, budget) {
                guard !Task.isCancelled, SupabaseService.currentUserId == userId else { break }
                guard let batch = try await Task.detached(operation: {
                    try LocalStore.shared.nextNativeAlbumLinks(userId: userId, methodVersion: method)
                }).value else { break }
                let receipt = try await send(batch.capture, readings: batch.witnesses)
                guard SupabaseService.currentUserId == userId else { break }
                guard receipt.status == "retained", receipt.capture_id?.lowercased() == batch.capture.requestId.lowercased() else {
                    return "Album links are pending. Your local record is retained."
                }
                try await Task.detached { try LocalStore.shared.acknowledgeNativeAlbumLinks(batch) }.value
                linked += receipt.linked_count ?? 0
                if (receipt.unlinked_count ?? 0) > 0 { pendingGroups.insert(batch.capture.albumId) }
                else { pendingGroups.remove(batch.capture.albumId) }
            }
            if captured > 0 || linked > 0 || !pendingGroups.isEmpty {
                return "\(captured) album captures synced · \(linked) byte-qualified links · \(pendingGroups.count) groups with unlinked source photos"
            }
            return nil
        } catch {
            NSLog("NativeAlbumPush: intake pending: %@", String(describing: error))
            return "Album sync pending. Your local record is retained."
        }
    }

    private static func send(_ request: NativeAlbumCaptureRequest, readings: [NativeAlbumByteWitness]) async throws -> Receipt {
        let source = try JSONDecoder().decode(AnyJSON.self, from: Data(request.payloadJSON.utf8))
        return try await SupabaseService.client.rpc("bulk_add_to_image_set",
            params: Params(p_native_album: source, p_readings: readings)).execute().value
    }
}
