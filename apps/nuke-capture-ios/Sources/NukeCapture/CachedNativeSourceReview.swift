import Foundation
import Photos

/// Read-only local evidence. A Photos relationship and matching uploaded bytes are
/// separate qualifications; neither is a vehicle identity or a filing decision.
struct CachedNativeSourceReview: Equatable, Sendable {
    enum State: String, Sendable { case unavailable, stale, byteConflict, byteUnbound, bound }
    struct Line: Equatable, Sendable {
        let text: String
        let confidence: Double
        let isSeed: Bool
    }
    let state: State
    let explanation: String
    var lines: [Line] = []
    var readAt: Date? = nil

    var hasMultipleIdentifierReadings: Bool {
        Set(lines.flatMap { $0.text.uppercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }) }
            .map(String.init).filter { (8...17).contains($0.count) && $0.contains(where: \.isLetter)
                && $0.contains(where: \.isNumber) && $0.utf8.allSatisfy { $0 < 128 } }).count > 1
    }

    static func qualify(review: LocalAlbumImageReview?, localIdentifier: String,
                        currentSourceVersion: String?, method: String, uploadedHash: String?, sourceReady: Bool = false) -> Self {
        guard let version = currentSourceVersion else {
            return .init(state: .unavailable, explanation: "The current Photos source version is unavailable.")
        }
        guard let review else {
            return .init(state: .unavailable, explanation: "No retained native reading is available for this Photos source.")
        }
        guard review.localIdentifier == localIdentifier else {
            return .init(state: .unavailable, explanation: "The retained reading belongs to a different Photos source.")
        }
        guard review.sourceVersion == version, review.methodVersion == method else {
            return .init(state: .stale, explanation: "The retained reading uses an earlier source version or reading method.")
        }
        guard hash(review.inputSHA256) else {
            return .init(state: .unavailable, explanation: "The retained reading has no qualified original-byte receipt.")
        }
        // Document/person refusals are independent of vehicle classification.
        // An unclassified close-up additionally needs ready source + exact bytes.
        guard !review.hasPerson,
              !VisionEngine.isIdentityDocument(labels: review.labels, isScreenshot: false, ocrLines: review.textLines),
              review.textLines.joined(separator: " ").range(of: #"\b(TITLE|CERTIFICATE|REGISTRATION|INVOICE|RECEIPT)\b"#,
                  options: [.regularExpression, .caseInsensitive]) == nil else {
            return .init(state: .unavailable, explanation: "This frame's local text is not available in vehicle-photo review.")
        }
        if !review.isVehicle && !(sourceReady && uploadedHash == review.inputSHA256) {
            return .init(state: .unavailable, explanation: "Classification-unresolved text needs a ready source with matching original-byte receipts.")
        }
        let lines = review.onDeviceObservations.filter {
            $0.kind == .ocrText && $0.source.framework == "Apple Vision" &&
            $0.source.model == "VNRecognizeTextRequest" && $0.source.revision > 0 &&
            [NativeIdentityOCR.methodVersion, NativeIdentityOCR.seedMethodVersion].contains($0.source.method)
        }.map { Line(text: $0.value, confidence: $0.confidence,
                     isSeed: $0.source.method == NativeIdentityOCR.seedMethodVersion) }
        guard !lines.isEmpty else {
            return .init(state: .unavailable, explanation: "No current native text observations were retained for this source.")
        }
        guard let uploadedHash, hash(uploadedHash) else {
            return .init(state: .byteUnbound,
                         explanation: "This reading matches the current Photos source. Uploaded byte identity is not bound because its source hash is unavailable.",
                         lines: lines, readAt: review.analyzedAt)
        }
        guard uploadedHash == review.inputSHA256 else {
            return .init(state: .byteConflict,
                         explanation: "The current local reading and uploaded source have different byte receipts. These readings describe the local source only.",
                         lines: lines, readAt: review.analyzedAt)
        }
        let explanation = review.isVehicle ? "Current Photos source, reading method and uploaded original-byte receipt match." :
            "Classification unresolved · text only. Current Photos source, reading method and uploaded original-byte receipt match. This is not a vehicle identity or filing decision."
        return .init(state: .bound, explanation: explanation,
                     lines: lines, readAt: review.analyzedAt)
    }

    private static func hash(_ value: String) -> Bool {
        value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

@MainActor
enum CachedNativeSourceReader {
    private struct Row: Decodable {
        struct Exif: Decodable { let uuid: String? }
        let id: UUID
        let user_id: UUID?
        let exif_data: Exif?
        let file_hash: String?
        let is_sensitive: Bool?
        let is_superseded: Bool?
        let is_duplicate: Bool?
        let vision_gate_status: String?
    }

    /// No permission request, Photos network fetch, inference or writer. The exact
    /// current owner's image row supplies the device relationship, never a date.
    static func read(userId: String, photo: SourceInboxRead.Photo) async throws -> CachedNativeSourceReview {
        guard let owner = ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) else {
            throw CocoaError(.userCancelled)
        }
        // Keep upstream privacy/withdrawal holds. A missing byte locator may
        // still support a separately qualified local relationship, never pixels.
        guard photo.source_state == "ready" ||
              photo.source_state == "unqualified" && photo.source_reason == "source_locator_unpinned" else {
            return .init(state: .unavailable, explanation: "The current source qualification does not permit local evidence display.")
        }
        #if DEBUG
        if FixtureBackend.isActive, let fixture = ProcessInfo.processInfo.environment["NUKE_FIXTURE_NATIVE_REVIEW"], ["conflict", "nonvehicle"].contains(fixture) {
            let observations = [("2S87R3N100001", false), ("2S87R3N100009", true)].map { text, seed in
                OnDeviceObservation(kind: .ocrText, value: text, confidence: 1,
                    source: .init(framework: "Apple Vision", model: "VNRecognizeTextRequest", revision: 3,
                        os_version: "fixture", method: seed ? NativeIdentityOCR.seedMethodVersion : NativeIdentityOCR.methodVersion))
            }
            let review = LocalAlbumImageReview(id: "fixture", localIdentifier: "fixture", sourceVersion: "current",
                inputSHA256: String(repeating: "a", count: 64), methodVersion: "fixture", analyzedAt: Date(timeIntervalSince1970: 1_793_404_800),
                isVehicle: fixture != "nonvehicle", hasPerson: false, labelsJSON: "[]", vinCandidatesJSON: "[]", textLinesJSON: "[]",
                onDeviceJSON: OnDeviceAnalysis.encode(observations))
            return .qualify(review: review, localIdentifier: "fixture", currentSourceVersion: "current", method: "fixture", uploadedHash: fixture == "nonvehicle" ? String(repeating: "a", count: 64) : nil,
                sourceReady: fixture == "nonvehicle")
        }
        #endif
        let imageId = photo.id
        let rows: [Row] = try await SupabaseService.client.from("vehicle_images")
            .select("id,user_id,exif_data,file_hash,is_sensitive,is_superseded,is_duplicate,vision_gate_status")
            .eq("id", value: imageId.uuidString).eq("user_id", value: owner).limit(1).execute().value
        guard ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) == owner else {
            throw CocoaError(.userCancelled)
        }
        guard let row = rows.first, row.id == imageId, row.user_id?.uuidString.lowercased() == owner.lowercased(),
              row.is_sensitive != true, row.is_superseded != true, row.is_duplicate != true,
              !["rejected_personal", "rejected_misattributed"].contains(row.vision_gate_status ?? "") else {
            return .init(state: .unavailable, explanation: "This source is not available for local review in the current account.")
        }
        if let displayedHash = photo.source_sha256, row.file_hash != displayedHash {
            return .init(state: .stale, explanation: "The source byte receipts no longer agree or cannot be checked. Refresh before comparing local readings.")
        }
        guard let identifier = row.exif_data?.uuid, !identifier.isEmpty else {
            return .init(state: .unavailable, explanation: "This uploaded source has no retained Photos relationship.")
        }
        let access = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard access == .authorized || access == .limited else {
            return .init(state: .unavailable, explanation: "The current Photos source is not accessible with the existing permission.")
        }
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil).firstObject,
              asset.localIdentifier == identifier else {
            return .init(state: .unavailable, explanation: "The exact Photos source is unavailable on this device.")
        }
        let version = asset.modificationDate.map { String($0.timeIntervalSince1970) }
        let localPhoto = LocalAlbumPhoto(localIdentifier: identifier, sourceVersion: version)
        let method = LibraryIngest.identityMethodVersion
        let exact = try LocalStore.shared.albumImageReview(for: localPhoto, methodVersion: method)
        let latest = try exact ?? LocalStore.shared.latestAlbumImageReview(localIdentifier: identifier)
        return CachedNativeSourceReview.qualify(review: latest, localIdentifier: identifier,
            currentSourceVersion: version, method: method, uploadedHash: row.file_hash,
            sourceReady: photo.source_state == "ready" && photo.source_sha256 == row.file_hash)
    }
}
