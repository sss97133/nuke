// MarketSellerProfile.swift — the seller page's photo-led profile: a hero strip of the account's cars,
// record tiles set against the Bring a Trailer market, and a big-image grid of sold / unsold / live cars
// with each sale set against comparable sales.
//
// Data: three read-only RPCs from 20261107090000_bat_seller_profile_readers.sql.
//   bat_seller_profile(p_handle)      listings with outcome, price and photo, plus all-time and 12-month stats.
//   bat_market_baseline(p_months)     BaT-wide sell-through, median and average sold.
//   bat_listing_cohort(p_vehicle_id)  comparable-sales median for one car (withheld below 5 comparables).
// Every figure is optional. A missing number renders as an em dash, never a zero, and a comparison is
// shown only when both sides exist. The cohort is the model family (not the trim), so it is labelled so.

import SwiftUI

// MARK: - Payloads (decoded the way the server sends them; every field tolerates null)

struct SellerProfileStats: Decodable, Equatable {
    let listings: Int?
    let sold: Int?
    let not_sold: Int?
    let live: Int?
    let unresolved: Int?
    let sell_through: Double?
    let median_sold: Double?
    let avg_sold: Double?
    let max_sold: Double?
    let min_sold: Double?
    let total_sold_usd: Double?
    let first_listing: String?
    let last_listing: String?
}

struct SellerProfileWindow: Decodable, Equatable {
    let closed: Int?
    let sold: Int?
    let not_sold: Int?
    let sell_through: Double?
    let median_sold: Double?
    let avg_sold: Double?
}

struct SellerProfileListing: Decodable, Identifiable, Equatable {
    let vehicle_id: UUID
    let url: String?
    let year: Int?
    let make: String?
    let model: String?
    let image_url: String?
    let status: String?
    let price: Double?
    let ends_at: String?
    let bids: Int?

    var id: String { url ?? vehicle_id.uuidString }
    var title: String { [year.map(String.init), make, model].compactMap { $0 }.joined(separator: " ") }
    var isSold: Bool { status == "sold" }
}

struct SellerProfile: Decodable, Equatable {
    let handle: String?
    let all_time: SellerProfileStats?
    let last_12m: SellerProfileWindow?
    let listings: [SellerProfileListing]?
}

struct SellerMarketBaseline: Decodable, Equatable {
    let months: Int?
    let sold: Int?
    let not_sold: Int?
    let sell_through: Double?
    let median_sold: Double?
    let avg_sold: Double?
}

struct SellerListingCohort: Decodable, Equatable {
    let basis: String?
    let n: Int?
    let median: Double?
    let avg: Double?
    let n_same_year: Int?
    let median_same_year: Double?
}

// MARK: - Comparison math (pure, unit-tested)

enum SellerCompare {
    /// Percent difference of `value` from `reference`, nil unless both exist and the reference is positive.
    static func percentDelta(_ value: Double?, _ reference: Double?) -> Double? {
        guard let value, let reference, reference > 0 else { return nil }
        return (value - reference) / reference * 100
    }

    /// Percentage-point difference between two rates in 0...1.
    static func pointDelta(_ value: Double?, _ reference: Double?) -> Double? {
        guard let value, let reference else { return nil }
        return (value - reference) * 100
    }

    static func percentText(_ delta: Double?) -> String? {
        guard let delta else { return nil }
        let rounded = Int(delta.rounded())
        return rounded == 0 ? "in line with" : (rounded > 0 ? "+\(rounded)% vs" : "\(rounded)% vs")
    }

    static func pointsText(_ delta: Double?) -> String? {
        guard let delta else { return nil }
        let rounded = Int(delta.rounded())
        return rounded == 0 ? "in line with" : (rounded > 0 ? "+\(rounded) pts vs" : "\(rounded) pts vs")
    }

    static func dollars(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }

    static func rate(_ value: Double?) -> String {
        guard let value else { return "—" }
        return (value * 100).formatted(.number.precision(.fractionLength(0))) + "%"
    }

    /// The BaT CDN serves resized images on `?w=`; the server's thumbnail URL carries a small crop query.
    static func imageURL(_ raw: String?, width: Int) -> URL? {
        guard var raw, !raw.isEmpty else { return nil }
        if let host = URL(string: raw)?.host?.lowercased(), host.hasSuffix("bringatrailer.com"),
           let cut = raw.firstIndex(of: "?") { raw = String(raw[..<cut]) }
        return NukeImage.thumb(raw, width: width)
    }
}

// MARK: - Loader

@MainActor
final class SellerProfileLoader: ObservableObject {
    @Published var profile: SellerProfile?
    @Published var baseline: SellerMarketBaseline?
    @Published var loading = true
    @Published var failed = false
    @Published var cohorts: [UUID: SellerListingCohort] = [:]
    private var cohortRequested = Set<UUID>()
    private var loadedHandle: String?

    func load(handle: String) async {
        guard loadedHandle != handle else { return }
        loading = true; failed = false; profile = nil; cohorts = [:]; cohortRequested = []
        defer { loading = false }
        struct ProfileParams: Encodable { let p_handle: String; let p_limit: Int }
        struct BaselineParams: Encodable { let p_months: Int }
        do {
            async let profileRead: SellerProfile = SupabaseService.client
                .rpc("bat_seller_profile", params: ProfileParams(p_handle: handle, p_limit: 60))
                .execute().value
            let loaded = try await profileRead
            try Task.checkCancellation()
            profile = loaded
            loadedHandle = handle
        } catch {
            guard !Task.isCancelled else { return }
            failed = true
            NSLog("NukeCapture seller profile failed: %@", String(describing: error))
            return
        }
        // The market baseline is context. Without it the seller's own numbers still stand.
        baseline = try? await SupabaseService.client
            .rpc("bat_market_baseline", params: BaselineParams(p_months: 12))
            .execute().value
    }

    /// One comparable-sales read per car, started when its card scrolls into view.
    func loadCohort(for listing: SellerProfileListing, handle: String) async {
        guard listing.isSold, !cohortRequested.contains(listing.vehicle_id) else { return }
        cohortRequested.insert(listing.vehicle_id)
        struct Params: Encodable { let p_vehicle_id: UUID; let p_exclude_handle: String }
        let result: SellerListingCohort? = try? await SupabaseService.client
            .rpc("bat_listing_cohort", params: Params(p_vehicle_id: listing.vehicle_id, p_exclude_handle: handle))
            .execute().value
        if let result { cohorts[listing.vehicle_id] = result }
    }
}

// MARK: - Sections

/// Drop-in `List` content for MarketSellerView: hero strip, record tiles, car grid.
struct SellerMarketProfileSections: View {
    let handle: String
    var areaListings: Int? = nil
    var area: String? = nil
    @StateObject private var loader = SellerProfileLoader()
    @State private var filter: Filter = .all
    @State private var shown = 12

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All", sold = "Sold", notSold = "Not sold", live = "Live"
        var id: String { rawValue }
    }

    private var listings: [SellerProfileListing] { loader.profile?.listings ?? [] }
    private var heroPhotos: [SellerProfileListing] {
        Array(listings.filter { $0.image_url != nil && ($0.isSold || $0.status == "live") }.prefix(10))
    }
    private var filtered: [SellerProfileListing] {
        switch filter {
        case .all: return listings
        case .sold: return listings.filter(\.isSold)
        case .notSold: return listings.filter { $0.status == "not_sold" }
        case .live: return listings.filter { $0.status == "live" }
        }
    }

    var body: some View {
        Group {
            if loader.loading {
                Section { ProgressView("Reading seller record") }
            } else if loader.failed {
                Section { Button("Seller record couldn't load · Retry") { Task { await loader.load(handle: handle) } } }
            } else if let stats = loader.profile?.all_time, (stats.listings ?? 0) > 0 {
                if !heroPhotos.isEmpty { hero }
                recordSection(stats)
                carsSection
            }
        }
        .task(id: handle) { await loader.load(handle: handle) }
    }

    // Hero: the account's cars, edge to edge.
    private var hero: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(heroPhotos) { car in
                        NavigationLink {
                            VehicleDetailView(vehicleId: car.vehicle_id.uuidString.lowercased(), embedInNavigationStack: false)
                        } label: {
                            ZStack(alignment: .bottomLeading) {
                                photo(car, width: 640)
                                    .frame(width: 260, height: 180).clipped()
                                LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(car.title).font(.subheadline.bold()).lineLimit(1)
                                    if car.isSold, let price = car.price {
                                        Text("Sold \(SellerCompare.dollars(price))").font(.caption)
                                    } else if car.status == "live" {
                                        Text("Live auction").font(.caption)
                                    }
                                }
                                .foregroundStyle(.white).padding(10)
                            }
                            .frame(width: 260, height: 180)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
        }
    }

    // Record tiles with the market beside each.
    private func recordSection(_ stats: SellerProfileStats) -> some View {
        let market = loader.baseline
        let year = loader.profile?.last_12m
        return Section("Record vs Bring a Trailer") {
            if let area, let areaListings, let total = stats.listings {
                Text("\(areaListings) of this account's \(total) captured listings connect it to ZIP \(area).")
                    .font(.caption).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                tile("Listings captured", stats.listings.map { $0.formatted() } ?? "—",
                     sub: stats.sold.map { "\($0) sold" })
                tile("Sell-through", SellerCompare.rate(stats.sell_through),
                     delta: SellerCompare.pointsText(SellerCompare.pointDelta(stats.sell_through, market?.sell_through)),
                     reference: market?.sell_through.map { SellerCompare.rate($0) },
                     better: SellerCompare.pointDelta(stats.sell_through, market?.sell_through).map { $0 > 0 })
                tile("Median sold", SellerCompare.dollars(stats.median_sold),
                     delta: SellerCompare.percentText(SellerCompare.percentDelta(stats.median_sold, market?.median_sold)),
                     reference: market?.median_sold.map { SellerCompare.dollars($0) },
                     better: SellerCompare.percentDelta(stats.median_sold, market?.median_sold).map { $0 > 0 })
                tile("Average sold", SellerCompare.dollars(stats.avg_sold),
                     delta: SellerCompare.percentText(SellerCompare.percentDelta(stats.avg_sold, market?.avg_sold)),
                     reference: market?.avg_sold.map { SellerCompare.dollars($0) },
                     better: SellerCompare.percentDelta(stats.avg_sold, market?.avg_sold).map { $0 > 0 })
                tile("Last 12 months", year?.closed.map { "\($0) closed" } ?? "—",
                     sub: [year?.sold.map { "\($0) sold" },
                           year?.median_sold.map { "median \(SellerCompare.dollars($0))" }]
                        .compactMap { $0 }.joined(separator: " · "))
                tile("Total sold", SellerCompare.dollars(stats.total_sold_usd),
                     sub: [stats.min_sold.map { "low \(SellerCompare.dollars($0))" },
                           stats.max_sold.map { "high \(SellerCompare.dollars($0))" }]
                        .compactMap { $0 }.joined(separator: " · "))
            }
            .padding(.vertical, 4)
            Text("Sell-through is sold ÷ (sold + not sold). Market figures cover \(market?.months ?? 12) months of captured BaT results\(market?.sold.map { " (\($0.formatted()) sold)" } ?? ""). A higher median means pricier cars as well as better results; the per-car comparison below holds the model constant. Source coverage is incomplete.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func tile(_ title: String, _ value: String, sub: String? = nil, delta: String? = nil,
                      reference: String? = nil, better: Bool? = nil) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.bold().monospacedDigit()).minimumScaleFactor(0.7).lineLimit(1)
            if let delta, let reference {
                Text("\(delta) market \(reference)")
                    .font(.caption2).foregroundStyle(better == true ? Color.green : better == false ? Color.orange : Color.secondary)
            } else if let sub, !sub.isEmpty {
                Text(sub).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
    }

    // Big-image grid.
    private var carsSection: some View {
        Section("Cars") {
            Picker("Filter", selection: $filter) {
                ForEach(Filter.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .onChange(of: filter) { _, _ in shown = 12 }
            if filtered.isEmpty {
                Text("No captured cars in this view.").font(.subheadline).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 12) {
                ForEach(filtered.prefix(shown)) { car in card(car) }
            }
            .padding(.vertical, 4)
            if filtered.count > shown {
                Button("Show more (\(filtered.count - shown))") { shown += 12 }
            }
            if let total = loader.profile?.all_time?.listings, total > listings.count {
                Text("Showing the latest \(listings.count) of \(total) captured listings. All of them stay under Inspect captured auctions.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func card(_ car: SellerProfileListing) -> some View {
        NavigationLink {
            VehicleDetailView(vehicleId: car.vehicle_id.uuidString.lowercased(), embedInNavigationStack: false)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                photo(car, width: 480)
                    .frame(maxWidth: .infinity).aspectRatio(4 / 3, contentMode: .fit).clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(alignment: .topLeading) { badge(car).padding(6) }
                Text(car.title).font(.subheadline.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
                if car.isSold {
                    Text(SellerCompare.dollars(car.price)).font(.subheadline.monospacedDigit())
                    cohortLine(car)
                } else if let ends = car.ends_at, let day = AuctionLocationClock.day(ends) {
                    Text("Ended \(AuctionLocationClock.label(day))").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.plain)
        .task { await loader.loadCohort(for: car, handle: handle) }
    }

    @ViewBuilder private func cohortLine(_ car: SellerProfileListing) -> some View {
        if let cohort = loader.cohorts[car.vehicle_id], let median = cohort.median,
           let text = SellerCompare.percentText(SellerCompare.percentDelta(car.price, median)) {
            let better = (car.price ?? 0) >= median
            Text("\(text) similar sales \(SellerCompare.dollars(median)) · n=\(cohort.n ?? 0)")
                .font(.caption2).foregroundStyle(better ? Color.green : Color.orange)
        }
    }

    private func badge(_ car: SellerProfileListing) -> some View {
        let (label, color): (String, Color) = {
            switch car.status {
            case "sold": return ("SOLD", .green)
            case "live": return ("LIVE", .blue)
            case "not_sold": return ("NOT SOLD", .gray)
            default: return ("UNRESOLVED", .gray)
            }
        }()
        return Text(label).font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.85), in: Capsule()).foregroundStyle(.white)
    }

    @ViewBuilder private func photo(_ car: SellerProfileListing, width: Int) -> some View {
        CachedAsyncImage(url: SellerCompare.imageURL(car.image_url, width: width), maxPixel: CGFloat(width)) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Rectangle().fill(.quaternary).overlay(Image(systemName: "car.side").foregroundStyle(.secondary))
        }
    }
}
