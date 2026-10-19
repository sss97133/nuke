// ToolActionShots.swift — a person's photos where the image analysis saw a tool at work
// (user_tool_action_shots_read), grouped by tool type.
//
// A label is a tool TYPE the image analysis saw in the frame ("two-post lift"), not an identified
// tool from the person's toolbox, so a shot is never attached to a toolbox item or its pack shot.
// The reader scans the person's newest eligible photos (approved, non-external, non-sensitive
// gallery photos; public vehicles only unless the viewer is the person) up to its cap and counts
// one photo once per label. Visitors get a vehicle id only for public vehicles.
// Decoding is tolerant: a missing block reads as not reported, never as zero.

import Foundation
import Supabase

struct ToolActionShots: Decodable, Equatable {
    struct Vehicle: Decodable, Equatable {
        let label: String?
        let vehicleId: String?
        enum CodingKeys: String, CodingKey { case label, vehicleId = "vehicle_id" }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            label = (try? c.decode(String.self, forKey: .label)).flatMap { $0.isEmpty ? nil : $0 }
            vehicleId = (try? c.decode(String.self, forKey: .vehicleId)).flatMap { $0.isEmpty ? nil : $0 }
        }
    }

    struct Shot: Decodable, Equatable, Identifiable {
        let imageId: String
        let imageUrl: String?
        let thumbnailUrl: String?
        let takenAt: String?
        let vehicle: Vehicle?
        var id: String { imageId }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            imageId = try c.decode(String.self, forKey: JobCodingKey("image_id"))
            imageUrl = (try? c.decode(String.self, forKey: JobCodingKey("image_url"))).flatMap { $0.isEmpty ? nil : $0 }
            thumbnailUrl = (try? c.decode(String.self, forKey: JobCodingKey("thumbnail_url"))).flatMap { $0.isEmpty ? nil : $0 }
            guard imageUrl != nil || thumbnailUrl != nil else {
                throw DecodingError.dataCorruptedError(forKey: JobCodingKey("image_url"), in: c, debugDescription: "no image")
            }
            takenAt = try? c.decode(String.self, forKey: JobCodingKey("taken_at"))
            vehicle = try? c.decode(Vehicle.self, forKey: JobCodingKey("vehicle"))
        }
    }

    struct Group: Decodable, Equatable, Identifiable {
        let label: String
        /// Distinct photos with this label among the scanned photos; `shots` holds the newest of them.
        let photos: Int?
        let shots: [Shot]
        var id: String { label }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            label = try c.decode(String.self, forKey: JobCodingKey("label"))
            photos = try? c.decode(Int.self, forKey: JobCodingKey("photos"))
            shots = (try? c.decode([Lossy<Shot>].self, forKey: JobCodingKey("shots")))?.compactMap(\.value) ?? []
        }
    }

    struct Coverage: Decodable, Equatable {
        let recentPhotos: Int?
        let imagesScanned: Int?
        let framesAnalyzed: Int?
        let photosWithTools: Int?
        let scanCap: Int?
        let recentCap: Int?
        let perLabel: Int?

        enum CodingKeys: String, CodingKey {
            case recentPhotos = "recent_photos"
            case imagesScanned = "images_scanned"
            case framesAnalyzed = "frames_analyzed"
            case photosWithTools = "photos_with_tools"
            case scanCap = "scan_cap"
            case recentCap = "recent_cap"
            case perLabel = "per_label"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            recentPhotos = try? c.decode(Int.self, forKey: .recentPhotos)
            imagesScanned = try? c.decode(Int.self, forKey: .imagesScanned)
            framesAnalyzed = try? c.decode(Int.self, forKey: .framesAnalyzed)
            photosWithTools = try? c.decode(Int.self, forKey: .photosWithTools)
            scanCap = try? c.decode(Int.self, forKey: .scanCap)
            recentCap = try? c.decode(Int.self, forKey: .recentCap)
            perLabel = try? c.decode(Int.self, forKey: .perLabel)
        }
    }

    let userId: String?
    let asOf: String?
    let isSelf: Bool
    let labelFilter: String?
    let groups: [Group]
    let coverage: Coverage?
    /// The reader's own words for each measure, keyed as it sends them.
    let basis: [String: String]

    private struct Viewer: Decodable {
        let isSelf: Bool?
        enum CodingKeys: String, CodingKey { case isSelf = "self" }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        userId = try? c.decode(String.self, forKey: JobCodingKey("user_id"))
        asOf = try? c.decode(String.self, forKey: JobCodingKey("as_of"))
        isSelf = (try? c.decode(Viewer.self, forKey: JobCodingKey("viewer")))?.isSelf ?? false
        labelFilter = try? c.decode(String.self, forKey: JobCodingKey("label_filter"))
        groups = ((try? c.decode([Lossy<Group>].self, forKey: JobCodingKey("groups")))?.compactMap(\.value) ?? [])
            .filter { !$0.shots.isEmpty }
        coverage = try? c.decode(Coverage.self, forKey: JobCodingKey("coverage"))
        var words: [String: String] = [:]
        if case .object(let o)? = try? c.decode(JobJSON.self, forKey: JobCodingKey("basis")) {
            for (k, v) in o { if let s = v.stringValue { words[k] = s } }
        }
        basis = words
    }
}

// MARK: - Reader

enum ToolActionShotsReaders {
    static let name = "user_tool_action_shots_read"
    static let perLabelDefault = 6
    static let perLabelMax = 48

    static func shots(userId: String, label: String? = nil, perLabel: Int = perLabelDefault) async -> JobLoad<ToolActionShots> {
        struct P: Encodable { let p_user_id: String; let p_label: String?; let p_per_label: Int }
        do {
            let p = P(p_user_id: userId, p_label: label, p_per_label: clamp(perLabel))
            let data = try await SupabaseService.client.rpc(name, params: p).execute().data
            return .loaded(try JobReaders.decode(ToolActionShots.self, from: data))
        } catch {
            NSLog("NukeCapture %@ failed: %@", name, String(describing: error))
            return .refused(refusal(error))
        }
    }

    /// The reader takes 1…48 per label; asking for more returns 48.
    static func clamp(_ n: Int) -> Int { min(max(n, 1), perLabelMax) }

    /// The reader raises no refusal of its own; a missing deploy, a timeout or a failure reads as JobReaders states it.
    static func refusal(_ error: Error, signedIn: Bool = SupabaseService.currentUserId != nil) -> JobRefusal {
        JobReaders.refusal(name, error, signedIn: signedIn)
    }
}

// MARK: - Words (unit-tested)

enum ActionShotsCopy {
    static let title = "Seen at work"
    /// How many tool types get a carousel; the rest are listed by name and count.
    static let carouselLimit = 6

    static func labelTitle(_ label: String) -> String {
        label.prefix(1).uppercased() + label.dropFirst()
    }

    static func photos(_ n: Int?) -> String {
        guard let n else { return "photos not counted" }
        return n == 1 ? "1 photo" : "\(JobCopy.count(n)) photos"
    }

    /// "Two-post lift · 81 photos".
    static func groupTitle(_ g: ToolActionShots.Group) -> String {
        "\(labelTitle(g.label)) · \(photos(g.photos))"
    }

    static func article(_ label: String) -> String {
        guard let first = label.lowercased().first else { return "a" }
        return "aeiou".contains(first) ? "an" : "a"
    }

    /// Under a single photo: what the analysis saw, said as a type, never as the person's tool.
    static func photoCaption(label: String, isSelf: Bool) -> String {
        "The image analysis saw \(article(label)) \(label) in this photo. That's a tool type, not an identified tool from \(isSelf ? "your" : "their") toolbox."
    }

    static func basis(isSelf: Bool) -> String {
        isSelf
            ? "Tool types the image analysis saw in your photos; not identified tools from your toolbox."
            : "Tool types the image analysis saw in their photos; not identified tools from their toolbox."
    }

    static func scope(isSelf: Bool) -> String {
        isSelf
            ? "Includes photos of your private vehicles. Visitors see photos of public vehicles only."
            : "Photos of public vehicles only."
    }

    /// "212 photos with tools among 1,000 scanned · 854 with an image analysis".
    static func coverage(_ s: ToolActionShots) -> String? {
        guard let c = s.coverage, let with = c.photosWithTools, let scanned = c.imagesScanned else { return nil }
        var line = "\(photos(with)) with tools among \(JobCopy.count(scanned)) scanned"
        if let analysed = c.framesAnalyzed { line += " · \(JobCopy.count(analysed)) with an image analysis" }
        return line
    }

    /// "The scan reads the newest 1,000 eligible photos." when the cap was reached.
    static func capNote(_ s: ToolActionShots) -> String? {
        guard let c = s.coverage, let scanned = c.imagesScanned, let cap = c.scanCap, scanned >= cap else { return nil }
        return "The scan reads the newest \(JobCopy.count(cap)) eligible photos; older photos aren't counted."
    }

    /// "Seen at work · 212 photos" for the toolbox header's jump; nil when no photo showed a tool.
    static func jumpLabel(_ s: ToolActionShots) -> String? {
        guard !s.groups.isEmpty else { return nil }
        guard let n = s.coverage?.photosWithTools, n > 0 else { return title }
        return "\(title) · \(photos(n))"
    }

    /// "Showing 6 of 81 photos, newest first".
    static func shown(_ g: ToolActionShots.Group) -> String? {
        guard let total = g.photos, total > g.shots.count else { return nil }
        return "Showing \(JobCopy.count(g.shots.count)) of \(photos(total)), newest first"
    }

    static func day(_ shot: ToolActionShots.Shot) -> String {
        JobCopy.day(shot.takenAt).map { "Taken \($0)" } ?? "Date not recorded"
    }

    static func vehicle(_ shot: ToolActionShots.Shot) -> String {
        guard let v = shot.vehicle else { return "No vehicle on record" }
        return v.label ?? "Vehicle not named"
    }

    static func thumbURL(_ shot: ToolActionShots.Shot) -> URL? {
        NukeImage.thumb(shot.thumbnailUrl ?? shot.imageUrl, width: 320)
    }

    static func photoURL(_ shot: ToolActionShots.Shot) -> URL? {
        NukeImage.thumb(shot.imageUrl ?? shot.thumbnailUrl, width: 1400)
    }

    /// A shot can sit under several labels, so its transition id carries the label too.
    static func transitionID(label: String, shot: ToolActionShots.Shot) -> String { "\(label)#\(shot.imageId)" }
}
