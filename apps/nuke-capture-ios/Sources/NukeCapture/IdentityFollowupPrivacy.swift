import Foundation
import Photos
import CryptoKit

/// Repairs a missing receipt for an already acknowledged source, without upload,
/// paid analysis, or changing source/vehicle membership. OCR is not privacy proof.
@MainActor
enum IdentityFollowupPrivacy {
    struct Original { let data: Data; let version: String }

    static func localOriginal(_ identifier: String) async throws -> Original {
        guard [.authorized, .limited].contains(PHPhotoLibrary.authorizationStatus(for: .readWrite)),
              let asset = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil).firstObject,
              asset.localIdentifier == identifier, asset.mediaType == .image,
              let version = asset.modificationDate.map({ String($0.timeIntervalSince1970) }) else {
            throw SubjectReinspectionFailure.unavailable
        }
        let data = try await SyncEngine.requestOriginalData(for: asset, allowNetwork: false)
        guard currentVersion(identifier) == version else { throw SubjectReinspectionFailure.changedBytes }
        return Original(data: data, version: version)
    }

    static func currentVersion(_ identifier: String) -> String? {
        guard [.authorized, .limited].contains(PHPhotoLibrary.authorizationStatus(for: .readWrite)),
              let asset = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil).firstObject,
              asset.localIdentifier == identifier else { return nil }
        return asset.modificationDate.map { String($0.timeIntervalSince1970) }
    }

    static func recover(_ source: IdentityFollowupSource, userID: String,
        mayContinue: () -> Bool,
        original: (String) async throws -> Original = localOriginal,
        currentVersion: (String) -> String? = currentVersion,
        prepare: (Data, String) async throws -> SyncEngine.PreparedOriginal = { try await SyncEngine.prepare($0, userId: $1) },
        persist: (IdentityFollowupSource) throws -> Void
    ) async throws -> IdentityFollowupSource {
        guard source.userID == userID, source.methodVersion == LibraryIngest.identityMethodVersion,
              mayContinue(), !Task.isCancelled else { throw SubjectReinspectionFailure.scope }
        if let receipt = source.privacyReceipt {
            guard receipt.owner_user_id == userID.lowercased(), receipt.source_sha256 == source.sha256 else {
                throw SubjectReinspectionFailure.scope
            }
            return source
        }
        let loaded = try await original(source.assetID)
        guard mayContinue(), !Task.isCancelled, currentVersion(source.assetID) == loaded.version else {
            throw SubjectReinspectionFailure.unavailable
        }
        guard (1...4_194_304).contains(loaded.data.count),
              SHA256.hash(data: loaded.data).map({ String(format: "%02x", $0) }).joined() == source.sha256 else {
            throw SubjectReinspectionFailure.changedBytes
        }
        let prepared = try await prepare(loaded.data, userID)
        guard mayContinue(), !Task.isCancelled, currentVersion(source.assetID) == loaded.version else {
            throw SubjectReinspectionFailure.unavailable
        }
        guard prepared.pixelsEligible else { throw SubjectReinspectionFailure.privacyHeld }
        guard let receipt = prepared.privacyReceipt, receipt.owner_user_id == userID.lowercased(),
              receipt.source_sha256 == source.sha256 else { throw SubjectReinspectionFailure.unavailable }
        var enriched = source
        enriched.privacyReceipt = receipt
        try persist(enriched) // No remote reading may precede durable receipt storage.
        return enriched
    }
}
