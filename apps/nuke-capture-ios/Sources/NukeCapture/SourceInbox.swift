import Foundation

/// Exact private source projection. Individual photos are not vehicle profiles or owner claims.
struct SourceInboxRead: Codable, Equatable, Sendable {
    struct Coverage: Codable, Equatable, Sendable {
        let grain: String
        let assessed: Int
        let returned: Int
        let displayable: Int
        let without_displayable_pixels: Int
        let ambiguous_source_rows: Int
        let as_of: String
        let truncated: Bool
        let account_total: Int?
        let accessible_device_library_total: Int?
        let inference_started: Bool
        var isQualified: Bool {
            grain == "owner_source_page" && assessed >= 0 && assessed <= 24 && returned >= 0 && returned <= assessed
                && displayable >= 0 && displayable <= returned && without_displayable_pixels == returned - displayable
                && ambiguous_source_rows == assessed - returned && ProfileClock.date(as_of) != nil
                && account_total == nil && accessible_device_library_total == nil && !inference_started
        }
    }
    struct Photo: Codable, Identifiable, Equatable, Sendable {
        struct SourceIdentity: Codable, Equatable, Sendable {
            let contract: String
            let receipt_image_id: UUID
            let root_image_id: UUID?
            let current_image_id: UUID?
            let alias_image_ids: [UUID]
            let audit_ids: [UUID]
            let state: String
            let reason: String?
            let complete: Bool
            let source_photo_count: Int?
            let current_vehicle_attribution_proven: Bool
            func isQualified(for imageId: UUID) -> Bool {
                guard contract == "audited_image_source_identity_v1", receipt_image_id == imageId,
                      !current_vehicle_attribution_proven, alias_image_ids.count <= 9,
                      Set(alias_image_ids).count == alias_image_ids.count,
                      Set(audit_ids).count == audit_ids.count else { return false }
                if state == "refused" {
                    return root_image_id == nil && current_image_id == nil && alias_image_ids.isEmpty
                        && audit_ids.isEmpty && source_photo_count == nil
                }
                return ["held", "eligible_for_byte_verification"].contains(state) && complete
                    && source_photo_count == 1 && root_image_id == alias_image_ids.first
                    && current_image_id == alias_image_ids.last && alias_image_ids.contains(imageId)
                    && audit_ids.count == alias_image_ids.count - 1
            }
        }
        struct RetainedContext: Codable, Identifiable, Equatable, Sendable {
            let id: UUID
            let receipt_image_id: UUID
            let input_key: String
            let provider: String
            let model: String
            let read_at: String
            let observed_at: String
            let qualification: String
            var isQualified: Bool {
                qualification == "retained_context_not_current_interpretation" && !provider.isEmpty && !model.isEmpty
                    && input_key.count == 32 && input_key.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
                    && ProfileClock.date(read_at) != nil && ProfileClock.date(observed_at) != nil
            }
        }
        struct ContextCoverage: Codable, Equatable, Sendable {
            let grain: String
            let assessed: Int
            let qualified: Int
            let withdrawn: Int
            let unqualified_or_conflicting: Int
            let complete: Bool
            var isQualified: Bool {
                grain == "terminal_reading_heads" && assessed >= 0 && assessed <= 96 && qualified >= 0 && withdrawn >= 0
                    && unqualified_or_conflicting >= 0 && qualified + withdrawn + unqualified_or_conflicting == assessed
            }
        }
        struct Reading: Codable, Identifiable, Equatable, Sendable {
            struct Input: Codable, Equatable, Sendable {
                let source_sha256: String
                let input_sha256: String
                let representation: String
            }
            struct Frame: Codable, Equatable, Sendable {
                let medium: String
                let primary_subject: String
                let view: String
                let bbox: [Double]?
            }
            let id: UUID
            let input_key: String
            let provider: String
            let model: String
            let read_at: String
            let observed_at: String
            let input: Input
            let frame: Frame?
            let unresolved_reasons: [String]
        }
        let id: UUID
        let grain: String
        let identity: String?
        let grouping_asserted: Bool
        let source_identity: SourceIdentity?
        let retained_contexts: [RetainedContext]?
        let source_state: String
        let source_reason: String?
        let image_url: String?
        let source_sha256: String?
        let created_at: String?
        let taken_at: String?
        let attached_vehicle_id_context: UUID?
        let subject_analysis_state: String
        let readings: [Reading]
        let reading_context_coverage: ContextCoverage
        let membership_state: String
        var isQualified: Bool {
            guard grain == "source_photo", identity == nil, !grouping_asserted,
                  ["ready", "held", "unqualified", "metadata_only"].contains(source_state),
                  ["not_assessed", "current_readings", "not_read", "reading_withdrawn", "reading_no_longer_qualified"].contains(subject_analysis_state),
                  reading_context_coverage.isQualified, reading_context_coverage.qualified == readings.count,
                  reading_context_coverage.complete || readings.isEmpty,
                  (subject_analysis_state == "current_readings") == !readings.isEmpty,
                  Set(readings.map(\.id)).count == readings.count,
                  source_identity?.isQualified(for: id) ?? true else { return false }
            if let contexts = retained_contexts {
                guard contexts.count <= reading_context_coverage.assessed, contexts.count <= 96, Set(contexts.map(\.id)).count == contexts.count,
                      contexts.isEmpty || reading_context_coverage.complete,
                      contexts.isEmpty || source_state == "ready" || source_state == "held" && source_reason == "source_not_ready",
                      contexts.allSatisfy({ context in context.isQualified &&
                        (source_identity.map { $0.alias_image_ids.contains(context.receipt_image_id) } ?? (context.receipt_image_id == id)) }) else { return false }
            }
            if source_state == "ready" {
                if let source_identity, source_identity.state == "refused" || !source_identity.complete { return false }
                guard let image_url, URL(string: image_url)?.scheme == "https", let source_sha256,
                      Self.hash(source_sha256), ProfileClock.date(created_at) != nil,
                      taken_at == nil || ProfileClock.date(taken_at) != nil else { return false }
            } else if image_url != nil || !readings.isEmpty { return false }
            return readings.allSatisfy { reading in
                !reading.provider.isEmpty && !reading.model.isEmpty && ProfileClock.date(reading.read_at) != nil
                    && ProfileClock.date(reading.observed_at) != nil && Self.hash(reading.input.source_sha256)
                    && Self.hash(reading.input.input_sha256) && ["source", "derivative"].contains(reading.input.representation)
                    && reading.input.source_sha256 == source_sha256
            }
        }
        private static func hash(_ value: String) -> Bool {
            value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
        }
    }
    var private_vehicle_id: UUID? = nil
    let photos: [Photo]
    let coverage: Coverage
    let next_cursor: String?
    var isQualified: Bool {
        coverage.isQualified && coverage.returned == photos.count && photos.allSatisfy(\.isQualified)
            && coverage.displayable == photos.filter({ $0.source_state == "ready" }).count
            && Set(photos.map(\.id)).count == photos.count && (next_cursor.map { !$0.isEmpty && $0.count <= 512 } ?? true)
            && (private_vehicle_id == nil || photos.allSatisfy { $0.source_state != "ready" || $0.attached_vehicle_id_context == private_vehicle_id })
    }
}

struct SavedSourceInboxRead: Sendable {
    let read: SourceInboxRead
    let cachedAt: Date
}
