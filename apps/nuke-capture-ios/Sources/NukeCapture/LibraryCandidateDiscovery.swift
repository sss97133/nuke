import Foundation

/// Local source retrieval only. A candidate is never a vehicle assignment or an upload decision.
enum LibraryCandidateDiscovery {
    struct Asset: Codable, Equatable, Sendable {
        var id: String
        var sourceVersion: String?
        /// ISO 8601. PhotoKit's creation date is a fallback clock, not verified capture time.
        var captureAt: String?
        var captureClockBasis: String? = nil
        var latitude: Double?
        var longitude: Double?
        /// Only labels from a review matching the visible source and current method.
        var labels: [String]
        var reviewSourceVersion: String? = nil
        /// Explicitly marks labels read from current Photos metadata rather than cached image review.
        var labelSource: String? = nil
        var exactVehicleIds: [String]
        /// A pre-existing local association is a control, not independent proof.
        var filedVehicleId: String?
        /// All historical local associations for this visible source, retained as caution controls.
        var recordedVehicleIds: [String]? = nil
        var isPersonal: Bool

        init(id: String, sourceVersion: String? = nil, captureAt: String? = nil,
             latitude: Double? = nil, longitude: Double? = nil, labels: [String] = [],
             exactVehicleIds: [String] = [], filedVehicleId: String? = nil, isPersonal: Bool = false,
             captureClockBasis: String? = nil, reviewSourceVersion: String? = nil,
             labelSource: String? = nil, recordedVehicleIds: [String]? = nil) {
            self.id = id; self.sourceVersion = sourceVersion; self.captureAt = captureAt
            self.latitude = latitude; self.longitude = longitude; self.labels = labels
            self.exactVehicleIds = exactVehicleIds; self.filedVehicleId = filedVehicleId
            self.isPersonal = isPersonal
            self.captureClockBasis = captureClockBasis; self.reviewSourceVersion = reviewSourceVersion
            self.labelSource = labelSource
            self.recordedVehicleIds = recordedVehicleIds
        }
    }

    struct Input: Codable, Sendable {
        var assets: [Asset]
        var targetVehicleId: String
        var timeZoneIdentifier: String
        var seedAssetIds: [String] = []

        private enum CodingKeys: String, CodingKey { case assets, targetVehicleId, timeZoneIdentifier, seedAssetIds }
        init(assets: [Asset], targetVehicleId: String, timeZoneIdentifier: String, seedAssetIds: [String] = []) {
            self.assets = assets; self.targetVehicleId = targetVehicleId
            self.timeZoneIdentifier = timeZoneIdentifier; self.seedAssetIds = seedAssetIds
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            assets = try c.decode([Asset].self, forKey: .assets)
            targetVehicleId = try c.decode(String.self, forKey: .targetVehicleId)
            timeZoneIdentifier = try c.decode(String.self, forKey: .timeZoneIdentifier)
            seedAssetIds = try c.decodeIfPresent([String].self, forKey: .seedAssetIds) ?? []
        }
    }

    enum Reason: String, Codable, Comparable, Sendable {
        case exactSerial = "exact_serial_candidate"
        case existingBinding = "recorded_local_association"
        case sameWorkday = "same_workday"
        case nearAnchor = "near_anchor_time"
        case shopLocation = "near_anchor_location"
        case workLabel = "work_label"
        case missingGPS = "missing_gps"
        case noCurrentRead = "no_current_read"
        case conflictingIdentity = "conflicting_identity"
        case filedOther = "filed_other_vehicle"
        case personal = "personal_review"
        case chosenSource = "chosen_source_seed"
        case noWorkLabel = "no_work_label"
        static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }
    }

    struct Candidate: Codable, Equatable, Sendable {
        var id: String
        var captureAt: String?
        var captureClockBasis: String?
        var reasons: [Reason]
        var conflictingVehicleIds: [String]
        var needsReview: Bool
    }

    struct Output: Codable, Sendable {
        var candidates: [Candidate]
        /// All source-visible images without an owner-confirmed filing in this input.
        /// Recorded local associations remain reviewable controls, not proof.
        var unplaced: [Candidate]
        var workPool: [Candidate]
        var sourceImages: Int
        var anchors: Int
        var unavailableClocks: Int
        var mediaScope = "images_only"
    }

    // Broad retrieval vocabulary: labels are evidence of possible work, not a vehicle identity.
    private static let workTerms: Set<String> = [
        "automobile", "car", "vehicle", "garage", "engine", "wheel", "tire", "dashboard",
        "car_seat", "seat", "upholstery", "carpet", "interior", "hood", "bonnet", "paint",
        "decal", "sticker", "paper", "tool", "machine", "metal", "part", "repair"
    ]
    private static let personalTerms: Set<String> = ["selfie", "portrait", "family", "child", "baby"]
    private static let nearSeconds: TimeInterval = 3 * 3600
    private struct Cell: Hashable { let lat: Int; let lon: Int }
    private struct DayAnchors { var times: [Date] = []; var cells: Set<Cell> = [] }
    private static func cell(_ lat: Double?, _ lon: Double?) -> Cell? {
        guard let lat, let lon, (-90...90).contains(lat), (-180...180).contains(lon),
              lat != -180, lon != -180 else { return nil }
        // Coarse grid only ranks candidate retrieval; it never proves a place or identity.
        return Cell(lat: Int((lat / 0.002).rounded(.down)), lon: Int((lon / 0.002).rounded(.down)))
    }

    /// Cheap Albums badge. Avoid building and sorting the full candidate projection on the UI actor.
    static func workPoolCount(_ assets: [Asset]) -> Int {
        assets.reduce(into: 0) { count, asset in
            let labels = currentLabels(asset)
            let normalized = Set(labels.map { $0.lowercased().replacingOccurrences(of: " ", with: "_") })
            if !asset.isPersonal && normalized.isDisjoint(with: personalTerms)
                && !normalized.isDisjoint(with: workTerms) { count += 1 }
        }
    }

    private static func currentLabels(_ asset: Asset) -> [String] {
        (asset.reviewSourceVersion != nil && asset.reviewSourceVersion == asset.sourceVersion)
            || asset.labelSource == "current_source_metadata" ? asset.labels : []
    }

    static func discover(_ input: Input) -> Output {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: input.timeZoneIdentifier) ?? TimeZone(secondsFromGMT: 0)!
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallback = ISO8601DateFormatter()
        let assets = Dictionary(input.assets.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        struct Indexed { var asset: Asset; var date: Date?; var day: Date?; var anchor: Bool }
        let selected = Set(input.seedAssetIds)
        let indexed: [Indexed] = assets.values.map { asset in
            let date = asset.captureAt.flatMap { iso.date(from: $0) ?? fallback.date(from: $0) }
            // An explicitly chosen source replaces target anchors for this retrieval pass.
            // A recorded local association never independently proves the current source.
            let anchor = selected.isEmpty ? asset.exactVehicleIds.contains(input.targetVehicleId) : selected.contains(asset.id)
            return Indexed(asset: asset, date: date, day: date.map { calendar.startOfDay(for: $0) }, anchor: anchor)
        }
        let anchors = indexed.filter(\.anchor)
        let allAnchorTimes = anchors.compactMap(\.date).sorted()
        var anchorsByDay: [Date: DayAnchors] = [:]
        for anchor in anchors {
            guard let day = anchor.day else { continue }
            if let date = anchor.date { anchorsByDay[day, default: DayAnchors()].times.append(date) }
            if let place = cell(anchor.asset.latitude, anchor.asset.longitude) {
                anchorsByDay[day, default: DayAnchors()].cells.insert(place)
            }
        }
        for day in anchorsByDay.keys { anchorsByDay[day]?.times.sort() }

        var results: [Candidate] = []
        var unplaced: [Candidate] = []
        var workPool: [Candidate] = []
        for item in indexed {
            let asset = item.asset
            let recorded = Array(Set((asset.recordedVehicleIds ?? []) + (asset.filedVehicleId.map { [$0] } ?? []))).sorted()
            let sameDayAnchors = item.day.flatMap { anchorsByDay[$0] }
            let exactAmbiguity = input.targetVehicleId.isEmpty && Set(asset.exactVehicleIds).count > 1 ? asset.exactVehicleIds : []
            let exactConflicts = input.targetVehicleId.isEmpty ? [] : asset.exactVehicleIds.filter { $0 != input.targetVehicleId }
            let recordedConflicts = input.targetVehicleId.isEmpty ? [] : recorded.filter { $0 != input.targetVehicleId }
            let internalConflicts = recorded.filter { !asset.exactVehicleIds.isEmpty && !asset.exactVehicleIds.contains($0) }
            let associationAmbiguity = input.targetVehicleId.isEmpty && recorded.count > 1 ? recorded : []
            let conflicts = Array(Set(exactAmbiguity + exactConflicts + recordedConflicts + internalConflicts + associationAmbiguity)).sorted()
            let freshLabels = currentLabels(asset)
            let labels = Set(freshLabels.map { $0.lowercased().replacingOccurrences(of: " ", with: "_") })
            let work = !labels.isDisjoint(with: workTerms)
            let personal = asset.isPersonal || !labels.isDisjoint(with: personalTerms)
            let near = item.date.map { nearTime($0, in: allAnchorTimes) } ?? false
            let atPlace = cell(asset.latitude, asset.longitude).flatMap { place in
                sameDayAnchors.map { day in
                    (-1...1).contains { dy in (-1...1).contains { dx in
                        day.cells.contains(Cell(lat: place.lat + dy, lon: place.lon + dx))
                    } }
                }
            } ?? false
        // The candidate pool is anchored to a source or exact serial read. Source clock alone
        // never makes a candidate; a local work label or proximity must support it.
            var reasons: Set<Reason> = []
            if !asset.exactVehicleIds.isEmpty && (input.targetVehicleId.isEmpty || asset.exactVehicleIds.contains(input.targetVehicleId)) {
                reasons.insert(.exactSerial)
            }
            if !recorded.isEmpty && (input.targetVehicleId.isEmpty || recorded.contains(input.targetVehicleId)) {
                reasons.insert(.existingBinding)
            }
            if sameDayAnchors != nil { reasons.insert(.sameWorkday) }
            if near { reasons.insert(.nearAnchor) }
            if atPlace { reasons.insert(.shopLocation) }
            if work { reasons.insert(.workLabel) }
            if asset.latitude == nil || asset.longitude == nil { reasons.insert(.missingGPS) }
            if freshLabels.isEmpty { reasons.insert(.noCurrentRead) }
            if !exactAmbiguity.isEmpty || !exactConflicts.isEmpty || !internalConflicts.isEmpty || recorded.count > 1 { reasons.insert(.conflictingIdentity) }
            if !recordedConflicts.isEmpty { reasons.insert(.filedOther) }
            if personal { reasons.insert(.personal) }
            if selected.contains(asset.id) { reasons.insert(.chosenSource) }
            if !work { reasons.insert(.noWorkLabel) }
            let candidate = Candidate(id: asset.id, captureAt: asset.captureAt, captureClockBasis: asset.captureClockBasis,
                reasons: reasons.sorted(),
                conflictingVehicleIds: conflicts, needsReview: true)
            // No input here is an owner-confirmed filing. Keep even recorded associations in
            // the residual so conflicts and partially placed sources remain reviewable.
            unplaced.append(candidate)
            if work && !personal { workPool.append(candidate) }
            if item.anchor || near || (sameDayAnchors != nil && (work || atPlace)) { results.append(candidate) }
        }
        func ordered(_ a: Candidate, _ b: Candidate) -> Bool {
            if a.captureAt != b.captureAt { return (a.captureAt ?? "") < (b.captureAt ?? "") }
            return a.id < b.id
        }
        results.sort(by: ordered); unplaced.sort(by: ordered); workPool.sort(by: ordered)
        return Output(candidates: results, unplaced: unplaced, workPool: workPool, sourceImages: assets.count, anchors: anchors.count,
            unavailableClocks: indexed.filter { $0.date == nil }.count)
    }

    private static func nearTime(_ date: Date, in sorted: [Date]) -> Bool {
        var low = 0, high = sorted.count
        while low < high {
            let mid = (low + high) / 2
            if sorted[mid] < date { low = mid + 1 } else { high = mid }
        }
        if low < sorted.count && abs(sorted[low].timeIntervalSince(date)) <= nearSeconds { return true }
        return low > 0 && abs(sorted[low - 1].timeIntervalSince(date)) <= nearSeconds
    }
}
