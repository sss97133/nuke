//  LocalTagPush.swift
//  The reverse of runCloudBackfill: push the WHOLE library's on-device Apple Vision tags
//  (LocalStore `appearance`, keyed by PHAsset localIdentifier) UP to the cloud, where the
//  SECURITY DEFINER RPC `sync_local_vision_tags` lands them onto vehicle_images by
//  exif_data->>'uuid' == localIdentifier. Additive on the backend (apple_ml_labels filled
//  only-if-empty; full verdict namespaced under ai_scan_metadata.on_device_vision), so this
//  push is idempotent — safe to re-run; no on-device "pushed" flag needed.
//
//  ⚠️ NEEDS AN XCODE BUILD to verify (written from convention, not compiled here). Wire the
//  call site in the BGProcessingTask next to `runCloudBackfill` (NukeCaptureApp / LibraryIngest).
//
//  Coverage note: the localIdentifier↔exif_data.uuid bridge reaches capture-relay rows today
//  (~5.5k). iphoto/user_upload cloud rows carry no uuid → they need the phash content bridge
//  (follow-up). This ships everything the uuid bridge can reach now.

import Foundation

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
