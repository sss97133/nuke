// CandidateRouting.swift — candidate-set routing for close-ups (engine bay, parts, tools, work in
// progress) that carry no identifier of their own.
//
// A person knows a close-up belongs to one of the few vehicles worked on that day. The old fallback
// ("same UTC day + same 100 m cell inherits any VIN seen there") spread one car's VIN across every
// car in the shop. This file replaces that guess with three steps, all pure and unit-tested:
//
//   1. Segment the day's photos into shoots (a gap > 20 min or a move > 150 m starts a new one).
//   2. Lock out impossible vehicles with hard constraints ("doors that lock out shapes") before any
//      scoring: each constraint returns allow / deny / abstain with a reason that is stored as a
//      citation. A single deny removes the candidate; abstain means "no evidence either way".
//   3. Score the survivors (time adjacency to anchored photos, activity that day, album, body
//      class) and act only on a clear margin (≥ 0.85 and ≥ 0.25 over the runner-up).
//
// The constraint layer is deliberately not photo-specific: `ConstraintSubject` is "a thing at a
// moment, with an optional body class and optional identifier boundary", so receipts / accounting
// can reuse it (a receipt only lands on a vehicle the paying user held that day, and its make/class
// must fit).

import Foundation

// MARK: - Local day

enum LocalDay {
    /// yyyy-MM-dd of `date` in `timeZone` (the device's zone by default: the owner's working day,
    /// not the UTC day, which rolls over at 5 PM in California).
    static func key(_ date: Date, timeZone: TimeZone = .current) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: value) { return d }
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: value) { return d }
        // PostgREST timestamptz without a "T" ("2026-06-13 18:05:00+00").
        f.formatOptions = [.withFullDate, .withSpaceBetweenDateAndTime, .withFullTime, .withFractionalSeconds]
        if let d = f.date(from: value) { return d }
        f.formatOptions = [.withFullDate, .withSpaceBetweenDateAndTime, .withFullTime]
        return f.date(from: value)
    }

    /// Day key for a stored taken_at string; "nodate" when it cannot be read.
    static func key(taken: String?, timeZone: TimeZone = .current) -> String {
        parse(taken).map { key($0, timeZone: timeZone) } ?? "nodate"
    }
}

// MARK: - Labels → what the photo is

enum BodyClass: String, Sendable, Equatable {
    case truck, car, unknown

    private static let truckWords = ["pickup", "truck", "suburban", "blazer", "bronco", "suv", "utility", "van", "k5", "k10", "k15", "c10", "r3500"]
    private static let carWords = ["coupe", "convertible", "sedan", "fastback", "hardtop", "roadster", "hatchback", "wagon", "sports"]

    /// From a vehicle profile's body style (or model when the style is empty). Unknown abstains.
    static func ofVehicle(bodyStyle: String?, model: String?) -> BodyClass {
        let text = [bodyStyle, model].compactMap { $0?.lowercased() }.joined(separator: " ")
        guard !text.isEmpty else { return .unknown }
        let t = truckWords.contains { text.contains($0) }
        let c = carWords.contains { text.contains($0) }
        if t == c { return .unknown }
        return t ? .truck : .car
    }

    /// From on-device labels. Only strong labels count: Apple tags trucks "Car" and "Automobile" too.
    static func ofLabels(_ labels: [String]) -> BodyClass {
        let set = Set(labels.map(PhotoKind.normalize))
        let t = !set.isDisjoint(with: ["truck", "pickup_truck", "pickup", "suv"])
        let c = !set.isDisjoint(with: ["sportscar", "sports_car", "convertible", "race_car", "coupe"])
        if t == c { return .unknown }
        return t ? .truck : .car
    }
}

enum PhotoKind: String, Sendable, Equatable {
    case work, document, people, outdoorOnly

    static func normalize(_ s: String) -> String {
        s.lowercased().replacingOccurrences(of: " ", with: "_")
    }
    private static let documentLabels: Set<String> = ["document", "printed_page", "handwriting", "receipt", "screenshot", "paper"]
    private static let peopleLabels: Set<String> = ["people", "person", "adult", "child", "baby", "selfie", "portrait"]
    private static let outdoorLabels: Set<String> = ["outdoor", "sky", "blue_sky", "cloudy", "plant", "tree", "palm_tree",
        "land", "hill", "grass", "rocks", "sunset_sunrise", "mountain", "water", "beach", "foliage", "flower"]
    private static let workLabels: Set<String> = ["machine", "wheel", "tire", "rim", "engine_vehicle", "automobile", "vehicle",
        "car", "truck", "sportscar", "dashboard", "dial", "tachometer", "tool", "cord", "conveyance", "metal", "material"]

    /// documents, people and scenery are not vehicle work; everything else may be a close-up.
    static func of(labels: [String], isDocument: Bool) -> PhotoKind {
        if isDocument { return .document }
        let set = Set(labels.map(normalize))
        let hasWork = !set.isDisjoint(with: workLabels)
        if !set.isDisjoint(with: documentLabels) && !hasWork { return .document }
        if !set.isDisjoint(with: peopleLabels) && !hasWork { return .people }
        if !set.isEmpty && set.isSubset(of: outdoorLabels.union(["structure"])) { return .outdoorOnly }
        return .work
    }
}

// MARK: - Shoots

struct RoutingPhoto: Sendable, Equatable {
    let id: String
    let takenAt: Date?
    let latitude: Double?
    let longitude: Double?
    let labels: [String]
    let kind: PhotoKind
    /// Set when the photo itself names a vehicle: an exact VIN/serial read (identifier anchor).
    let identifierVehicleID: String?
    /// Set when the photo is already filed (this run or earlier): a positional anchor, not an identifier.
    let filedVehicleID: String?

    init(id: String, takenAt: Date?, latitude: Double?, longitude: Double?, labels: [String] = [],
         kind: PhotoKind = .work, identifierVehicleID: String? = nil, filedVehicleID: String? = nil) {
        self.id = id; self.takenAt = takenAt; self.latitude = latitude; self.longitude = longitude
        self.labels = labels; self.kind = kind
        self.identifierVehicleID = identifierVehicleID; self.filedVehicleID = filedVehicleID
    }
}

enum ShootSegmenter {
    static let maxGap: TimeInterval = 20 * 60
    static let maxMoveMeters: Double = 150

    static func meters(_ a: RoutingPhoto, _ b: RoutingPhoto) -> Double? {
        guard let la = a.latitude, let lo = a.longitude, let lb = b.latitude, let lob = b.longitude else { return nil }
        let r = Double.pi / 180
        let dLat = (lb - la) * r, dLon = (lob - lo) * r
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(la * r) * cos(lb * r) * sin(dLon / 2) * sin(dLon / 2)
        return 6_371_000 * 2 * asin(sqrt(min(1, h)))
    }

    /// Dated photos in time order, split where the gap exceeds 20 min or the phone moved > 150 m.
    /// Undated photos belong to no shoot.
    static func segment(_ photos: [RoutingPhoto]) -> [[RoutingPhoto]] {
        let dated = photos.filter { $0.takenAt != nil }.sorted { ($0.takenAt!, $0.id) < ($1.takenAt!, $1.id) }
        var shoots: [[RoutingPhoto]] = []
        for p in dated {
            if let prev = shoots.last?.last,
               p.takenAt!.timeIntervalSince(prev.takenAt!) <= maxGap,
               (meters(prev, p) ?? 0) <= maxMoveMeters {
                shoots[shoots.count - 1].append(p)
            } else {
                shoots.append([p])
            }
        }
        return shoots
    }
}

// MARK: - Constraint layer

enum PossessionState: String, Sendable { case held, notHeld = "not_held", unknown }

struct RoutingCandidate: Sendable, Equatable {
    let vehicleID: String
    let bodyClass: BodyClass
    let possession: PossessionState
    /// An identifier read or a filed photo for this vehicle on the same local day.
    let activeThatDay: Bool
    /// Filed photos for this vehicle within 14 days at (≈150 m of) this place.
    let recentAtLocation: Bool
    /// The photo sits in an album the owner mapped to this vehicle.
    let albumMapped: Bool

    init(vehicleID: String, bodyClass: BodyClass = .unknown, possession: PossessionState = .unknown,
         activeThatDay: Bool = false, recentAtLocation: Bool = false, albumMapped: Bool = false) {
        self.vehicleID = vehicleID; self.bodyClass = bodyClass; self.possession = possession
        self.activeThatDay = activeThatDay; self.recentAtLocation = recentAtLocation; self.albumMapped = albumMapped
    }
}

/// Anything routed onto a vehicle: a photo today, a receipt or a time entry later.
struct ConstraintSubject: Sendable, Equatable {
    let at: Date?
    let bodyClass: BodyClass
    /// Vehicles an identifier boundary permits (nil = no identifier in this shoot → abstain).
    let identifierBoundary: Set<String>?
}

enum ConstraintVerdict: Equatable, Sendable {
    case allow(String), deny(String), abstain(String)
    var citation: String {
        switch self {
        case .allow(let r): return "allow:" + r
        case .deny(let r): return "deny:" + r
        case .abstain(let r): return "abstain:" + r
        }
    }
    var isDeny: Bool { if case .deny = self { return true }; return false }
}

protocol CandidateConstraint: Sendable {
    func evaluate(_ subject: ConstraintSubject, _ candidate: RoutingCandidate) -> ConstraintVerdict
}

/// (a) A photo that clearly shows a truck cannot land on a car profile, and the reverse.
struct BodyClassConstraint: CandidateConstraint {
    func evaluate(_ s: ConstraintSubject, _ c: RoutingCandidate) -> ConstraintVerdict {
        guard s.bodyClass != .unknown, c.bodyClass != .unknown else { return .abstain("body_class_unknown") }
        return s.bodyClass == c.bodyClass ? .allow("body_class=\(c.bodyClass.rawValue)")
            : .deny("body_class \(s.bodyClass.rawValue)≠\(c.bodyClass.rawValue)")
    }
}

/// (b) Only vehicles the user held at that moment (or worked on that day).
struct PossessionConstraint: CandidateConstraint {
    func evaluate(_ s: ConstraintSubject, _ c: RoutingCandidate) -> ConstraintVerdict {
        switch c.possession {
        case .notHeld: return .deny("not_held_at_moment")
        case .held: return .allow("held")
        case .unknown: return c.activeThatDay ? .allow("activity_that_day") : .abstain("possession_unknown")
        }
    }
}

/// (c) A shoot is not split across vehicles unless an identifier read marks the boundary.
struct ShootBoundaryConstraint: CandidateConstraint {
    func evaluate(_ s: ConstraintSubject, _ c: RoutingCandidate) -> ConstraintVerdict {
        guard let allowed = s.identifierBoundary, !allowed.isEmpty else { return .abstain("no_identifier_in_shoot") }
        return allowed.contains(c.vehicleID) ? .allow("identifier_in_shoot")
            : .deny("shoot_anchored_to_other_vehicle")
    }
}

enum ConstraintLayer {
    static let standard: [any CandidateConstraint] = [PossessionConstraint(), ShootBoundaryConstraint(), BodyClassConstraint()]

    /// Candidates that survive every constraint, each with its citations.
    static func filter(_ subject: ConstraintSubject, _ candidates: [RoutingCandidate],
                       constraints: [any CandidateConstraint] = standard)
        -> (allowed: [(RoutingCandidate, [String])], denied: [String]) {
        var allowed: [(RoutingCandidate, [String])] = [], denied: [String] = []
        for c in candidates {
            let verdicts = constraints.map { $0.evaluate(subject, c) }
            if let d = verdicts.first(where: \.isDeny) { denied.append("\(c.vehicleID):\(d.citation)") }
            else { allowed.append((c, verdicts.map(\.citation))) }
        }
        return (allowed, denied)
    }
}

// MARK: - Scoring and decision

enum RoutingDecision: Equatable, Sendable {
    /// Clear margin: safe to act on.
    case clear(vehicleID: String, confidence: Double, reasons: [String])
    /// A lead for the owner's quick review, never filed.
    case review(vehicleID: String, confidence: Double, reasons: [String])
    case none(reasons: [String])
}

enum CandidateRouter {
    static let fileThreshold = 0.85
    static let fileMargin = 0.25
    static let adjacencyWindow: TimeInterval = 40 * 60

    /// Identifier boundary for one photo: the vehicles named by the nearest identifier read before
    /// and after it in the shoot. Nil when the shoot has no identifier read.
    static func identifierBoundary(for photo: RoutingPhoto, in shoot: [RoutingPhoto]) -> Set<String>? {
        guard let t = photo.takenAt else { return nil }
        let anchors = shoot.filter { $0.identifierVehicleID != nil && $0.takenAt != nil }
        guard !anchors.isEmpty else { return nil }
        let before = anchors.filter { $0.takenAt! <= t }.max { $0.takenAt! < $1.takenAt! }
        let after = anchors.filter { $0.takenAt! >= t }.min { $0.takenAt! < $1.takenAt! }
        return Set([before?.identifierVehicleID, after?.identifierVehicleID].compactMap { $0 })
    }

    /// 1 at the anchor, falling linearly to 0 at 40 min. Identifier anchors count fully, filed
    /// photos (a weaker, possibly wrong anchor) at 0.75.
    static func adjacency(_ photo: RoutingPhoto, vehicleID: String, in shoot: [RoutingPhoto]) -> (Double, String?) {
        guard let t = photo.takenAt else { return (0, nil) }
        var best: (Double, String?) = (0, nil)
        for a in shoot where a.id != photo.id {
            guard let ta = a.takenAt else { continue }
            let weight: Double
            if a.identifierVehicleID == vehicleID { weight = 1 } else if a.filedVehicleID == vehicleID { weight = 0.75 } else { continue }
            let s = weight * max(0, 1 - abs(t.timeIntervalSince(ta)) / adjacencyWindow)
            if s > best.0 { best = (s, "anchor=\(a.id) dt=\(Int(abs(t.timeIntervalSince(ta))))s") }
        }
        return best
    }

    static func score(_ photo: RoutingPhoto, _ c: RoutingCandidate, in shoot: [RoutingPhoto]) -> (Double, [String]) {
        let (adj, cite) = adjacency(photo, vehicleID: c.vehicleID, in: shoot)
        var s = 0.8 * adj
        var reasons: [String] = cite.map { ["time_adjacency=\(String(format: "%.2f", adj))", $0] } ?? []
        if c.activeThatDay { s += 0.15; reasons.append("active_that_day") }
        if c.albumMapped { s += 0.15; reasons.append("album_map") }
        if c.recentAtLocation { s += 0.05; reasons.append("recent_at_location") }
        if c.bodyClass != .unknown && c.bodyClass == BodyClass.ofLabels(photo.labels) { s += 0.05; reasons.append("body_class_fit") }
        return (min(1, s), reasons)
    }

    static func decide(_ photo: RoutingPhoto, shoot: [RoutingPhoto], candidates: [RoutingCandidate],
                       constraints: [any CandidateConstraint] = ConstraintLayer.standard) -> RoutingDecision {
        guard photo.kind == .work else { return .none(reasons: ["candidate_set_v1", "skipped:\(photo.kind.rawValue)"]) }
        let subject = ConstraintSubject(at: photo.takenAt, bodyClass: BodyClass.ofLabels(photo.labels),
                                        identifierBoundary: identifierBoundary(for: photo, in: shoot))
        let (allowed, denied) = ConstraintLayer.filter(subject, candidates, constraints: constraints)
        let scored = allowed.map { pair -> (RoutingCandidate, Double, [String]) in
            let (s, r) = score(photo, pair.0, in: shoot)
            return (pair.0, s, pair.1 + r)
        }.sorted { ($0.1, $1.0.vehicleID) > ($1.1, $0.0.vehicleID) }
        let base = ["candidate_set_v1", "candidates=\(candidates.count)", "allowed=\(allowed.count)"] + denied.map { "denied " + $0 }
        guard let top = scored.first, top.1 > 0 else { return .none(reasons: base + ["no_scored_candidate"]) }
        let runnerUp = scored.dropFirst().first?.1 ?? 0
        let margin = top.1 - runnerUp
        let reasons = base + top.2 + ["score=\(String(format: "%.2f", top.1))", "margin=\(String(format: "%.2f", margin))"]
        if top.1 >= fileThreshold && margin >= fileMargin {
            return .clear(vehicleID: top.0.vehicleID, confidence: top.1, reasons: reasons + ["clear_margin"])
        }
        return .review(vehicleID: top.0.vehicleID, confidence: top.1, reasons: reasons + ["needs_review"])
    }
}

extension RoutingDecision {
    var isClear: Bool { if case .clear = self { return true }; return false }
    /// The vehicle, confidence and citations of a clear or review lead; nil for none.
    var lead: (String, Double, [String])? {
        switch self {
        case .clear(let v, let c, let r), .review(let v, let c, let r): return (v, c, r)
        case .none: return nil
        }
    }
}
