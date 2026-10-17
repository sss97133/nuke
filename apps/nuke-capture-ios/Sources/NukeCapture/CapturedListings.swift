// CapturedListings.swift — the retained classified listings, read the way the web reads them.
//
// nuke.ag's Market tab "Captured listings" (nuke_frontend/src/pages/market/useCapturedListings.ts,
// #994) is a direct read of vehicle_events by source platform, newest retained first, with the
// public parent vehicle joined for identity and image. There is no RPC and no reader-level clock:
// each row carries its own capture clocks (created_at, the source's observed time when retained).
// This file is that read on the phone, with the same sources, the same page size and the same
// acceptance rule (a row needs a public parent, or an unresolved row needs a source URL that is a
// real listing path on the platform's own host). Nothing is counted that the web does not count.

import Foundation
import SwiftUI
import Supabase

struct CapturedListing: Decodable, Identifiable {
    let id: String
    let vehicle_id: String?
    let source_platform: String
    let source_listing_id: String?
    let source_url: String?
    let current_price: Double?
    let event_status: String?
    let created_at: String?
    let updated_at: String?
    let source_observed_at: String?
    var vehicle: Parent?

    struct Parent: Decodable {
        let id: String
        let year: Int?
        let make: String?
        let model: String?
        let primary_image_url: String?
    }

    /// The source's own clock when it was retained, else the capture clock.
    var clock: String? { source_observed_at ?? created_at }

    var headline: String {
        if let v = vehicle {
            let s = [v.year.map(String.init), v.make, v.model].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            if !s.isEmpty { return s }
        }
        return "Unresolved \(CapturedListings.sourceName(source_platform)) listing"
    }

    /// The listing page on the platform's own host, or nil (web sourceLink rule).
    var sourceLink: URL? { CapturedListings.sourceLink(platform: source_platform, value: source_url) }
}

enum CapturedListings {
    static let classifiedSources = ["craigslist", "facebook_marketplace", "ksl"]
    static let pageSize = 50

    private static let names: [String: String] = [
        "craigslist": "Craigslist", "facebook_marketplace": "Facebook Marketplace", "ksl": "KSL",
        "bat": "Bring a Trailer", "bring_a_trailer": "Bring a Trailer", "cars_and_bids": "Cars & Bids",
        "mecum": "Mecum", "barrett_jackson": "Barrett-Jackson", "barrettjackson": "Barrett-Jackson",
    ]
    static func sourceName(_ platform: String) -> String { names[platform] ?? platform }

    private static let hosts: [String: String] = [
        "craigslist": "craigslist.org", "facebook_marketplace": "facebook.com", "ksl": "ksl.com",
        "bat": "bringatrailer.com", "bring_a_trailer": "bringatrailer.com", "cars_and_bids": "carsandbids.com",
        "mecum": "mecum.com", "barrettjackson": "barrett-jackson.com", "barrett_jackson": "barrett-jackson.com",
    ]
    private static let paths: [String: String] = [
        "craigslist": #"^(?:/view/d/[\w-]+/[a-zA-Z0-9]+|/\w+/d/[\w-]+/\d+\.html)/?$"#,
        "facebook_marketplace": #"^/marketplace/item/\d+/?$"#,
        "ksl": #"^/listing/\d+/?$"#,
        "bat": #"^/listing/[\w-]+/?$"#, "bring_a_trailer": #"^/listing/[\w-]+/?$"#,
        "cars_and_bids": #"^/auctions/[\w-]+(?:/[\w-]+)?/?$"#,
        "mecum": #"^/lots/\d+/[\w-]+/?$"#,
        "barrettjackson": #"^/[\w-]+/docket/vehicle/[\w-]+/?$"#, "barrett_jackson": #"^/[\w-]+/docket/vehicle/[\w-]+/?$"#,
    ]

    /// A host alone cannot qualify an unresolved row; the path must be a listing path too.
    static func sourceLink(platform: String, value: String?) -> URL? {
        guard let value, let url = URL(string: value), let host = hosts[platform], let pattern = paths[platform],
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.user == nil, url.password == nil, url.port == nil, url.query == nil, url.fragment == nil,
              let hostname = url.host?.lowercased(), hostname == host || hostname.hasSuffix("." + host),
              url.path.range(of: pattern, options: .regularExpression) != nil else { return nil }
        return url
    }

    /// One page, newest retained first: the events, then their public parents.
    static func read() async throws -> [CapturedListing] {
        var rows: [CapturedListing] = try await SupabaseService.client
            .from("vehicle_events")
            .select("id,vehicle_id,source_platform,source_listing_id,source_url,current_price,event_status,created_at,updated_at,source_observed_at:metadata->>source_observed_at")
            .in("source_platform", values: classifiedSources)
            .order("created_at", ascending: false, nullsFirst: false)
            .order("id", ascending: false)
            .limit(pageSize)
            .execute().value
        let ids = Array(Set(rows.compactMap(\.vehicle_id)))
        var parents: [String: CapturedListing.Parent] = [:]
        if !ids.isEmpty {
            let vehicles: [CapturedListing.Parent] = try await SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,primary_image_url")
                .in("id", values: ids)
                .eq("is_public", value: true)
                .is("deleted_at", value: nil)
                .or("listing_kind.is.null,listing_kind.neq.non_vehicle_item")
                .limit(pageSize)
                .execute().value
            for v in vehicles { parents[v.id] = v }
        }
        rows = rows.filter { row in
            if let vid = row.vehicle_id { return parents[vid] != nil }
            return row.sourceLink != nil
        }
        for i in rows.indices { if let vid = rows[i].vehicle_id { rows[i].vehicle = parents[vid] } }
        return rows
    }
}

// MARK: - Classified Ask Board (useAskBoard.ts + askPosition.ts + ClassifiedArrivals.tsx twin)

enum AskWindow: Int, CaseIterable, Identifiable {
    case h24 = 24
    case d3 = 72
    case d7 = 168
    var id: Int { rawValue }
    var label: String {
        switch self {
        case .h24: return "24h"
        case .d3: return "3d"
        case .d7: return "7d"
        }
    }
}

enum AskTier: String, CaseIterable, Identifiable {
    case under_5k
    case t5k_15k = "5k_15k"
    case t15k_40k = "15k_40k"
    case t40k_100k = "40k_100k"
    case t100k_plus = "100k_plus"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .under_5k: return "<$5k"
        case .t5k_15k: return "$5k–$15k"
        case .t15k_40k: return "$15k–$40k"
        case .t40k_100k: return "$40k–$100k"
        case .t100k_plus: return "$100k+"
        }
    }
}

enum AskSort: String, CaseIterable, Identifiable {
    case newest
    case position
    case price
    case band
    var id: String { rawValue }
    var label: String {
        switch self {
        case .newest: return "Newest"
        case .position: return "Lowest vs family"
        case .price: return "Price"
        case .band: return "With band"
        }
    }
}

struct AskPosition: Decodable, Equatable {
    let family: String
    let cohort: String
    let match: String // "year" | "decade"
    let sales: Int
    let p25: Double
    let p50: Double
    let p75: Double
    let ratio: Double?
    let rank: String // "below_p25" | "Below_p50" | "below_p50" | "above_p50" | "above_p75"
    let median_miles: Double?
    let share_36m: Double?
    let houses: [String: Int]?
}

struct AskRow: Decodable, Equatable, Identifiable {
    let event_id: String
    let vehicle_id: String?
    let source: String
    let url: String?
    let seen_at: String
    let year: Int?
    let make: String?
    let model: String?
    let title: String?
    let ask: Double
    let miles: Double?
    let odometer: String? // "broken" | "rolled_over" | "exempt"
    let condition: String?
    let title_status: String?
    let image: String?
    let location: String?
    let position: AskPosition?

    var id: String { event_id }

    var vehicleUUID: UUID? { vehicle_id.flatMap(UUID.init(uuidString:)) }

    var headline: String {
        let structured = [year.map(String.init), make, model].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        if !structured.isEmpty { return structured }
        if let t = title?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty { return t }
        return "Classified listing"
    }

    var sourceLink: URL? {
        CapturedListings.sourceLink(platform: source, value: url)
    }

    /// Mirrors `listingFacts(row)` in `ClassifiedArrivals.tsx`:
    /// A broken odometer means the number on the clock is not the car's mileage; say so instead of showing the reading.
    var listingFacts: String {
        var parts: [String] = []
        if odometer == "broken" {
            parts.append("odometer broken")
        } else if let m = miles, m > 0 {
            let rolled = odometer == "rolled_over" ? ", rolled over" : ""
            parts.append("\(Int(m.rounded()).formatted()) mi\(rolled)")
        }
        if let ts = title_status, !ts.isEmpty, ts != "clean" {
            parts.append("\(ts) title")
        }
        if let cond = condition, !cond.isEmpty {
            parts.append(cond)
        }
        return parts.joined(separator: " · ")
    }
}

struct AskPopulation: Decodable, Equatable {
    let listings: Int
    let filtered: Int?
    let with_position: Int
    let below_p25: Int
    let by_source: [String: Int]
    let by_tier: [String: Int]?
    let median_ask: Double?
    let newest_seen_at: String?
}

struct AskPricePopulation: Decodable, Equatable {
    let measure: String
    let refreshed_at: String?
    let sales: Int
    let families: Int
}

struct AskBoard: Decodable, Equatable {
    let as_of: String
    let window_hours: Int
    let tier: String?
    let sort: String?
    let population: AskPopulation
    let price_population: AskPricePopulation?
    let rows: [AskRow]

    private struct Params: Encodable {
        let p_hours: Int
        let p_make: String?
        let p_limit: Int
        let p_tier: String?
        let p_sort: String
    }

    static func fetch(hours: Int = 72, make: String? = nil, tier: AskTier? = nil, sort: AskSort = .newest, limit: Int = 80) async throws -> AskBoard {
        try await SupabaseService.client
            .rpc("classified_ask_board", params: Params(
                p_hours: hours,
                p_make: make,
                p_limit: limit,
                p_tier: tier?.rawValue,
                p_sort: sort.rawValue
            ))
            .execute()
            .value
    }
}

struct AskPlacement: Equatable {
    enum Tone: String, Equatable {
        case below
        case within
        case above
    }

    let headline: String
    let spreadLine: String
    let milesLine: String?
    let venuesLine: String?
    let tone: Tone
    let askFrac: Double
    let p25Frac: Double
    let p50Frac: Double
    let p75Frac: Double

    static let venueNames: [String: String] = [
        "bat": "BaT",
        "bring_a_trailer": "BaT",
        "cars_and_bids": "Cars & Bids",
        "mecum": "Mecum",
        "barrett_jackson": "Barrett-Jackson",
        "barrettjackson": "Barrett-Jackson",
        "rm_sothebys": "RM Sotheby's",
        "rmsothebys": "RM Sotheby's",
        "gooding": "Gooding",
        "bonhams": "Bonhams",
        "hagerty": "Hagerty",
        "pcarmarket": "PCarMarket",
        "collecting_cars": "Collecting Cars",
        "broad_arrow": "Broad Arrow",
        "hemmings": "Hemmings"
    ]

    static func dollars(_ n: Double) -> String {
        guard n.isFinite else { return "—" }
        return "$" + Int(n.rounded()).formatted()
    }

    static func formatHouses(_ houses: [String: Int]?) -> String? {
        guard let houses, !houses.isEmpty else { return nil }
        let entries = houses.filter { $0.value > 0 }.sorted {
            if $0.value != $1.value { return $0.value > $1.value }
            return $0.key < $1.key
        }
        guard !entries.isEmpty else { return nil }
        let top = entries.prefix(3).map { k, n in
            "\(venueNames[k] ?? k) (\(n.formatted()))"
        }
        let rest = entries.dropFirst(3).reduce(0) { $0 + $1.value }
        let parts = rest > 0 ? top + ["+\(rest.formatted()) more"] : top
        return parts.joined(separator: ", ")
    }

    /// Pure function turning a row's `position` + `ask` into the lines and strip coordinates shown on the card (`askPosition.ts`).
    static func placement(pos: AskPosition?, ask: Double) -> AskPlacement? {
        guard let pos,
              pos.sales >= 5,
              pos.p25.isFinite, pos.p50.isFinite, pos.p75.isFinite,
              pos.p25 > 0, pos.p50 > 0, pos.p75 > 0,
              pos.p25 <= pos.p50, pos.p50 <= pos.p75,
              ask.isFinite, ask > 0 else { return nil }

        let cohort = "\(pos.cohort) \(pos.family)"
        let diff = (ask - pos.p50) / pos.p50
        let pct = Int((abs(diff) * 100.0).rounded())

        let tone: Tone = ask < pos.p25 ? .below : (ask > pos.p75 ? .above : .within)
        let headline: String
        if pct < 3 {
            headline = "At the \(cohort) median (\(dollars(pos.p50)))"
        } else if diff < 0 {
            headline = "\(pct)% below the \(cohort) median (\(dollars(pos.p50)))"
        } else {
            headline = "\(pct)% above the \(cohort) median (\(dollars(pos.p50)))"
        }

        let recentBit: String
        if let s36 = pos.share_36m, s36.isFinite, s36 > 0 {
            recentBit = " (\(Int((s36 * 100.0).rounded()))% in last 3 yrs)"
        } else {
            recentBit = ""
        }
        let spreadLine = "Typical spread \(dollars(pos.p25))–\(dollars(pos.p75)) across \(pos.sales.formatted()) sales\(recentBit)"

        let milesLine: String?
        if let mm = pos.median_miles, mm.isFinite, mm > 0 {
            milesLine = "Sold median \(Int(mm.rounded()).formatted()) mi"
        } else {
            milesLine = nil
        }

        let venuesLine = formatHouses(pos.houses).map { "Recorded on \($0)" }

        let lo = min(pos.p25, ask) * 0.85
        let hi = max(pos.p75, ask) * 1.1
        let span = max(hi - lo, 1)
        func frac(_ v: Double) -> Double {
            min(1, max(0, (v - lo) / span))
        }

        return AskPlacement(
            headline: headline,
            spreadLine: spreadLine,
            milesLine: milesLine,
            venuesLine: venuesLine,
            tone: tone,
            askFrac: frac(ask),
            p25Frac: frac(pos.p25),
            p50Frac: frac(pos.p50),
            p75Frac: frac(pos.p75)
        )
    }
}

/// Visual strip placing the ask against the family cohort's p25–p75 sold band and p50 median (`ClassifiedArrivals.tsx`).
struct AskPriceStripView: View {
    let place: AskPlacement

    private var dotColor: Color {
        switch place.tone {
        case .below: return .green
        case .within: return .primary
        case .above: return .orange
        }
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let bandX = w * place.p25Frac
            let bandW = max(2, w * (place.p75Frac - place.p25Frac))
            let medX = w * place.p50Frac
            let askX = w * place.askFrac
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color(.tertiarySystemFill))
                    .frame(height: 4)
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(.secondaryLabel).opacity(0.32))
                    .frame(width: bandW, height: 6)
                    .offset(x: bandX)
                Rectangle()
                    .fill(Color(.label).opacity(0.75))
                    .frame(width: 1.5, height: 10)
                    .offset(x: medX)
                Circle()
                    .fill(dotColor)
                    .frame(width: 8, height: 8)
                    .offset(x: max(0, min(w - 8, askX - 4)))
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 12)
        .accessibilityHidden(true)
    }
}

/// The captured classified listings read via `classified_ask_board` (`ClassifiedArrivals.tsx`),
/// placing each asking price against its family's sold price band (`mv_family_year_prices`),
/// with fallback to raw `CapturedListings.read()` if the RPC is unavailable.
struct CapturedListingsView: View {
    @State private var askBoard: AskBoard?
    @State private var fallbackRows: [CapturedListing]?
    @State private var window: AskWindow = .d3
    @State private var tier: AskTier? = nil
    @State private var sort: AskSort = .newest
    @State private var loadError = false
    @State private var failureText: String?

    private var fallbackCoverageSentence: String {
        let n = fallbackRows?.count ?? 0
        let names = CapturedListings.classifiedSources.map(CapturedListings.sourceName).joined(separator: ", ")
        return "\(n.formatted()) retained listings on this page · newest first · \(names) · no reader clock, each row carries its own"
    }

    var body: some View {
        Group {
            if let board = askBoard {
                List {
                    Section {
                        controlsHeader(board)
                            .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                            .listRowBackground(Color.clear)
                    }
                    Section {
                        ForEach(board.rows) { row in
                            if let uuid = row.vehicleUUID {
                                NavigationLink(value: VehicleHeaderRow(id: uuid, year: row.year, make: row.make, model: row.model, trim: nil,
                                                                       primary_image_url: row.image, city: row.location, state: nil)) {
                                    askRowView(row)
                                }
                            } else if let link = row.sourceLink {
                                Link(destination: link) { askRowView(row) }.buttonStyle(.plain)
                            } else {
                                askRowView(row)
                            }
                        }
                    } header: {
                        Text(askCoverageSentence(board))
                            .font(.system(size: 9, design: .monospaced))
                            .textCase(nil)
                    } footer: {
                        if let pp = board.price_population {
                            Text("Sold bands compare the asking price with \(pp.sales.formatted()) confirmed sales across \(pp.families.formatted()) families (\(pp.measure)\(pp.refreshed_at.map { " · refreshed \(ProfileClock.Absolute($0))" } ?? "")). A classified ask is the seller's listed price at capture time, not a closing price.")
                        } else {
                            Text("A classified ask is the seller's listed price at capture time, not a closing price.")
                        }
                    }
                }
                .listStyle(.plain)
                .refreshable { await load() }
            } else if let rows = fallbackRows {
                List {
                    Section {
                        ForEach(rows) { row in
                            if let v = row.vehicle, let uuid = UUID(uuidString: v.id) {
                                NavigationLink(value: VehicleHeaderRow(id: uuid, year: v.year, make: v.make, model: v.model, trim: nil,
                                                                       primary_image_url: v.primary_image_url, city: nil, state: nil)) {
                                    line(row)
                                }
                            } else if let link = row.sourceLink {
                                Link(destination: link) { line(row) }.buttonStyle(.plain)
                            } else {
                                line(row)
                            }
                        }
                    } header: {
                        Text(fallbackCoverageSentence).font(.system(size: 9, design: .monospaced)).textCase(nil)
                    } footer: {
                        Text("A recorded amount is the seller's assertion as retained, in a currency the reader does not record; a listing's presence is one sighting, not a sale or a current availability.")
                    }
                }
                .listStyle(.plain)
                .refreshable { await load() }
            } else if loadError {
                ContentUnavailableView {
                    Label("Couldn't read the listings", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(failureText ?? "The read failed.")
                } actions: {
                    Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
                }
            } else {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Reading classified arrivals…")
                        .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await load() }
        .onChange(of: window) { Task { await load() } }
        .onChange(of: tier) { Task { await load() } }
        .onChange(of: sort) { Task { await load() } }
    }

    private func askCoverageSentence(_ board: AskBoard) -> String {
        let p = board.population
        var parts: [String] = [
            "\(p.listings.formatted()) listings with a price (\(window.label))",
            "\(p.with_position.formatted()) placed vs sold cohort",
            "\(p.below_p25.formatted()) below p25"
        ]
        if let med = p.median_ask, med > 0 {
            parts.append("median ask \(AskPlacement.dollars(med))")
        }
        if let newest = p.newest_seen_at {
            parts.append("newest seen \(ProfileClock.Absolute(newest))")
        }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private func controlsHeader(_ board: AskBoard) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Picker("Window", selection: $window) {
                    ForEach(AskWindow.allCases) { w in
                        Text(w.label).tag(w)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 150)

                Spacer(minLength: 4)

                Menu {
                    ForEach(AskSort.allCases) { s in
                        Button {
                            sort = s
                        } label: {
                            HStack {
                                Text(s.label)
                                if sort == s { Image(systemName: "checkmark") }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(sort.label)
                        Image(systemName: "arrow.up.arrow.down")
                    }
                    .font(.caption2.monospaced().weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Color(.secondarySystemFill), in: Capsule())
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    tierPill(nil, label: "All", count: board.population.listings)
                    ForEach(AskTier.allCases) { t in
                        let c = board.population.by_tier?[t.rawValue]
                        tierPill(t, label: t.label, count: c)
                    }
                }
            }
        }
    }

    private func tierPill(_ item: AskTier?, label: String, count: Int?) -> some View {
        let active = tier == item
        return Button {
            tier = item
        } label: {
            HStack(spacing: 4) {
                Text(label)
                if let count {
                    Text("\(count.formatted())")
                        .foregroundStyle(active ? Color(.systemBackground).opacity(0.8) : .secondary)
                }
            }
            .font(.system(size: 10, weight: active ? .semibold : .regular, design: .monospaced))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(active ? Color.primary : Color(.secondarySystemFill), in: Capsule())
            .foregroundStyle(active ? Color(.systemBackground) : Color.primary)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func askRowView(_ row: AskRow) -> some View {
        let place = AskPlacement.placement(pos: row.position, ask: row.ask)
        let facts = row.listingFacts
        HStack(alignment: .top, spacing: 12) {
            Color(.secondarySystemFill)
                .frame(width: 64, height: 48)
                .overlay {
                    CachedAsyncImage(url: NukeImage.thumb(row.image, width: 200)) { i in
                        i.resizable().scaledToFill()
                    } placeholder: { Image(systemName: "car.side").foregroundStyle(.secondary) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(row.headline)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                    Spacer(minLength: 4)
                    Text(AskPlacement.dollars(row.ask))
                        .font(.system(.footnote, design: .monospaced).weight(.semibold))
                        .monospacedDigit()
                }
                HStack(spacing: 6) {
                    Text(CapturedListings.sourceName(row.source).uppercased())
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.secondary)
                    if let loc = row.location, !loc.isEmpty {
                        Text("· \(loc)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Text(ProfileClock.day(row.seen_at).map { "seen \($0)" } ?? "clock missing")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
                if !facts.isEmpty {
                    Text(facts)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }
                if let place {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(place.headline)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(place.tone == .below ? Color.green : (place.tone == .above ? Color.orange : Color.primary))
                        AskPriceStripView(place: place)
                        Text(place.spreadLine)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                        if let mLine = place.milesLine {
                            Text(mLine)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        if let vLine = place.venuesLine {
                            Text(vLine)
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        do {
            let board = try await AskBoard.fetch(hours: window.rawValue, tier: tier, sort: sort)
            askBoard = board
            loadError = false
        } catch {
            do {
                fallbackRows = try await CapturedListings.read()
                loadError = false
            } catch {
                if askBoard == nil && fallbackRows == nil {
                    loadError = true
                    failureText = ReadFailure.text(error)
                }
                NSLog("NukeCapture captured listings read failed: %@", String(describing: error))
            }
        }
    }

    @ViewBuilder private func line(_ row: CapturedListing) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Color(.secondarySystemFill)
                .frame(width: 64, height: 48)
                .overlay {
                    CachedAsyncImage(url: NukeImage.thumb(row.vehicle?.primary_image_url, width: 200)) { i in
                        i.resizable().scaledToFill()
                    } placeholder: { Image(systemName: "car.side").foregroundStyle(.secondary) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 3) {
                Text(row.headline).font(.subheadline.weight(.semibold)).lineLimit(2)
                HStack(spacing: 8) {
                    if let p = row.current_price, p.isFinite {
                        Text(Int(p.rounded()).formatted())
                            .font(.system(.footnote, design: .monospaced).weight(.semibold)).monospacedDigit()
                        Text("recorded amount · currency unrecorded").font(.caption2).foregroundStyle(.secondary)
                    } else {
                        Text("amount unrecorded").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Text(CapturedListings.sourceName(row.source_platform).uppercased())
                        .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                }
                Text(ProfileClock.day(row.clock).map { (row.source_observed_at != nil ? "seen " : "captured ") + $0 } ?? "clock missing")
                    .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }
}
