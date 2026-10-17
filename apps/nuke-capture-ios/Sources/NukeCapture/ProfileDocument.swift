// ProfileDocument.swift — the kit's shapes, in Swift.
//
// The web has `nuke_frontend/src/kit/types.ts`: the only shapes a page may render. This file is
// the same contract for the phone. `vehicle_profile_read(uuid)` (migration 20261013143000) returns
// one ProfileRead: every fact is a Claim with its source, clock and trust, and every strip states
// its Coverage (n of N, as of a clock). A raw column has no way onto a screen without becoming a
// Claim; a number has no way onto a screen without its Coverage. The read is SECURITY INVOKER, so
// the viewer's own row policies decide what the document carries: the app never reasons about
// which table a fact came from, and never widens what the database let it see.
//
// Keep this file in step with kit/types.ts. When the read grows a section (gallery, timeline,
// measures), add its case here and render it through the same primitives; never add a second
// client-side query for something the document should carry.

import Foundation

/// Who the database says is reading: decided by auth.uid() inside the read, never by the client.
/// A viewer value the app does not know fails closed to anon.
enum ProfileViewer: String, Decodable {
    case anon, contributor, owner
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ProfileViewer(rawValue: raw) ?? .anon
    }
}

/// Optional broadcast / auction video moment for a sale claim (`kit/types.ts` #1823).
struct SaleVideoMoment: Decodable, Equatable {
    var url: String? = nil
    var startSeconds: Int? = nil
    var endSeconds: Int? = nil
    var lotNumber: String? = nil
    var auctionName: String? = nil
    var searchQuery: String? = nil
    var lotUrl: String? = nil
    var title: String? = nil
    var priceText: String? = nil
    var imageUrl: String? = nil

    private enum CodingKeys: String, CodingKey {
        case url
        case startSeconds, start_seconds
        case endSeconds, end_seconds
        case lotNumber, lot_number
        case auctionName, auction_name
        case searchQuery, search_query
        case lotUrl, lot_url
        case title
        case priceText, price_text
        case imageUrl, image_url
    }

    init(
        url: String? = nil,
        startSeconds: Int? = nil,
        endSeconds: Int? = nil,
        lotNumber: String? = nil,
        auctionName: String? = nil,
        searchQuery: String? = nil,
        lotUrl: String? = nil,
        title: String? = nil,
        priceText: String? = nil,
        imageUrl: String? = nil
    ) {
        self.url = url
        self.startSeconds = startSeconds
        self.endSeconds = endSeconds
        self.lotNumber = lotNumber
        self.auctionName = auctionName
        self.searchQuery = searchQuery
        self.lotUrl = lotUrl
        self.title = title
        self.priceText = priceText
        self.imageUrl = imageUrl
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.url = try? c.decodeIfPresent(String.self, forKey: .url)
        self.startSeconds = (try? c.decodeIfPresent(Int.self, forKey: .startSeconds))
            ?? (try? c.decodeIfPresent(Int.self, forKey: .start_seconds))
        self.endSeconds = (try? c.decodeIfPresent(Int.self, forKey: .endSeconds))
            ?? (try? c.decodeIfPresent(Int.self, forKey: .end_seconds))
        self.lotNumber = (try? c.decodeIfPresent(String.self, forKey: .lotNumber))
            ?? (try? c.decodeIfPresent(String.self, forKey: .lot_number))
        self.auctionName = (try? c.decodeIfPresent(String.self, forKey: .auctionName))
            ?? (try? c.decodeIfPresent(String.self, forKey: .auction_name))
        self.searchQuery = (try? c.decodeIfPresent(String.self, forKey: .searchQuery))
            ?? (try? c.decodeIfPresent(String.self, forKey: .search_query))
        self.lotUrl = (try? c.decodeIfPresent(String.self, forKey: .lotUrl))
            ?? (try? c.decodeIfPresent(String.self, forKey: .lot_url))
        self.title = try? c.decodeIfPresent(String.self, forKey: .title)
        self.priceText = (try? c.decodeIfPresent(String.self, forKey: .priceText))
            ?? (try? c.decodeIfPresent(String.self, forKey: .price_text))
        self.imageUrl = (try? c.decodeIfPresent(String.self, forKey: .imageUrl))
            ?? (try? c.decodeIfPresent(String.self, forKey: .image_url))
    }

    /// Formats `startSeconds` as `m:ss` or `h:mm:ss` (`Claim.tsx`).
    var startLabel: String? {
        guard let s = startSeconds, s >= 0 else { return nil }
        let h = s / 3600
        let m = (s % 3600) / 60
        let sec = s % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, sec) }
        return String(format: "%d:%02d", m, sec)
    }

    /// Resolves a direct or YouTube watch URL (`https://www.youtube.com/watch?v=...&t=...`) when `url` is a URL or 11-char YouTube ID.
    var watchableURL: URL? {
        guard let raw = url?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        if raw.lowercased().hasPrefix("http"), var comps = URLComponents(string: raw) {
            if let s = startSeconds, s > 0, comps.host?.contains("youtube.com") == true || comps.host?.contains("youtu.be") == true {
                var items = comps.queryItems ?? []
                if !items.contains(where: { $0.name == "t" || $0.name == "start" }) {
                    items.append(URLQueryItem(name: "t", value: "\(s)s"))
                    comps.queryItems = items
                }
            }
            return comps.url
        }
        // Bare 11-char YouTube video ID
        let idChars = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
        if raw.count == 11, raw.unicodeScalars.allSatisfy({ idChars.contains($0) }) {
            var s = "https://www.youtube.com/watch?v=\(raw)"
            if let start = startSeconds, start > 0 { s += "&t=\(start)s" }
            return URL(string: s)
        }
        return nil
    }
}

/// Where a claim came from: the evidence class, and a pointer at the evidence.
struct ClaimSource: Decodable, Equatable {
    /// An evidence class the app does not know is read as the record (legacy), dim and open,
    /// never as a reason to drop the whole document.
    enum Kind: String, Decodable, Equatable {
        case listing, owner, image, document, agent, model, legacy
        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Kind(rawValue: raw) ?? .legacy
        }
        /// The web's SOURCE_KIND_LABEL, used when a source carries no label of its own.
        var displayName: String {
            switch self {
            case .listing: return "Listing"
            case .owner: return "Owner"
            case .image: return "Image"
            case .document: return "Document"
            case .agent: return "Agent"
            case .model: return "Model"
            case .legacy: return "Legacy record"
            }
        }
    }
    let kind: Kind
    var url: String?
    let id: String?
    let method: String?
    let label: String?
    var logoUrl: String? = nil
    var lotNumber: String? = nil
    var auctionName: String? = nil
    var video: SaleVideoMoment? = nil

    private enum CodingKeys: String, CodingKey {
        case kind, url, id, method, label, name, video
        case logoUrl, logo_url
        case lotNumber, lot_number
        case auctionName, auction_name
    }

    init(
        kind: Kind,
        url: String? = nil,
        id: String? = nil,
        method: String? = nil,
        label: String? = nil,
        logoUrl: String? = nil,
        lotNumber: String? = nil,
        auctionName: String? = nil,
        video: SaleVideoMoment? = nil
    ) {
        self.kind = kind
        self.url = url
        self.id = id
        self.method = method
        self.label = label
        self.logoUrl = logoUrl
        self.lotNumber = lotNumber
        self.auctionName = auctionName
        self.video = video
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.kind = (try? c.decode(Kind.self, forKey: .kind)) ?? .legacy
        self.url = try? c.decodeIfPresent(String.self, forKey: .url)
        self.id = try? c.decodeIfPresent(String.self, forKey: .id)
        self.method = try? c.decodeIfPresent(String.self, forKey: .method)
        self.label = (try? c.decodeIfPresent(String.self, forKey: .label))
            ?? (try? c.decodeIfPresent(String.self, forKey: .name))
        self.logoUrl = (try? c.decodeIfPresent(String.self, forKey: .logoUrl))
            ?? (try? c.decodeIfPresent(String.self, forKey: .logo_url))
        self.lotNumber = (try? c.decodeIfPresent(String.self, forKey: .lotNumber))
            ?? (try? c.decodeIfPresent(String.self, forKey: .lot_number))
        self.auctionName = (try? c.decodeIfPresent(String.self, forKey: .auctionName))
            ?? (try? c.decodeIfPresent(String.self, forKey: .auction_name))
        self.video = try? c.decodeIfPresent(SaleVideoMoment.self, forKey: .video)
    }

    /// A URL only when it is one the phone can open; the read ships listing URLs, never storage keys.
    var openableURL: URL? {
        guard let url, url.lowercased().hasPrefix("http") else { return nil }
        return URL(string: url)
    }

    var effectiveLotNumber: String? {
        if let lotNumber, !lotNumber.isEmpty { return lotNumber }
        if let vLot = video?.lotNumber, !vLot.isEmpty { return vLot }
        return nil
    }

    var effectiveAuctionName: String? {
        if let auctionName, !auctionName.isEmpty { return auctionName }
        if let vName = video?.auctionName, !vName.isEmpty { return vName }
        return nil
    }

    var lotLine: String? {
        let parts = [
            effectiveLotNumber.map { "Lot \($0)" },
            effectiveAuctionName
        ].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// A claim's value is a JSON scalar: the read puts strings and numbers in it.
enum ClaimValue: Decodable {
    case string(String)
    case number(Double)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let b = try? c.decode(Bool.self) { self = .string(b ? "yes" : "no"); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Claim value is not a scalar")
    }

    var number: Double? { if case .number(let n) = self { return n } else { return nil } }
    var text: String {
        switch self {
        case .string(let s): return s
        case .number(let n):
            // A whole number prints without a fraction; never through Int(n), which traps past Int range.
            if n.isFinite, n == n.rounded(), abs(n) < 1e15 { return n.formatted(.number.precision(.fractionLength(0)).grouping(.never)) }
            return String(n)
        }
    }
}

/// One attributed fact: a value, who said it, when it was observed, how far to trust it (0 to 1).
struct Claim: Decodable {
    let value: ClaimValue
    let unit: String?
    var source: ClaimSource
    var observed_at: String?
    let trust: Double

    /// Trust as the web shows it: a whole percentage, clamped.
    var trustPercent: Int { Int((min(1, max(0, trust)) * 100).rounded()) }

    /// The claim on the app's one trust ladder (RootedValue.swift), as the web's ClaimView treats
    /// it: every claim opens to its source and trust. A legacy claim is the record itself, dim but
    /// open; an attributed claim carries a source; a model output is projected. Nothing is "proven"
    /// from the read alone: the read does not say a row was owner-confirmed, so no seal is filled.
    var rootStatus: RootStatus {
        switch source.kind {
        case .owner, .document, .listing, .image, .agent: return .attributed
        case .model: return .projected
        case .legacy: return .recorded
        }
    }

    /// The line under a value: the observed day when the claim carries a clock, and for a legacy
    /// value the record it is and its trust, since no observation stands beneath it.
    var decayLine: String? {
        let day = ProfileClock.day(observed_at)
        if source.kind == .legacy {
            return [source.label ?? "legacy record", day, "trust \(trustPercent)%"].compactMap { $0 }.joined(separator: " · ")
        }
        return day
    }

    /// The source line of the web's SourceView: the label the read gave, or the class name, then the method.
    var sourceLine: String {
        let base = source.label?.isEmpty == false ? source.label! : source.kind.displayName
        if let m = source.method, !m.isEmpty, m != source.label { return "\(base) · \(m)" }
        return base
    }

    /// True when this claim represents an auction sale or carries a broadcast video moment (`Claim.tsx`).
    var isAuctionSaleClaim: Bool {
        if source.video != nil { return true }
        if source.method == "sold" || unit == "USD" {
            let combined = "\(source.label ?? "") \(source.url ?? "")".lowercased()
            let knownHouses = ["mecum", "bring a trailer", "bringatrailer", "bat", "cars & bids", "cars and bids", "carsandbids", "rm sotheby", "rmsothebys", "gooding", "bonhams", "broad arrow", "broadarrow", "sbx", "barrett"]
            if knownHouses.contains(where: { combined.contains($0) }) || source.effectiveLotNumber != nil {
                return true
            }
        }
        return false
    }

    /// Fallback YouTube search URL for finding the auction sale broadcast moment (`Claim.tsx`).
    func youtubeSearchURL(vehicleTitle: String? = nil) -> URL? {
        let sourceName = source.label?.isEmpty == false ? source.label! : source.kind.displayName
        let q: String
        if let sq = source.video?.searchQuery, !sq.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            q = sq
        } else {
            q = [
                sourceName,
                source.effectiveAuctionName,
                source.effectiveLotNumber.map { "Lot \($0)" },
                source.video?.title ?? vehicleTitle,
                "auction sold"
            ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        }
        var comps = URLComponents(string: "https://www.youtube.com/results")
        comps?.queryItems = [URLQueryItem(name: "search_query", value: q)]
        return comps?.url
    }
}

/// The denominator every number carries: n of `of` members of `grain`, as of a clock.
struct Coverage: Decodable {
    let n: Int
    let of: Int
    let grain: String
    let as_of: String?

    /// The web CoverageView's sentence: "1 of 5 facts attributed · as of Jun 23, 2026".
    var sentence: String {
        "\(n.formatted()) of \(of.formatted()) \(grain) · as of \(ProfileClock.day(as_of) ?? "unknown date")"
    }
}

/// A computed number with its method and coverage. A rank renders only above the floor.
struct Measure: Decodable {
    struct Rank: Decodable { let p: Double; let n: Int }
    let label: String
    let value: Double
    let unit: String
    let method: String
    let coverage: Coverage
    let rank: Rank?

    /// Equal to the kit's RANK_FLOOR and the stacks' MIN_DISTRIBUTION: fewer measured peers and no percentile is shown.
    static let rankFloor = 5

    /// "P62" only when enough peers were measured; otherwise nil, never a number.
    var rankLabel: String? {
        guard let rank, rank.n >= Self.rankFloor, rank.p.isFinite else { return nil }
        return "P\(Int(min(100, max(0, rank.p)).rounded()))"
    }
}

/// A gallery image the read admitted. `gate` is typed as the one value the kit allows, so an
/// image the vision gate did not approve cannot exist in a document.
struct GalleryImageDoc: Decodable {
    let id: String
    let url: String
    let taken_at: String?
    let gate: String
    var isApproved: Bool { gate == "approved" }
}

/// The masthead as the read ships it: raw identity columns for the client's display hygiene.
struct IdentitySource: Decodable {
    let year: Int?
    let make: String?
    let model: String?
    let normalized_model: String?
    let series: String?
    let trim: String?
    let transmission: String?
    let transmission_model: String?
}

/// One section of the document. Unknown kinds decode to `.unknown` and render nothing: a newer
/// read never breaks an older app, and an older read never makes the app invent a section.
enum ProfileSection: Decodable {
    struct Masthead: Decodable {
        let identity_source: IdentitySource
        let year: Int?
        let make: String?
        let model: String?
        let price: Claim?
        let priceLabel: String?
    }
    struct Facet: Decodable {
        let dimension: String
        let label: String
        let member: Claim
    }
    struct Strip: Decodable {
        let coverage: Coverage
        let facets: [Facet]
        let odometer: Claim?
    }
    struct Measures: Decodable {
        let stack: String
        let title: String
        let coverage: Coverage
        let items: [Measure]
    }
    struct TimelineDay: Decodable {
        let day: String
        let kinds: [String: Int]
    }
    struct Timeline: Decodable {
        let coverage: Coverage
        let days: [TimelineDay]
    }
    struct Table: Decodable {
        let title: String
        let coverage: Coverage
        let columns: [String]
        let rows: [[Claim]]
    }
    struct Gallery: Decodable {
        let coverage: Coverage
        let images: [GalleryImageDoc]
    }

    case masthead(Masthead)
    case strip(Strip)
    case measures(Measures)
    case timeline(Timeline)
    case table(Table)
    case gallery(Gallery)
    case unknown(kind: String)

    private enum KindKey: String, CodingKey { case kind }

    init(from decoder: Decoder) throws {
        let kind = try decoder.container(keyedBy: KindKey.self).decode(String.self, forKey: .kind)
        let body = try decoder.singleValueContainer()
        switch kind {
        case "masthead": self = .masthead(try body.decode(Masthead.self))
        case "strip": self = .strip(try body.decode(Strip.self))
        case "measures": self = .measures(try body.decode(Measures.self))
        case "timeline": self = .timeline(try body.decode(Timeline.self))
        case "table": self = .table(try body.decode(Table.self))
        case "gallery": self = .gallery(try body.decode(Gallery.self))
        default: self = .unknown(kind: kind)
        }
    }
}

/// The seller or auction description carried by `vehicle_profile_read` (`profileDocument.ts`).
struct ProfileDescription: Decodable, Equatable {
    let text: String
    let length: Int
    let source: ClaimSource
    let observed_at: String?
}

/// Full-record testimony counts returned by `vehicle_testimony_summary(p_vehicle_id)`.
struct VehicleTestimonySummary: Decodable, Equatable {
    let total: Int
    let events: Int
    let images: Int
    let observations: Int
    let documents: Int
    let service: Int

    var sentence: String {
        var parts: [String] = []
        if events > 0 { parts.append("\(events.formatted()) \(events == 1 ? "event" : "events")") }
        if images > 0 { parts.append("\(images.formatted()) \(images == 1 ? "photo" : "photos")") }
        if observations > 0 { parts.append("\(observations.formatted()) \(observations == 1 ? "observation" : "observations")") }
        if documents > 0 { parts.append("\(documents.formatted()) \(documents == 1 ? "document" : "documents")") }
        if service > 0 { parts.append("\(service.formatted()) service") }
        let breakdown = parts.isEmpty ? "" : " (\(parts.joined(separator: " · ")))"
        return "\(total.formatted()) testimony items\(breakdown)"
    }
}

/// One page, as a document: sections in the order the data supports, for one viewer, at one clock.
struct ProfileRead: Decodable {
    let vehicle_id: String
    let viewer: ProfileViewer
    let read_at: String
    let sections: [ProfileSection]
    let description: ProfileDescription?

    var masthead: ProfileSection.Masthead? {
        for s in sections { if case .masthead(let m) = s { return m } }
        return nil
    }
    var strip: ProfileSection.Strip? {
        for s in sections { if case .strip(let st) = s { return st } }
        return nil
    }
    var timeline: ProfileSection.Timeline? {
        for s in sections { if case .timeline(let t) = s { return t } }
        return nil
    }
}

/// Clocks as the kit prints them: short month, day, year, in UTC. nil when the clock is missing or unparseable.
enum ProfileClock {
    private static let out: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMM d, yyyy"
        return f
    }()
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let plain = ISO8601DateFormatter()

    static func date(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        // Postgres prints "+00:00" with microseconds; ISO8601DateFormatter accepts up to fractional seconds.
        let trimmed = iso.replacingOccurrences(of: #"(\.\d{3})\d+"#, with: "$1", options: .regularExpression)
        return fractional.date(from: trimmed) ?? plain.date(from: trimmed)
    }

    static func day(_ iso: String?) -> String? {
        date(iso).map { out.string(from: $0) }
    }

    static func Absolute(_ iso: String?) -> String {
        day(iso) ?? iso ?? "unknown date"
    }
}
