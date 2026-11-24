//  DeviceTags.swift — free-first per-image metadata.
//
//  The phone already ran Apple Vision on these photos (VisionEngine.classify: labels, the vehicle
//  gate, the prominent-face read) and PhotoKit already knows favorites, screenshots, bursts, Live /
//  HDR / panorama / depth, size, time and place. This lane hands that to the server as metadata keyed
//  to the image (PHAsset.localIdentifier → vehicle_images.exif_data->>'uuid'), so discovery starts
//  from what was free before any paid vision pass.
//
//  Held behind `uploadEnabled` (off by default): the server RPC `record_device_tags` is a draft in
//  supabase/drafts/image-cohort-graph/05_device_tags.sql and is not applied. While it is off, or the
//  RPC is missing, nothing changes: the legacy `sync_local_vision_tags` push still runs as before.
//
//  Cost: no new Vision work. One PHAsset fetch per 200-row batch (metadata only, no pixels), on the
//  caller's background task, inside the existing LocalTagPush cursor walk.

import Foundation
import Photos
import Supabase

/// PhotoKit facts for one asset. Plain values so the payload builder is testable without PhotoKit.
struct DeviceAssetFacts: Equatable, Sendable {
    var isFavorite = false
    var isScreenshot = false
    var isLive = false
    var isHDR = false
    var isPanorama = false
    var hasDepth = false
    var burstId: String? = nil
    var pixelWidth = 0
    var pixelHeight = 0
    var takenAt: Date? = nil
    var latitude: Double? = nil
    var longitude: Double? = nil
}

/// One image's free reads, as sent to `record_device_tags`.
struct DeviceTagRecord: Encodable, Equatable {
    let local_id: String
    let labels: [String]
    let is_vehicle: Bool?
    let is_personal: Bool?
    let has_person: Bool?
    let owner_verdict: String?
    let source: String
    let model: String
    let model_revision: Int
    let os_version: String
    let method: String
    let photokit: PhotoKit?

    struct PhotoKit: Encodable, Equatable {
        let is_favorite: Bool
        let is_screenshot: Bool
        let is_live: Bool
        let is_hdr: Bool
        let is_panorama: Bool
        let has_depth: Bool
        let burst_id: String?
        let pixel_width: Int
        let pixel_height: Int
        let taken_at: String?
        let latitude: Double?
        let longitude: Double?
    }
}

enum DeviceTags {
    static let flagKey = "deviceTags.v2Upload"
    static let rpcName = "record_device_tags"
    static let source = "apple_vision"
    static let method = "nuke-device-tags-v1"
    /// Off until Skylar approves the server table. Settable from a debug menu or `defaults`.
    static var uploadEnabled: Bool { UserDefaults.standard.bool(forKey: flagKey) }

    /// Set when the server answers that the RPC does not exist, so one run does not retry every batch.
    nonisolated(unsafe) private static var serverMissing = false

    /// Pure: the payload for one row. Labels are trimmed, de-duplicated case-insensitively and capped.
    static func record(_ row: LocalStore.TagSyncRow, facts: DeviceAssetFacts?,
                       revision: Int = OnDeviceAnalysis.classifySource().revision,
                       osVersion: String = OnDeviceAnalysis.osVersion) -> DeviceTagRecord {
        var seen = Set<String>()
        let labels = row.labels.compactMap { raw -> String? in
            let label = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !label.isEmpty, seen.insert(label.lowercased()).inserted else { return nil }
            return String(label.prefix(80))
        }.prefix(40)
        let iso = ISO8601DateFormatter()
        let pk = facts.map {
            DeviceTagRecord.PhotoKit(is_favorite: $0.isFavorite, is_screenshot: $0.isScreenshot, is_live: $0.isLive,
                                     is_hdr: $0.isHDR, is_panorama: $0.isPanorama, has_depth: $0.hasDepth,
                                     burst_id: $0.burstId, pixel_width: $0.pixelWidth, pixel_height: $0.pixelHeight,
                                     taken_at: $0.takenAt.map { iso.string(from: $0) },
                                     latitude: $0.latitude, longitude: $0.longitude)
        }
        return DeviceTagRecord(local_id: row.localIdentifier, labels: Array(labels), is_vehicle: row.isVehicle,
                               is_personal: row.isPersonal, has_person: row.hasPerson, owner_verdict: row.ownerVerdict,
                               source: source, model: "VNClassifyImageRequest", model_revision: revision,
                               os_version: osVersion, method: method, photokit: pk)
    }

    /// Metadata-only PhotoKit read for a batch (no image data is requested).
    static func facts(for localIdentifiers: [String]) -> [String: DeviceAssetFacts] {
        guard !localIdentifiers.isEmpty,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
                || PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited else { return [:] }
        var out: [String: DeviceAssetFacts] = [:]
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: localIdentifiers, options: nil)
        assets.enumerateObjects { asset, _, _ in
            let s = asset.mediaSubtypes
            out[asset.localIdentifier] = DeviceAssetFacts(
                isFavorite: asset.isFavorite, isScreenshot: s.contains(.photoScreenshot), isLive: s.contains(.photoLive),
                isHDR: s.contains(.photoHDR), isPanorama: s.contains(.photoPanorama), hasDepth: s.contains(.photoDepthEffect),
                burstId: asset.burstIdentifier, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight,
                takenAt: asset.creationDate, latitude: asset.location?.coordinate.latitude,
                longitude: asset.location?.coordinate.longitude)
        }
        return out
    }

    /// The same hold SyncEngine applies, read directly so this nonisolated lane needs no main-actor hop.
    private static var tooHotOrLow: Bool {
        let info = ProcessInfo.processInfo
        return info.isLowPowerModeEnabled || info.thermalState == .serious || info.thermalState == .critical
    }

    private struct Params: Encodable { let p_batch: [DeviceTagRecord] }

    /// Called per landed LocalTagPush batch. A no-op unless the flag is on and the RPC exists.
    static func pushIfEnabled(_ rows: [LocalStore.TagSyncRow]) async {
        guard uploadEnabled, !serverMissing, !rows.isEmpty, !tooHotOrLow else { return }
        let facts = facts(for: rows.map(\.localIdentifier))
        let batch = rows.map { record($0, facts: facts[$0.localIdentifier]) }
        do {
            try await SupabaseService.client.rpc(rpcName, params: Params(p_batch: batch)).execute()
        } catch {
            let text = String(describing: error)
            if text.contains("PGRST202") || text.contains("Could not find the function") { serverMissing = true }
            NSLog("DeviceTags.push failed: %@", text)
        }
    }
}
