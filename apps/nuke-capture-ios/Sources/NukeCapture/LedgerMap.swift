// LedgerMap.swift — the market map (HomePage.tsx on a phone).
//
// Reads the same database functions and tables the web's Market Map reads:
//   - treemap_refreshes          (refresh clock, public_records, mapped_sales, by_house venue mix)
//   - treemap_by_brand           + treemap_brand_market (brands with 12m BaT relative move & confirmed USD)
//   - treemap_brand_family_map   (brands with canonical model families nested inside)
//   - treemap_brand_families     (canonical model families within a brand, mv_family_market)
//   - treemap_family_models      (sub-models within a canonical family)
//   - treemap_models_by_brand    (fallback when family grouping is unavailable)
//   - treemap_years              (model years within a brand + model)
//   - treemap_sales              (confirmed sales leaf records — replaces raw vehicles table query)
//   - treemap_family_sales       (5-year confirmed sales scatter + direct family year drill)
//   - family_price_index_read    (hedonic like-for-like price index, same car & same miles)
//   - treemap_family_share_movers(Relativity indicator & 8-horizon market/supply movers)

import SwiftUI
import Charts
import Supabase

// MARK: - Core Map Nodes & Leaves

struct LedgerNode: Decodable, Identifiable, Equatable {
    let name: String
    let count: Int
    let value: Double?
    let median_price: Double?
    let min_price: Double?
    let max_price: Double?
    let sold_count: Int?
    let auction_count: Int?
    let avg_bids: Double?
    let avg_watchers: Double?

    // Canonical market & family measures (treemap_brand_market / treemap_brand_families / treemap_family_models)
    var usd: Double?
    var sold_any: Int?
    var offered: Int?
    var dated: Int?
    var sold_12m: Int?
    var sold_prior_12m: Int?
    var usd_12m: Double?
    var usd_prior_12m: Double?
    var familyKey: String?
    var models: Int?

    var id: String { familyKey ?? name }

    /// Area measure for squarified layout under the chosen basis.
    func area(basis: LedgerMapScale.MapBasis, isBrandOrFamily: Bool) -> Double {
        if isBrandOrFamily {
            let v = basis == .bat12 ? (usd_12m ?? 0) : (usd ?? value ?? 0)
            if v > 0 { return v }
        }
        if let u = usd, u > 0 { return u }
        return Double(max(count, 1))
    }
}

struct BrandMarketRow: Decodable, Equatable {
    let brand: String
    let sales: Int?
    let usd: Double?
    let sold_any: Int?
    let offered: Int?
    let p10: Double?
    let p50: Double?
    let p90: Double?
    let year_p50: Int?
    let dated: Int?
    let sold_12m: Int?
    let sold_prior_12m: Int?
    let usd_12m: Double?
    let usd_prior_12m: Double?

    private enum CodingKeys: String, CodingKey {
        case brand, name
        case sales, sold
        case usd, sold_any, offered, p10, p50, p90, year_p50, dated
        case sold_12m, sold_prior_12m, usd_12m, usd_prior_12m
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.brand = (try? c.decode(String.self, forKey: .name))
            ?? (try? c.decode(String.self, forKey: .brand))
            ?? ""
        self.sales = (try? c.decodeIfPresent(Int.self, forKey: .sold))
            ?? (try? c.decodeIfPresent(Int.self, forKey: .sales))
        self.usd = try? c.decodeIfPresent(Double.self, forKey: .usd)
        self.sold_any = try? c.decodeIfPresent(Int.self, forKey: .sold_any)
        self.offered = try? c.decodeIfPresent(Int.self, forKey: .offered)
        self.p10 = try? c.decodeIfPresent(Double.self, forKey: .p10)
        self.p50 = try? c.decodeIfPresent(Double.self, forKey: .p50)
        self.p90 = try? c.decodeIfPresent(Double.self, forKey: .p90)
        self.year_p50 = try? c.decodeIfPresent(Int.self, forKey: .year_p50)
        self.dated = try? c.decodeIfPresent(Int.self, forKey: .dated)
        self.sold_12m = try? c.decodeIfPresent(Int.self, forKey: .sold_12m)
        self.sold_prior_12m = try? c.decodeIfPresent(Int.self, forKey: .sold_prior_12m)
        self.usd_12m = try? c.decodeIfPresent(Double.self, forKey: .usd_12m)
        self.usd_prior_12m = try? c.decodeIfPresent(Double.self, forKey: .usd_prior_12m)
    }
}

struct FamilyMarketRow: Decodable, Equatable {
    let family_key: String
    let family_name: String
    let models: Int?
    let sales: Int
    let usd: Double?
    let median_price: Double?
    let min_price: Double?
    let max_price: Double?
    let sold_any: Int?
    let offered: Int?
    let dated: Int?
    let sold_12m: Int?
    let sold_prior_12m: Int?
    let usd_12m: Double?
    let usd_prior_12m: Double?

    private enum CodingKeys: String, CodingKey {
        case family_key
        case family_name, family
        case models
        case sales, sold
        case usd, median_price, min_price, max_price, p10, p50, p90
        case sold_any, offered, dated
        case sold_12m, sold_prior_12m, usd_12m, usd_prior_12m
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let fk = (try? c.decode(String.self, forKey: .family_key)) ?? "other"
        self.family_key = fk
        let fam = (try? c.decodeIfPresent(String.self, forKey: .family))
            ?? (try? c.decodeIfPresent(String.self, forKey: .family_name))
        self.family_name = (fam?.isEmpty == false) ? fam! : (fk == "other" ? "Model not in a family" : fk)
        self.models = try? c.decodeIfPresent(Int.self, forKey: .models)
        self.sales = (try? c.decodeIfPresent(Int.self, forKey: .sold))
            ?? (try? c.decodeIfPresent(Int.self, forKey: .sales))
            ?? 0
        self.usd = try? c.decodeIfPresent(Double.self, forKey: .usd)
        self.median_price = (try? c.decodeIfPresent(Double.self, forKey: .median_price))
            ?? (try? c.decodeIfPresent(Double.self, forKey: .p50))
        self.min_price = (try? c.decodeIfPresent(Double.self, forKey: .min_price))
            ?? (try? c.decodeIfPresent(Double.self, forKey: .p10))
        self.max_price = (try? c.decodeIfPresent(Double.self, forKey: .max_price))
            ?? (try? c.decodeIfPresent(Double.self, forKey: .p90))
        self.sold_any = try? c.decodeIfPresent(Int.self, forKey: .sold_any)
        self.offered = try? c.decodeIfPresent(Int.self, forKey: .offered)
        self.dated = try? c.decodeIfPresent(Int.self, forKey: .dated)
        self.sold_12m = try? c.decodeIfPresent(Int.self, forKey: .sold_12m)
        self.sold_prior_12m = try? c.decodeIfPresent(Int.self, forKey: .sold_prior_12m)
        self.usd_12m = try? c.decodeIfPresent(Double.self, forKey: .usd_12m)
        self.usd_prior_12m = try? c.decodeIfPresent(Double.self, forKey: .usd_prior_12m)
    }

    func toLedgerNode() -> LedgerNode {
        let displayName = family_key == "other" ? "other models" : family_name
        return LedgerNode(
            name: displayName,
            count: sales,
            value: usd,
            median_price: median_price,
            min_price: min_price,
            max_price: max_price,
            sold_count: sales,
            auction_count: offered,
            avg_bids: nil,
            avg_watchers: nil,
            usd: usd,
            sold_any: sold_any,
            offered: offered,
            dated: dated,
            sold_12m: sold_12m,
            sold_prior_12m: sold_prior_12m,
            usd_12m: usd_12m,
            usd_prior_12m: usd_prior_12m,
            familyKey: family_key,
            models: models
        )
    }
}

struct FamilyModelRow: Decodable, Equatable {
    let model: String
    let sales: Int
    let usd: Double?
    let median_price: Double?
    let min_price: Double?
    let max_price: Double?
    let sold_any: Int?
    let offered: Int?
    let dated: Int?
    let sold_12m: Int?
    let sold_prior_12m: Int?
    let usd_12m: Double?
    let usd_prior_12m: Double?

    private enum CodingKeys: String, CodingKey {
        case model
        case sales, sold
        case usd, median_price, min_price, max_price
        case sold_any, offered, dated
        case sold_12m, sold_prior_12m, usd_12m, usd_prior_12m
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let m = try? c.decodeIfPresent(String.self, forKey: .model)
        self.model = (m?.isEmpty == false) ? m! : "Model not given"
        self.sales = (try? c.decodeIfPresent(Int.self, forKey: .sold))
            ?? (try? c.decodeIfPresent(Int.self, forKey: .sales))
            ?? 0
        self.usd = try? c.decodeIfPresent(Double.self, forKey: .usd)
        self.median_price = try? c.decodeIfPresent(Double.self, forKey: .median_price)
        self.min_price = try? c.decodeIfPresent(Double.self, forKey: .min_price)
        self.max_price = try? c.decodeIfPresent(Double.self, forKey: .max_price)
        self.sold_any = try? c.decodeIfPresent(Int.self, forKey: .sold_any)
        self.offered = try? c.decodeIfPresent(Int.self, forKey: .offered)
        self.dated = try? c.decodeIfPresent(Int.self, forKey: .dated)
        self.sold_12m = try? c.decodeIfPresent(Int.self, forKey: .sold_12m)
        self.sold_prior_12m = try? c.decodeIfPresent(Int.self, forKey: .sold_prior_12m)
        self.usd_12m = try? c.decodeIfPresent(Double.self, forKey: .usd_12m)
        self.usd_prior_12m = try? c.decodeIfPresent(Double.self, forKey: .usd_prior_12m)
    }

    func toLedgerNode() -> LedgerNode {
        LedgerNode(
            name: model,
            count: sales,
            value: usd,
            median_price: median_price,
            min_price: min_price,
            max_price: max_price,
            sold_count: sales,
            auction_count: offered,
            avg_bids: nil,
            avg_watchers: nil,
            usd: usd,
            sold_any: sold_any,
            offered: offered,
            dated: dated,
            sold_12m: sold_12m,
            sold_prior_12m: sold_prior_12m,
            usd_12m: usd_12m,
            usd_prior_12m: usd_prior_12m,
            familyKey: nil,
            models: nil
        )
    }
}

struct BrandFamilyMapRow: Decodable, Equatable, Identifiable {
    let brand: String
    let brand_usd: Double
    let brand_rank: Int
    let family_key: String
    let family: String?
    let usd: Double?
    let sold: Int?
    let sold_any: Int?
    let offered: Int?
    let dated: Int?
    let sold_12m: Int?
    let sold_prior_12m: Int?
    let usd_12m: Double?
    let usd_prior_12m: Double?
    let families: Int

    var id: String { "\(brand)|\(family_key)" }
    var displayLabel: String {
        if family_key == "more" { return "more families" }
        if family_key == "other" { return "other models" }
        return family ?? family_key
    }

    func toLedgerNode() -> LedgerNode {
        LedgerNode(
            name: displayLabel,
            count: sold ?? 0,
            value: usd,
            median_price: nil,
            min_price: nil,
            max_price: nil,
            sold_count: sold,
            auction_count: offered,
            avg_bids: nil,
            avg_watchers: nil,
            usd: usd,
            sold_any: sold_any,
            offered: offered,
            dated: dated,
            sold_12m: sold_12m,
            sold_prior_12m: sold_prior_12m,
            usd_12m: usd_12m,
            usd_prior_12m: usd_prior_12m,
            familyKey: family_key,
            models: nil
        )
    }
}

/// Decodes `treemap_sales` rows (`sold_amount`, `sale_basis`, `listing_title`, `primary_image_url`, `mileage`)
/// as well as `title`, `price`, `sale_price`, `sold_price`, `sale_date`, `source`, `url`, `image`.
struct LedgerVehicle: Decodable, Identifiable, Equatable {
    let id: UUID
    let year: Int?
    let make: String?
    let model: String?
    let listing_title: String?
    let bat_listing_title: String?
    let sale_price: Double?
    let sold_price: Double?
    let primary_image_url: String?
    let mileage: Double?
    let sale_date: String?
    let source: String?
    let url: String?

    enum CodingKeys: String, CodingKey {
        case id, year, make, model
        case listing_title, bat_listing_title, title
        case sale_price, sold_price, sold_amount, price
        case primary_image_url, image
        case mileage, sale_date, source, sale_basis, url
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        year = try? c.decodeIfPresent(Int.self, forKey: .year)
        make = try? c.decodeIfPresent(String.self, forKey: .make)
        model = try? c.decodeIfPresent(String.self, forKey: .model)
        let directTitle = try? c.decodeIfPresent(String.self, forKey: .title)
        let lt = try? c.decodeIfPresent(String.self, forKey: .listing_title)
        listing_title = directTitle ?? lt
        bat_listing_title = try? c.decodeIfPresent(String.self, forKey: .bat_listing_title)
        let directPrice = try? c.decodeIfPresent(Double.self, forKey: .price)
        let soldAmt = try? c.decodeIfPresent(Double.self, forKey: .sold_amount)
        let sp = try? c.decodeIfPresent(Double.self, forKey: .sale_price)
        sale_price = directPrice ?? soldAmt ?? sp
        sold_price = try? c.decodeIfPresent(Double.self, forKey: .sold_price)
        let directImage = try? c.decodeIfPresent(String.self, forKey: .image)
        let pi = try? c.decodeIfPresent(String.self, forKey: .primary_image_url)
        primary_image_url = directImage ?? pi
        mileage = try? c.decodeIfPresent(Double.self, forKey: .mileage)
        sale_date = try? c.decodeIfPresent(String.self, forKey: .sale_date)
        source = (try? c.decodeIfPresent(String.self, forKey: .source))
            ?? (try? c.decodeIfPresent(String.self, forKey: .sale_basis))
        url = try? c.decodeIfPresent(String.self, forKey: .url)
    }

    init(id: UUID, year: Int?, make: String?, model: String?, title: String?, price: Double?,
         image: String?, mileage: Double?, sale_date: String? = nil, source: String? = nil, url: String? = nil) {
        self.id = id
        self.year = year
        self.make = make
        self.model = model
        self.listing_title = title
        self.bat_listing_title = nil
        self.sale_price = price
        self.sold_price = nil
        self.primary_image_url = image
        self.mileage = mileage
        self.sale_date = sale_date
        self.source = source
        self.url = url
    }

    var price: Double { (sale_price ?? 0) > 0 ? (sale_price ?? 0) : (sold_price ?? 0) }
    var name: String {
        if let t = listing_title ?? bat_listing_title, !t.isEmpty { return t }
        return [year.map(String.init), make, model].compactMap { $0 }.joined(separator: " ")
    }
    var headerRow: VehicleHeaderRow {
        VehicleHeaderRow(id: id, year: year, make: make, model: model, trim: nil, primary_image_url: primary_image_url, city: nil, state: nil)
    }
}

// MARK: - Refresh Receipt & Venue Mix (treemap_refreshes)

struct LedgerRefreshReceipt: Decodable, Equatable {
    struct HouseRow: Decodable, Equatable, Identifiable {
        let house: String?
        let sales: Int
        let amount: Double
        var id: String { house ?? "other" }
    }
    struct Populations: Decodable, Equatable {
        let measure: String?
        let public_records: Int?
        let mapped_sales: Int?
        let by_house: [HouseRow]?
    }
    let refreshed_at: String?
    let populations: Populations?

    var isConfirmedSaleMeasure: Bool {
        populations?.measure == "confirmed_sale_v1"
    }

    func refreshClock(now: Date = Date()) -> String {
        guard let raw = refreshed_at, let d = ProfileClock.date(raw) else { return "" }
        let mins = Int(floor(now.timeIntervalSince(d) / 60.0))
        if mins < 0 { return "" }
        if mins < 1 { return " · updated just now" }
        if mins < 60 { return " · updated \(mins) min ago" }
        let hrs = mins / 60
        if hrs < 24 { return " · updated \(hrs) h ago" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "MMM d"
        return " · updated \(f.string(from: d))"
    }
}

// MARK: - Map Scale & Relative Move (mapScale.ts twin)

enum LedgerMapScale {
    enum MapBasis: String, CaseIterable, Equatable {
        case ledger = "ledger"
        case bat12 = "bat12"

        var label: String {
            switch self {
            case .ledger: return "All sales"
            case .bat12: return "BaT 12 mo"
            }
        }
    }

    enum BrandViewMode: String, CaseIterable, Equatable {
        case brands = "brands"
        case families = "families"

        var label: String {
            switch self {
            case .brands: return "Brands"
            case .families: return "Families inside"
            }
        }
    }

    static let gateMin = 20

    struct Baseline: Equatable {
        let sold: Int
        let prior: Int
        let move: Double
    }

    enum FewReason: String, Equatable {
        case count
        case share
    }

    enum Move: Equatable {
        case move(rel: Double, raw: Double, sold: Int, prior: Int)
        case few(sold: Int, prior: Int, why: FewReason)
        case none
    }

    struct Callout: Equatable, Identifiable {
        enum Kind: String, Equatable {
            case gain, loss, largest
            var label: String {
                switch self {
                case .gain: return "Biggest gain"
                case .loss: return "Biggest drop"
                case .largest: return "Biggest"
                }
            }
        }
        let kind: Kind
        let name: String
        let rel: Double
        let sold: Int
        let prior: Int
        var id: String { kind.rawValue }
    }

    static func batBaseline(_ nodes: [LedgerNode]) -> Baseline? {
        var sold = 0
        var prior = 0
        for n in nodes {
            guard let s = n.sold_12m, let p = n.sold_prior_12m else { continue }
            sold += s
            prior += p
        }
        guard prior > 0 else { return nil }
        return Baseline(sold: sold, prior: prior, move: Double(sold) / Double(prior) - 1.0)
    }

    static func relativeMove(_ n: LedgerNode, base: Baseline?, allVenues: Bool = false) -> Move {
        guard let sold = n.sold_12m, let prior = n.sold_prior_12m, sold + prior > 0 else {
            return .none
        }
        if sold < gateMin || prior < gateMin {
            return .few(sold: sold, prior: prior, why: .count)
        }
        if allVenues {
            let dated = n.dated ?? 0
            if Double(dated) < 0.5 * Double(n.count) {
                return .few(sold: sold, prior: prior, why: .share)
            }
        }
        let raw = Double(sold) / Double(prior) - 1.0
        let rel = base.map { (1.0 + raw) / (1.0 + $0.move) - 1.0 } ?? raw
        return .move(rel: rel, raw: raw, sold: sold, prior: prior)
    }

    static func pct(_ v: Double) -> String {
        let r = Int((v * 100.0).rounded())
        if r == 0 { return "0%" }
        return "\(v > 0 ? "▲" : "▼")\(abs(r))%"
    }

    static func moveText(_ m: Move) -> String {
        switch m {
        case .move(let rel, _, _, _): return pct(rel)
        case .few(_, _, let why): return why == .share ? "mostly unmeasured houses" : "too few sales"
        case .none: return ""
        }
    }

    static func moveTextShort(_ m: Move) -> String {
        switch m {
        case .move(let rel, _, _, _): return pct(rel)
        case .few(_, _, let why): return why == .share ? "unmeasured" : "few sales"
        case .none: return ""
        }
    }

    static func callouts(_ nodes: [LedgerNode], base: Baseline?) -> [Callout] {
        struct Scored {
            let node: LedgerNode
            let rel: Double
            let sold: Int
            let prior: Int
        }
        let moved: [Scored] = nodes.compactMap { n in
            guard case .move(let rel, _, let sold, let prior) = relativeMove(n, base: base) else { return nil }
            return Scored(node: n, rel: rel, sold: sold, prior: prior)
        }
        let clear = moved.filter { s in
            guard s.rel > -1.0, s.sold > 0, s.prior > 0 else { return false }
            let se = sqrt(1.0 / Double(s.sold) + 1.0 / Double(s.prior))
            return abs(log(1.0 + s.rel)) >= 2.0 * se
        }
        var out: [Callout] = []
        let gain = clear.filter { $0.rel > 0 }.max(by: { $0.rel < $1.rel })
        let loss = clear.filter { $0.rel < 0 }.min(by: { $0.rel < $1.rel })
        let largest = moved.max(by: { ($0.node.usd_12m ?? 0) < ($1.node.usd_12m ?? 0) })
        if let g = gain {
            out.append(Callout(kind: .gain, name: g.node.name, rel: g.rel, sold: g.sold, prior: g.prior))
        }
        if let l = loss {
            out.append(Callout(kind: .loss, name: l.node.name, rel: l.rel, sold: l.sold, prior: l.prior))
        }
        if let lg = largest, lg.node.name != gain?.node.name, lg.node.name != loss?.node.name {
            out.append(Callout(kind: .largest, name: lg.node.name, rel: lg.rel, sold: lg.sold, prior: lg.prior))
        }
        return out
    }

    static func tileColor(_ m: Move) -> Color {
        switch m {
        case .none:
            return Color(.tertiarySystemFill)
        case .few:
            return Color(.secondarySystemFill)
        case .move(let rel, _, _, _):
            let clamped = max(-0.5, min(0.5, rel))
            let t = abs(clamped) / 0.5
            if abs(clamped) < 0.03 {
                return Color(.secondarySystemBackground)
            } else if clamped > 0 {
                return Color.green.opacity(0.14 + 0.34 * t)
            } else {
                return Color.red.opacity(0.14 + 0.34 * t)
            }
        }
    }
}

// MARK: - Relativity & Horizon Movers (FamilyMovers.tsx twin)

enum MoverHorizon: String, CaseIterable, Equatable, Identifiable {
    case upcoming = "upcoming"
    case d1 = "1d"
    case w1 = "1w"
    case m1 = "1m"
    case m3 = "3m"
    case m6 = "6m"
    case y1 = "1y"
    case y5 = "5y"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .upcoming: return "UPCOMING"
        case .d1: return "1D"
        case .w1: return "1W"
        case .m1: return "1M"
        case .m3: return "3M"
        case .m6: return "6M"
        case .y1: return "1Y"
        case .y5: return "5Y"
        }
    }

    var windowText: String {
        switch self {
        case .upcoming: return "scheduled & live pipeline vs last 30 days"
        case .d1: return "last 24 hours vs prior 24 hours"
        case .w1: return "last 7 days vs prior 7 days"
        case .m1: return "last 30 days vs prior 30 days"
        case .m3: return "last 90 days vs prior 90 days"
        case .m6: return "last 6 months vs prior 6 months"
        case .y1: return "last 12 months vs prior 12 months"
        case .y5: return "last 2.5 years vs prior 2.5 years"
        }
    }

    var gateMinSales: Int {
        switch self {
        case .upcoming: return 4
        case .d1: return 1
        case .w1: return 2
        case .m1: return 5
        case .m3: return 10
        case .m6: return 15
        case .y1: return 20
        case .y5: return 30
        }
    }
}

enum BaselineHorizon: String, CaseIterable, Equatable, Identifiable {
    case prior = "prior"
    case d1 = "1d"
    case w1 = "1w"
    case m1 = "1m"
    case m3 = "3m"
    case m6 = "6m"
    case y1 = "1y"
    case y5 = "5y"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .prior: return "PRIOR"
        case .d1: return "1D"
        case .w1: return "1W"
        case .m1: return "1M"
        case .m3: return "3M"
        case .m6: return "6M"
        case .y1: return "1Y"
        case .y5: return "5Y"
        }
    }

    var moverHorizon: MoverHorizon? {
        MoverHorizon(rawValue: rawValue)
    }
}

struct ShareMover: Equatable, Identifiable {
    let brand: String
    let familyKey: String
    let family: String
    let sold: Int
    let prior: Int
    let usd: Double
    let usdPrior: Double
    let ratio: Double
    let lo: Double
    let hi: Double
    let move: Double
    let se: Double
    let z: Double
    var avgPriceMove: Double? = nil
    var bins: [Double]? = nil

    var id: String { "\(brand)|\(familyKey)" }
}

struct ShareMoversRead: Equatable {
    struct MoveTuple: Equatable {
        let sold12m: Int
        let soldPrior12m: Int
        let usd12m: Double
        let usdPrior12m: Double
    }
    struct UpcomingSources: Equatable {
        let batLive: Int
        let auctionCalendar: Int
        let facebookMarketplace: Int
    }

    let marketSold: Int
    let marketPrior: Int
    var marketUsd: Double = 0
    var marketUsdPrior: Double = 0
    let marketMove: Double
    let candidates: Int
    var families: Int = 0
    var significant: Int = 0
    var sources: UpcomingSources? = nil
    var brandMoves: [String: MoveTuple] = [:]
    var familyMoves: [String: MoveTuple] = [:]
    let gaining: [ShareMover]
    let losing: [ShareMover]

    static func parse(_ data: Data) -> ShareMoversRead? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let gainingRaw = obj["gaining"] as? [[String: Any]],
              let losingRaw = obj["losing"] as? [[String: Any]] else {
            return nil
        }
        func num(_ v: Any?) -> Double? {
            if let d = v as? Double, d.isFinite { return d }
            if let i = v as? Int { return Double(i) }
            if let s = v as? String, let d = Double(s.trimmingCharacters(in: .whitespaces)), d.isFinite { return d }
            return nil
        }
        let bat = obj["bat"] as? [String: Any]
        let market = obj["market"] as? [String: Any]
        guard let mSold = num(bat?["sold_12m"]) ?? num(market?["sold"]),
              let mPrior = num(bat?["sold_prior_12m"]) ?? num(market?["prior"]) else { return nil }
        let mUsd = num(bat?["usd_12m"]) ?? 0
        let mUsdPrior = num(bat?["usd_prior_12m"]) ?? 0
        let mMove = num(market?["move"]) ?? (mPrior > 0 ? (mSold - mPrior) / mPrior : 0)

        func row(_ r: [String: Any]) -> ShareMover? {
            guard let brand = r["brand"] as? String, !brand.isEmpty,
                  let fk = r["family_key"] as? String, !fk.isEmpty,
                  let fam = r["family"] as? String, !fam.isEmpty,
                  let sold = num(r["sold_12m"]) ?? num(r["sold"]),
                  let prior = num(r["sold_prior_12m"]) ?? num(r["prior"]),
                  let move = num(r["share_move"]) ?? num(r["move"]),
                  let lo = num(r["share_lo"]) ?? num(r["lo"]),
                  let hi = num(r["share_hi"]) ?? num(r["hi"]),
                  let se = num(r["se"]) else { return nil }
            let ratio = num(r["ratio"]) ?? (1.0 + move)
            let z = num(r["z"]) ?? (se > 0 ? log(max(0.01, ratio)) / se : 0)
            let usd = num(r["usd_12m"]) ?? num(r["usd"]) ?? 0
            let usdPrior = num(r["usd_prior_12m"]) ?? num(r["usd_prior"]) ?? 0
            let avgPriceMove = num(r["avg_price_move"])
            let bins: [Double]? = (r["bins"] as? [Any])?.compactMap(num)
            return ShareMover(
                brand: brand,
                familyKey: fk,
                family: fam,
                sold: Int(sold.rounded()),
                prior: Int(prior.rounded()),
                usd: usd,
                usdPrior: usdPrior,
                ratio: ratio,
                lo: lo,
                hi: hi,
                move: move,
                se: se,
                z: z,
                avgPriceMove: avgPriceMove,
                bins: (bins?.isEmpty == false) ? bins : nil
            )
        }
        let g = gainingRaw.compactMap(row)
        let l = losingRaw.compactMap(row)
        guard g.count == gainingRaw.count, l.count == losingRaw.count else { return nil }

        func parseMoves(_ raw: Any?, isFamily: Bool) -> [String: MoveTuple] {
            var out: [String: MoveTuple] = [:]
            if let dict = raw as? [String: Any] {
                for (k, val) in dict {
                    guard let arr = val as? [Any], arr.count >= 4,
                          let s12 = num(arr[0]), let sp12 = num(arr[1]),
                          let u12 = num(arr[2]), let up12 = num(arr[3]) else { continue }
                    let normKey = k.replacingOccurrences(of: "::", with: "|")
                    out[normKey] = MoveTuple(sold12m: Int(s12.rounded()), soldPrior12m: Int(sp12.rounded()), usd12m: u12, usdPrior12m: up12)
                }
            } else if let list = raw as? [[String: Any]] {
                for item in list {
                    guard let brand = item["brand"] as? String, !brand.isEmpty,
                          let s12 = num(item["sold_12m"]) ?? num(item["sold"]),
                          let sp12 = num(item["sold_prior_12m"]) ?? num(item["prior"]) else { continue }
                    let u12 = num(item["usd_12m"]) ?? num(item["usd"]) ?? 0
                    let up12 = num(item["usd_prior_12m"]) ?? num(item["usd_prior"]) ?? 0
                    let key: String
                    if isFamily {
                        guard let fk = item["family_key"] as? String, !fk.isEmpty else { continue }
                        key = "\(brand)|\(fk)"
                    } else {
                        key = brand
                    }
                    out[key] = MoveTuple(sold12m: Int(s12.rounded()), soldPrior12m: Int(sp12.rounded()), usd12m: u12, usdPrior12m: up12)
                }
            }
            return out
        }

        let sources: UpcomingSources? = {
            guard let s = obj["sources"] as? [String: Any],
                  let bl = num(s["bat_live"]),
                  let ac = num(s["auction_calendar"]),
                  let fb = num(s["facebook_marketplace"]) else { return nil }
            return UpcomingSources(batLive: Int(bl.rounded()), auctionCalendar: Int(ac.rounded()), facebookMarketplace: Int(fb.rounded()))
        }()

        let eligible = Int((num(obj["eligible"]) ?? num(obj["candidates"]) ?? 0).rounded())
        let families = Int((num(obj["families"]) ?? Double(eligible)).rounded())
        let significant = Int((num(obj["significant"]) ?? Double(g.count + l.count)).rounded())

        return ShareMoversRead(
            marketSold: Int(mSold.rounded()),
            marketPrior: Int(mPrior.rounded()),
            marketUsd: mUsd,
            marketUsdPrior: mUsdPrior,
            marketMove: mMove,
            candidates: eligible,
            families: families,
            significant: significant,
            sources: sources,
            brandMoves: parseMoves(obj["brand_moves"], isFamily: false),
            familyMoves: parseMoves(obj["family_moves"], isFamily: true),
            gaining: g,
            losing: l
        )
    }

    /// Dual-window comparator (`combineShareMovers` in `FamilyMovers.tsx` #1819):
    /// compares `target`'s current window against `baseline`'s current window using log-share standard error.
    static func combine(target: ShareMoversRead, baseline: ShareMoversRead, targetHorizon: MoverHorizon, limit: Int = 5) -> ShareMoversRead {
        let bSoldTotal = max(1, baseline.marketSold)
        let tSoldTotal = max(1, target.marketSold)
        let minGate = targetHorizon.gateMinSales

        var combinedBrands: [String: MoveTuple] = [:]
        let allBrands = Set(target.brandMoves.keys).union(baseline.brandMoves.keys)
        for b in allBrands {
            let tm = target.brandMoves[b]
            let bm = baseline.brandMoves[b]
            combinedBrands[b] = MoveTuple(
                sold12m: tm?.sold12m ?? 0,
                soldPrior12m: bm?.sold12m ?? 0,
                usd12m: tm?.usd12m ?? 0,
                usdPrior12m: bm?.usd12m ?? 0
            )
        }

        var combinedFamilies: [String: MoveTuple] = [:]
        let allFams = Set(target.familyMoves.keys).union(baseline.familyMoves.keys)
        var nameByKey: [String: String] = [:]
        var binsByKey: [String: [Double]] = [:]
        for r in target.gaining + target.losing + baseline.gaining + baseline.losing {
            let k = "\(r.brand)|\(r.familyKey)"
            nameByKey[k] = r.family
            if let b = r.bins, binsByKey[k] == nil { binsByKey[k] = b }
        }

        var scored: [ShareMover] = []
        var eligibleCount = 0

        for k in allFams {
            let tm = target.familyMoves[k]
            let bm = baseline.familyMoves[k]
            let s12 = tm?.sold12m ?? 0
            let sp12 = bm?.sold12m ?? 0
            let u12 = tm?.usd12m ?? 0
            let up12 = bm?.usd12m ?? 0
            combinedFamilies[k] = MoveTuple(sold12m: s12, soldPrior12m: sp12, usd12m: u12, usdPrior12m: up12)

            guard s12 >= minGate && sp12 >= minGate else { continue }
            eligibleCount += 1
            let parts = k.split(separator: "|", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { continue }
            let brand = parts[0], fk = parts[1]
            let family = nameByKey[k] ?? fk

            let logRatio = log((Double(s12) / Double(tSoldTotal)) / (Double(sp12) / Double(bSoldTotal)))
            let se = sqrt(1.0 / Double(s12) + 1.0 / Double(sp12))
            let ratio = exp(logRatio)
            let shareMove = ratio - 1.0
            let shareLo = exp(logRatio - 1.96 * se) - 1.0
            let shareHi = exp(logRatio + 1.96 * se) - 1.0
            let z = se > 0 ? logRatio / se : 0
            let avgPriceMove: Double? = (s12 >= 3 && sp12 >= 3 && u12 > 0 && up12 > 0)
                ? ((u12 / Double(s12)) / (up12 / Double(sp12)) - 1.0)
                : nil

            scored.append(ShareMover(
                brand: brand,
                familyKey: fk,
                family: family,
                sold: s12,
                prior: sp12,
                usd: u12,
                usdPrior: up12,
                ratio: ratio,
                lo: shareLo,
                hi: shareHi,
                move: shareMove,
                se: se,
                z: z,
                avgPriceMove: avgPriceMove,
                bins: binsByKey[k]
            ))
        }

        let sigGaining = scored.filter { $0.lo > 0 }.sorted { $0.lo > $1.lo }
        let sigLosing = scored.filter { $0.hi < 0 }.sorted { $0.hi < $1.hi }
        let gaining = Array((sigGaining.isEmpty ? scored.filter { $0.move > 0 }.sorted { $0.move > $1.move } : sigGaining).prefix(limit))
        let losing = Array((sigLosing.isEmpty ? scored.filter { $0.move < 0 }.sorted { $0.move < $1.move } : sigLosing).prefix(limit))

        return ShareMoversRead(
            marketSold: target.marketSold,
            marketPrior: baseline.marketSold,
            marketUsd: target.marketUsd,
            marketUsdPrior: baseline.marketUsd,
            marketMove: baseline.marketSold > 0 ? Double(target.marketSold - baseline.marketSold) / Double(baseline.marketSold) : 0,
            candidates: eligibleCount,
            families: allFams.count,
            significant: sigGaining.count + sigLosing.count,
            sources: target.sources,
            brandMoves: combinedBrands,
            familyMoves: combinedFamilies,
            gaining: gaining,
            losing: losing
        )
    }
}

/// Family upcoming supply & live finish estimates (`treemap_family_upcoming_supply` in `FamilySalesChart.tsx` #1819).
struct FamilyUpcomingSupply: Equatable {
    struct Counts: Equatable {
        let batLive: Int
        let auctionCalendar: Int
        let facebookMarketplace: Int
        let total: Int
    }
    struct LiveLot: Equatable, Identifiable {
        let vehicleId: String
        let year: Int?
        let make: String?
        let model: String?
        let title: String
        let currentBid: Double?
        let endsAt: String?
        let sourceUrl: String?
        let noReserve: Bool
        let finishEstimate: Double?
        let finishLow: Double?
        let finishHigh: Double?
        let finishGrade: String?
        var id: String { vehicleId }
        var vehicleUUID: UUID? { UUID(uuidString: vehicleId) }
    }
    struct CalendarLot: Equatable, Identifiable {
        let id: String
        let vehicleId: String?
        let year: Int?
        let title: String
        let house: String?
        let saleName: String?
        let runOn: String?
        let estimateLow: Double?
        let estimateHigh: Double?
        var vehicleUUID: UUID? { vehicleId.flatMap(UUID.init(uuidString:)) }
    }
    struct ClassifiedLot: Equatable, Identifiable {
        let id: String
        let vehicleId: String?
        let year: Int?
        let title: String
        let price: Double?
        let location: String?
        var vehicleUUID: UUID? { vehicleId.flatMap(UUID.init(uuidString:)) }
    }

    let finishModel: Int?
    let finishFresh: Bool
    let counts: Counts
    let liveLots: [LiveLot]
    let calendarLots: [CalendarLot]
    let classifiedLots: [ClassifiedLot]

    static func parse(_ data: Data) -> FamilyUpcomingSupply? {
        guard let v = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let countsObj = v["counts"] as? [String: Any] else { return nil }
        func num(_ x: Any?) -> Double? {
            if let d = x as? Double, d.isFinite { return d }
            if let i = x as? Int { return Double(i) }
            if let s = x as? String, let d = Double(s.trimmingCharacters(in: .whitespaces)), d.isFinite { return d }
            return nil
        }
        func str(_ x: Any?) -> String? {
            guard let s = x as? String else { return nil }
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        let batLive = Int((num(countsObj["bat_live"]) ?? 0).rounded())
        let calCount = Int((num(countsObj["auction_calendar"]) ?? 0).rounded())
        let fbCount = Int((num(countsObj["facebook_marketplace"]) ?? 0).rounded())
        let total = Int((num(countsObj["total"]) ?? Double(batLive + calCount + fbCount)).rounded())

        let liveLots: [LiveLot] = ((v["live_lots"] as? [[String: Any]]) ?? []).compactMap { o in
            guard let vid = str(o["vehicle_id"]) else { return nil }
            return LiveLot(
                vehicleId: vid,
                year: num(o["year"]).map { Int($0.rounded()) },
                make: str(o["make"]),
                model: str(o["model"]),
                title: str(o["title"]) ?? vid,
                currentBid: num(o["current_bid"]),
                endsAt: str(o["ends_at"]),
                sourceUrl: str(o["source_url"]),
                noReserve: (o["no_reserve"] as? Bool) == true,
                finishEstimate: num(o["finish_estimate"]),
                finishLow: num(o["finish_low"]),
                finishHigh: num(o["finish_high"]),
                finishGrade: str(o["finish_grade"])
            )
        }
        let calLots: [CalendarLot] = ((v["calendar_lots"] as? [[String: Any]]) ?? []).enumerated().map { idx, o in
            let vid = str(o["vehicle_id"])
            let eid = str(o["event_id"])
            return CalendarLot(
                id: eid ?? vid ?? "cal-\(idx)",
                vehicleId: vid,
                year: num(o["year"]).map { Int($0.rounded()) },
                title: str(o["title"]) ?? "Scheduled lot",
                house: str(o["house"]),
                saleName: str(o["sale_name"]),
                runOn: str(o["run_on"]),
                estimateLow: num(o["estimate_low"]),
                estimateHigh: num(o["estimate_high"])
            )
        }
        let fbLots: [ClassifiedLot] = ((v["classified_lots"] as? [[String: Any]]) ?? []).enumerated().map { idx, o in
            let vid = str(o["vehicle_id"])
            let id = str(o["id"]) ?? vid ?? "fb-\(idx)"
            return ClassifiedLot(
                id: id,
                vehicleId: vid,
                year: num(o["year"]).map { Int($0.rounded()) },
                title: str(o["title"]) ?? "Classified listing",
                price: num(o["price"]),
                location: str(o["location"])
            )
        }
        return FamilyUpcomingSupply(
            finishModel: num(v["finish_model"]).map { Int($0.rounded()) },
            finishFresh: (v["finish_fresh"] as? Bool) == true,
            counts: Counts(batLive: batLive, auctionCalendar: calCount, facebookMarketplace: fbCount, total: total),
            liveLots: liveLots,
            calendarLots: calLots,
            classifiedLots: fbLots
        )
    }
}

// MARK: - Family Sales & Like-for-Like Price Index (FamilySalesChart.tsx & FamilyPriceIndex.tsx twins)

struct FamilySalesData: Equatable {
    struct Sale: Equatable, Identifiable {
        let vehicle_id: String
        let sale_date: String
        let usd: Double
        let source: String?
        let year: Int?
        let model: String?
        var id: String { "\(vehicle_id)|\(sale_date)|\(Int(usd))" }
    }
    let sales: [Sale]
    let n: Int
    let truncated: Bool

    static let priceFloor: Double = 500

    static func parse(_ data: Data) -> FamilySalesData? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let n = obj["n"] as? Int,
              let rows = obj["rows"] as? [[Any]] else { return nil }
        var out: [Sale] = []
        out.reserveCapacity(rows.count)
        for r in rows {
            guard r.count == 6,
                  let vid = r[0] as? String,
                  let date = r[1] as? String else { return nil }
            let usd: Double?
            if let d = r[2] as? Double { usd = d }
            else if let i = r[2] as? Int { usd = Double(i) }
            else { usd = nil }
            guard let price = usd else { return nil }
            let source = r[3] as? String
            let year: Int?
            if let y = r[4] as? Int { year = y }
            else if let d = r[4] as? Double { year = Int(d) }
            else { year = nil }
            let model = r[5] as? String
            out.append(Sale(vehicle_id: vid, sale_date: date, usd: price, source: source, year: year, model: model))
        }
        let truncated = (obj["truncated"] as? Bool) == true
        return FamilySalesData(sales: out, n: n, truncated: truncated)
    }
}

struct FamilyIndex: Equatable {
    struct Point: Equatable, Identifiable {
        let t: Date
        let usd: Double
        let lo: Double
        let hi: Double
        let n: Int
        let median: Double?
        var id: TimeInterval { t.timeIntervalSince1970 }
    }
    struct Segment: Equatable, Identifiable {
        let key: String
        let label: String
        let change: Double?
        let lo: Double?
        let hi: Double?
        let nPrior: Int
        let nLast: Int
        let verdict: String
        var id: String { key }
    }
    let verdict: String // "up", "down", "flat", "too few to tell"
    let change: Double?
    let lo: Double?
    let hi: Double?
    let nPrior: Int
    let nLast: Int
    let periodKind: String?
    let series: [Point]
    let segments: [Segment]
    let rawChange: Double?
    let pairs: Int?
    let repeatChange: Double?
    let fittedAt: String?
    let stale: Bool

    static let validVerdicts: Set<String> = ["up", "down", "flat", "too few to tell"]

    static func parse(_ data: Data) -> FamilyIndex? {
        guard let v = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        func num(_ x: Any?) -> Double? {
            if let d = x as? Double, d.isFinite { return d }
            if let i = x as? Int { return Double(i) }
            if let s = x as? String, !s.trimmingCharacters(in: .whitespaces).isEmpty, let d = Double(s), d.isFinite { return d }
            return nil
        }
        let counts = (v["counts"] as? [String: Any]) ?? [:]
        let changeObj = v["change"] as? [String: Any]
        let fitted = changeObj != nil
        if !fitted {
            let floor = (v["floor"] as? [String: Any]) ?? [:]
            if let yr = num(floor["sales_each_year"]),
               let tot = num(floor["sales_total"]),
               (num(counts["n_last12"]) ?? 0) >= yr,
               (num(counts["n_prior12"]) ?? 0) >= yr,
               (num(counts["n_total"]) ?? 0) >= tot {
                return nil
            }
        }
        let c: [String: Any]
        if let changeObj {
            c = changeObj
        } else if v["counts"] != nil {
            c = [
                "verdict": "too few to tell",
                "n_last12": counts["n_last12"] as Any,
                "n_prior12": counts["n_prior12"] as Any
            ]
        } else {
            return nil
        }
        let verdict = String(describing: c["verdict"] ?? "")
        guard validVerdicts.contains(verdict) else { return nil }

        let rawSeries = (v["series"] as? [[String: Any]]) ?? []
        let series: [Point] = fitted ? rawSeries.compactMap { r in
            guard let ps = r["period_start"] as? String,
                  let d = ProfileClock.date(ps.count <= 10 ? "\(ps)T00:00:00Z" : ps),
                  let usd = num(r["index_usd"]), usd > 0,
                  let lo = num(r["lo_usd"]), lo > 0,
                  let hi = num(r["hi_usd"]), hi > 0 else { return nil }
            return Point(t: d, usd: usd, lo: lo, hi: hi, n: Int(num(r["n"]) ?? 0), median: num(r["raw_median_usd"]))
        }.sorted(by: { $0.t < $1.t }) : []

        let segsRaw = (c["chips"] as? [[String: Any]]) ?? (c["segments"] as? [[String: Any]]) ?? []
        let segments: [Segment] = segsRaw.compactMap { r in
            let label = String(describing: r["label"] ?? r["key"] ?? "")
            guard !label.isEmpty else { return nil }
            let key = String(describing: r["key"] ?? label)
            return Segment(
                key: key,
                label: label,
                change: num(r["change"] ?? r["change_12m"]),
                lo: num(r["lo"]),
                hi: num(r["hi"]),
                nPrior: Int(num(r["n_prior12"]) ?? 0),
                nLast: Int(num(r["n_last12"]) ?? 0),
                verdict: String(describing: r["verdict"] ?? "too few to tell")
            )
        }
        let pk = v["period_kind"] as? String
        let periodKind = (pk == "month" || pk == "quarter") ? pk : (series.isEmpty ? nil : "quarter")
        return FamilyIndex(
            verdict: verdict,
            change: num(c["change_12m"]),
            lo: num(c["lo"]),
            hi: num(c["hi"]),
            nPrior: Int(num(c["n_prior12"]) ?? 0),
            nLast: Int(num(c["n_last12"]) ?? 0),
            periodKind: periodKind,
            series: series,
            segments: segments,
            rawChange: num(c["raw_change"]),
            pairs: num(c["pairs"]).map { Int($0) },
            repeatChange: num(c["rs_change"]),
            fittedAt: (v["fitted_at"] as? String) ?? (c["fitted_at"] as? String),
            stale: (v["stale"] as? Bool) == true
        )
    }

    var answerText: String {
        if verdict == "too few to tell" || change == nil { return "Too few sales to tell" }
        if verdict == "flat", let c = change {
            let w: Double
            if let lo, let hi { w = max(abs(lo), abs(hi)) } else { w = abs(c) }
            return "Flat: within ±\(max(1, Int((w * 100.0).rounded())))% in 12 months"
        }
        guard let c = change else { return "Too few sales to tell" }
        return "\(LedgerMapScale.pct(c)) in 12 months"
    }

    var evidenceText: String {
        var parts: [String] = []
        if let lo, let hi, verdict != "too few to tell" {
            let pts = Int((((hi - lo) / 2.0) * 100.0).rounded())
            parts.append("±\(pts) points (95%)")
        }
        parts.append("\((nPrior + nLast).formatted()) sales in the two years")
        if verdict == "too few to tell" && change == nil {
            parts.append("needs 30 a year")
        }
        if let rc = rawChange {
            parts.append("plain median said \(LedgerMapScale.pct(rc))")
        }
        if stale, let fa = fittedAt, let d = ProfileClock.date(fa) {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = TimeZone(secondsFromGMT: 0)
            f.dateFormat = "MMM d"
            parts.append("measured \(f.string(from: d))")
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Generation / Era Cohorts (familyEras.ts twin)

struct FamilyEraCohort: Equatable, Identifiable {
    let id: String
    let label: String
    let shortLabel: String
    let yearStart: Int
    let yearEnd: Int
    var count: Int = 0

    static let ckTruckEras: [FamilyEraCohort] = [
        .init(id: "1960-1966", label: "1st Gen '60–'66", shortLabel: "'60–'66", yearStart: 1960, yearEnd: 1966),
        .init(id: "1967-1972", label: "Action Line '67–'72", shortLabel: "Action Line '67–'72", yearStart: 1967, yearEnd: 1972),
        .init(id: "1973-1987", label: "Squarebody '73–'87", shortLabel: "Squarebody '73–'87", yearStart: 1973, yearEnd: 1987),
        .init(id: "1988-1998", label: "GMT400 '88–'98", shortLabel: "GMT400 '88–'98", yearStart: 1988, yearEnd: 1998)
    ]

    static let curated: [String: [FamilyEraCohort]] = [
        "ford:mustang": [
            .init(id: "1964-1973", label: "1st Gen '64–'73", shortLabel: "1st Gen '64–'73", yearStart: 1964, yearEnd: 1973),
            .init(id: "1974-1978", label: "Mustang II '74–'78", shortLabel: "Mustang II", yearStart: 1974, yearEnd: 1978),
            .init(id: "1979-1993", label: "Fox Body '79–'93", shortLabel: "Fox Body '79–'93", yearStart: 1979, yearEnd: 1993),
            .init(id: "1994-2004", label: "SN95 '94–'04", shortLabel: "SN95 '94–'04", yearStart: 1994, yearEnd: 2004),
            .init(id: "2005-2014", label: "S197 '05–'14", shortLabel: "S197 '05–'14", yearStart: 2005, yearEnd: 2014),
            .init(id: "2015-2023", label: "S550 '15–'23", shortLabel: "S550 '15–'23", yearStart: 1915, yearEnd: 2023),
            .init(id: "2024-2030", label: "S650 '24+", shortLabel: "S650 '24+", yearStart: 2024, yearEnd: 2030)
        ],
        "chevrolet:corvette": [
            .init(id: "1953-1962", label: "C1 '53–'62", shortLabel: "C1", yearStart: 1953, yearEnd: 1962),
            .init(id: "1963-1967", label: "C2 '63–'67", shortLabel: "C2", yearStart: 1963, yearEnd: 1967),
            .init(id: "1968-1982", label: "C3 '68–'82", shortLabel: "C3", yearStart: 1968, yearEnd: 1982),
            .init(id: "1984-1996", label: "C4 '84–'96", shortLabel: "C4", yearStart: 1984, yearEnd: 1996),
            .init(id: "1997-2004", label: "C5 '97–'04", shortLabel: "C5", yearStart: 1997, yearEnd: 2004),
            .init(id: "2005-2013", label: "C6 '05–'13", shortLabel: "C6", yearStart: 2005, yearEnd: 2013),
            .init(id: "2014-2019", label: "C7 '14–'19", shortLabel: "C7", yearStart: 2014, yearEnd: 2019),
            .init(id: "2020-2030", label: "C8 '20+", shortLabel: "C8", yearStart: 2020, yearEnd: 2030)
        ],
        "porsche:911": [
            .init(id: "1964-1973", label: "F-Body '64–'73", shortLabel: "F-Body", yearStart: 1964, yearEnd: 1973),
            .init(id: "1974-1988", label: "G-Body '74–'88", shortLabel: "G-Body", yearStart: 1974, yearEnd: 1988),
            .init(id: "1989-1994", label: "964 '89–'94", shortLabel: "964", yearStart: 1989, yearEnd: 1994),
            .init(id: "1995-1998", label: "993 '95–'98", shortLabel: "993", yearStart: 1995, yearEnd: 1998),
            .init(id: "1999-2004", label: "996 '99–'04", shortLabel: "996", yearStart: 1999, yearEnd: 2004),
            .init(id: "2005-2012", label: "997 '05–'12", shortLabel: "997", yearStart: 2005, yearEnd: 2012),
            .init(id: "2013-2019", label: "991 '13–'19", shortLabel: "991", yearStart: 2013, yearEnd: 2019),
            .init(id: "2020-2030", label: "992 '20+", shortLabel: "992", yearStart: 2020, yearEnd: 2030)
        ],
        "bmw:m3": [
            .init(id: "1986-1991", label: "E30 '86–'91", shortLabel: "E30", yearStart: 1986, yearEnd: 1991),
            .init(id: "1992-1999", label: "E36 '92–'99", shortLabel: "E36", yearStart: 1992, yearEnd: 1999),
            .init(id: "2000-2006", label: "E46 '00–'06", shortLabel: "E46", yearStart: 2000, yearEnd: 2006),
            .init(id: "2007-2013", label: "E90/E92 '07–'13", shortLabel: "E90/E92", yearStart: 2007, yearEnd: 2013),
            .init(id: "2014-2018", label: "F80 '14–'18", shortLabel: "F80", yearStart: 2014, yearEnd: 2018),
            .init(id: "2021-2030", label: "G80 '21+", shortLabel: "G80", yearStart: 2021, yearEnd: 2030)
        ],
        "ford:bronco": [
            .init(id: "1966-1977", label: "Early Bronco '66–'77", shortLabel: "'66–'77", yearStart: 1966, yearEnd: 1977),
            .init(id: "1978-1979", label: "2nd Gen '78–'79", shortLabel: "'78–'79", yearStart: 1978, yearEnd: 1979),
            .init(id: "1980-1986", label: "Bullnose '80–'86", shortLabel: "'80–'86", yearStart: 1980, yearEnd: 1986),
            .init(id: "1987-1991", label: "Bricknose '87–'91", shortLabel: "'87–'91", yearStart: 1987, yearEnd: 1991),
            .init(id: "1992-1996", label: "OBS '92–'96", shortLabel: "'92–'96", yearStart: 1992, yearEnd: 1996),
            .init(id: "2021-2030", label: "6th Gen '21+", shortLabel: "'21+", yearStart: 2021, yearEnd: 2030)
        ],
        "chevrolet:c/k pickup": ckTruckEras,
        "chevrolet:c10": ckTruckEras,
        "chevrolet:k10": ckTruckEras,
        "chevrolet:k5 blazer": ckTruckEras
    ]

    static func cohorts(brand: String?, familyName: String?, years: [Int]) -> [FamilyEraCohort] {
        let valid = years.filter { $0 >= 1886 && $0 <= 2100 }
        let key = "\((brand ?? "").trimmingCharacters(in: .whitespaces).lowercased()):\((familyName ?? "").trimmingCharacters(in: .whitespaces).lowercased())"
        if let list = curated[key] {
            if valid.isEmpty { return list }
            let withCounts = list.map { c -> FamilyEraCohort in
                var copy = c
                copy.count = valid.filter { $0 >= c.yearStart && $0 <= c.yearEnd }.count
                return copy
            }.filter { $0.count > 0 }
            return withCounts.count >= 2 ? withCounts : list
        }
        guard !valid.isEmpty else { return [] }
        var byDecade: [Int: Int] = [:]
        for y in valid {
            let d = (y / 10) * 10
            byDecade[d, default: 0] += 1
        }
        let decades = byDecade.filter { $0.value >= 3 }.sorted(by: { $0.key < $1.key }).map { d, cnt in
            FamilyEraCohort(id: "\(d)-\(d + 9)", label: "\(d)s", shortLabel: "\(d)s", yearStart: d, yearEnd: d + 9, count: cnt)
        }
        return decades.count >= 2 ? decades : []
    }

    static func matches(year: Int?, eraId: String?) -> Bool {
        guard let eraId, !eraId.isEmpty else { return true }
        let parts = eraId.split(whereSeparator: { $0 == "-" || $0 == "–" })
        guard parts.count == 2, let lo = Int(parts[0]), let hi = Int(parts[1]), lo <= hi else { return true }
        guard let year else { return false }
        return year >= lo && year <= hi
    }
}

// MARK: - RPC Client & Formatting Surface

enum LedgerMap {
    private struct MakeParams: Encodable { let p_make: String }
    private struct BrandParams: Encodable { let p_brand: String }
    private struct FamilyParams: Encodable { let p_brand: String; let p_family_key: String }
    private struct YearParams: Encodable { let p_source: String?; let p_make: String?; let p_model: String? }
    private struct SalesParams: Encodable { let p_make: String; let p_model: String; let p_year: Int? }
    private struct MapParams: Encodable { let p_brands: Int; let p_families: Int }
    private struct ShareMoverParams: Encodable { let p_limit: Int; let p_min_sales: Int; let p_horizon: String }

    static func oneDecimal(_ x: Double) -> String {
        String(format: "%.1f", (x * 10).rounded(.toNearestOrAwayFromZero) / 10)
    }

    static func money(_ n: Double) -> String {
        guard n > 0, n.isFinite else { return "--" }
        if n >= 1_000_000_000 { return "$" + oneDecimal(n / 1_000_000_000) + "B" }
        if n >= 1_000_000 { return "$" + oneDecimal(n / 1_000_000) + "M" }
        if n >= 1_000 { return "$\(Int((n / 1_000).rounded()).formatted())K" }
        return "$" + Int(n.rounded()).formatted()
    }

    static func color(median: Int?) -> Color {
        guard let m = median, m > 0 else { return Color(.tertiarySystemFill) }
        let step: Double = m < 10_000 ? 1 : m < 25_000 ? 2 : m < 50_000 ? 3 : m < 100_000 ? 4 : m < 250_000 ? 5 : 6
        return Color.orange.opacity(0.12 + 0.13 * step)
    }

    static func makes() async throws -> [LedgerNode] {
        try await brands()
    }

    static func refreshReceipt() async -> LedgerRefreshReceipt? {
        let rows: [LedgerRefreshReceipt]? = try? await SupabaseService.client
            .from("treemap_refreshes")
            .select("refreshed_at,populations")
            .order("refreshed_at", ascending: false)
            .limit(1)
            .execute()
            .value
        return rows?.first
    }

    static func brands() async throws -> [LedgerNode] {
        async let rawBrands: [LedgerNode] = SupabaseService.client.rpc("treemap_by_brand").execute().value
        async let marketRows: [BrandMarketRow]? = try? SupabaseService.client.rpc("treemap_brand_market").execute().value
        let list = try await rawBrands
        let mRows = await marketRows ?? []
        var byBrand: [String: BrandMarketRow] = [:]
        for r in mRows { byBrand[r.brand.uppercased()] = r }
        return list.map { b in
            var copy = b
            if let m = byBrand[b.name.uppercased()] {
                copy.usd = m.usd
                copy.sold_any = m.sold_any
                copy.offered = m.offered
                copy.dated = m.dated
                copy.sold_12m = m.sold_12m
                copy.sold_prior_12m = m.sold_prior_12m
                copy.usd_12m = m.usd_12m
                copy.usd_prior_12m = m.usd_prior_12m
            }
            return copy
        }
    }

    static func brandFamilyMap() async -> [BrandFamilyMapRow]? {
        try? await SupabaseService.client
            .rpc("treemap_brand_family_map", params: MapParams(p_brands: 60, p_families: 12))
            .execute().value
    }

    static func families(brand: String) async throws -> (nodes: [LedgerNode], isCanonicalFamilies: Bool) {
        if let rows: [FamilyMarketRow] = try? await SupabaseService.client
            .rpc("treemap_brand_families", params: BrandParams(p_brand: brand))
            .execute().value, !rows.isEmpty {
            return (rows.map { $0.toLedgerNode() }, true)
        }
        let fallback: [LedgerNode] = try await SupabaseService.client
            .rpc("treemap_models_by_brand", params: MakeParams(p_make: brand))
            .execute().value
        return (fallback, false)
    }

    static func familyModels(brand: String, familyKey: String) async throws -> [LedgerNode] {
        let rows: [FamilyModelRow] = try await SupabaseService.client
            .rpc("treemap_family_models", params: FamilyParams(p_brand: brand, p_family_key: familyKey))
            .execute().value
        return rows.map { $0.toLedgerNode() }
    }

    static func models(make: String) async throws -> [LedgerNode] {
        try await SupabaseService.client.rpc("treemap_models_by_brand", params: MakeParams(p_make: make)).execute().value
    }

    static func years(make: String, model: String) async throws -> [LedgerNode] {
        try await SupabaseService.client.rpc("treemap_years", params: YearParams(p_source: nil, p_make: make, p_model: model)).execute().value
    }

    static func sales(make: String, model: String, year: Int?) async throws -> [LedgerVehicle] {
        try await SupabaseService.client
            .rpc("treemap_sales", params: SalesParams(p_make: make, p_model: model, p_year: year))
            .execute().value
    }

    static func familySales(brand: String, familyKey: String) async -> FamilySalesData? {
        guard let res = try? await SupabaseService.client
            .rpc("treemap_family_sales", params: FamilyParams(p_brand: brand, p_family_key: familyKey))
            .execute() else { return nil }
        return FamilySalesData.parse(res.data)
    }

    static func familyPriceIndex(brand: String, familyKey: String) async -> FamilyIndex? {
        guard let res = try? await SupabaseService.client
            .rpc("family_price_index_read", params: FamilyParams(p_brand: brand, p_family_key: familyKey))
            .execute() else { return nil }
        return FamilyIndex.parse(res.data)
    }

    static func familyUpcomingSupply(brand: String, familyKey: String) async -> FamilyUpcomingSupply? {
        guard let res = try? await SupabaseService.client
            .rpc("treemap_family_upcoming_supply", params: FamilyParams(p_brand: brand, p_family_key: familyKey))
            .execute() else { return nil }
        return FamilyUpcomingSupply.parse(res.data)
    }

    static func shareMovers(horizon: MoverHorizon) async -> ShareMoversRead? {
        guard let res = try? await SupabaseService.client
            .rpc("treemap_family_share_movers", params: ShareMoverParams(p_limit: 5, p_min_sales: horizon.gateMinSales, p_horizon: horizon.rawValue))
            .execute() else { return nil }
        return ShareMoversRead.parse(res.data)
    }
}

// MARK: - LedgerMapView

struct LedgerMapView: View {
    var onSelectVehicle: ((UUID) -> Void)? = nil

    enum Level: Equatable {
        case brands
        case families
        case models
        case years
        case vehicles
    }

    @State private var selectedMake: String?
    @State private var selectedFamilyKey: String?
    @State private var selectedFamilyName: String?
    @State private var selectedModel: String?
    @State private var selectedYear: Int?
    @State private var selectedEra: String?

    @State private var basis: LedgerMapScale.MapBasis = .ledger
    @State private var brandViewMode: LedgerMapScale.BrandViewMode = .brands

    @State private var nodes: [LedgerNode] = []
    @State private var brandNodesCache: [LedgerNode] = []
    @State private var familyNodesCache: [LedgerNode] = []
    @State private var modelNodesCache: [LedgerNode] = []
    @State private var yearNodesCache: [LedgerNode] = []
    @State private var brandFamilyRows: [BrandFamilyMapRow] = []

    @State private var vehicles: [LedgerVehicle] = []
    @State private var receipt: LedgerRefreshReceipt?
    @State private var familySalesData: FamilySalesData?
    @State private var familyIndex: FamilyIndex?
    @State private var familyUpcomingSupply: FamilyUpcomingSupply?

    @State private var moverHorizon: MoverHorizon = .y1
    @State private var baselineHorizon: BaselineHorizon = .prior
    @State private var movers: ShareMoversRead?
    @State private var baselineMovers: ShareMoversRead?
    @State private var moversLoading = false
    @State private var showRelativityInfo = false

    @State private var loading = true
    @State private var failed = false

    @State private var inspectedNode: LedgerNode?

    private var level: Level {
        if selectedMake == nil { return .brands }
        if selectedFamilyKey == nil && selectedModel == nil { return .families }
        if selectedModel == nil && selectedYear == nil { return .models }
        if selectedYear == nil { return .years }
        return .vehicles
    }

    private var pathKey: String {
        [selectedMake ?? "", selectedFamilyKey ?? "", selectedModel ?? "", selectedYear.map(String.init) ?? ""].joined(separator: "/")
    }

    private var moverTaskKey: String {
        "\(moverHorizon.rawValue)|\(baselineHorizon.rawValue)"
    }

    private var activeMovers: ShareMoversRead? {
        guard let m = movers else { return nil }
        if baselineHorizon == .prior || baselineHorizon.moverHorizon == moverHorizon {
            return m
        }
        guard let bm = baselineMovers else { return m }
        return ShareMoversRead.combine(target: m, baseline: bm, targetHorizon: moverHorizon)
    }

    private var isCustomHorizonOverlay: Bool {
        moverHorizon != .y1 || baselineHorizon != .prior
    }

    /// Overlays active `moverHorizon` / `baselineHorizon` counts onto a node (`applyMoverHorizon` in `HomePage.tsx`).
    private func applyHorizonOverlay(_ node: LedgerNode) -> LedgerNode {
        guard isCustomHorizonOverlay, let am = activeMovers else { return node }
        var copy = node
        if level == .brands {
            if let tuple = am.brandMoves[node.name] {
                copy.sold_12m = tuple.sold12m
                copy.sold_prior_12m = tuple.soldPrior12m
                copy.usd_12m = tuple.usd12m
                copy.usd_prior_12m = tuple.usdPrior12m
            }
        } else if level == .families, let make = selectedMake, let fk = node.familyKey {
            if let tuple = am.familyMoves["\(make)::\(fk)"] ?? am.familyMoves["\(make)|\(fk)"] {
                copy.sold_12m = tuple.sold12m
                copy.sold_prior_12m = tuple.soldPrior12m
                copy.usd_12m = tuple.usd12m
                copy.usd_prior_12m = tuple.usdPrior12m
            }
        }
        return copy
    }

    private var baseline: LedgerMapScale.Baseline? {
        if isCustomHorizonOverlay, let am = activeMovers, am.marketSold > 0, am.marketPrior > 0 {
            return LedgerMapScale.Baseline(
                sold: am.marketSold,
                prior: am.marketPrior,
                move: am.marketMove
            )
        }
        return LedgerMapScale.batBaseline(brandNodesCache.isEmpty ? nodes : brandNodesCache)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            headerSection
            breadcrumbsBar
            quickSwitchPills
            if level == .brands {
                mapCalloutsBar
            }
            if selectedMake != nil, let fk = selectedFamilyKey, fk != "other" {
                familyChartAndIndexCard
            }
            canvas
                .frame(height: level == .vehicles ? nil : 430)
            if level == .brands || level == .families {
                legendFooter
            }
            if level == .brands, let houses = receipt?.populations?.by_house, !houses.isEmpty {
                venueMixBar(houses)
            }
            if level == .brands {
                relativityMoversCard
            }
        }
        .padding(16)
        .task(id: pathKey) { await load() }
        .task {
            if receipt == nil {
                receipt = await LedgerMap.refreshReceipt()
            }
        }
        .task(id: moverTaskKey) {
            moversLoading = true
            async let targetTask = LedgerMap.shareMovers(horizon: moverHorizon)
            let baseH = baselineHorizon.moverHorizon
            async let baseTask: ShareMoversRead? = (baseH != nil && baseH != moverHorizon)
                ? LedgerMap.shareMovers(horizon: baseH!)
                : nil
            let (tRes, bRes) = await (targetTask, baseTask)
            movers = tRes
            baselineMovers = bRes
            moversLoading = false
        }
        .sheet(item: $inspectedNode) { node in
            nodeSheet(node)
        }
        .sheet(isPresented: $showRelativityInfo) {
            relativityInfoSheet
        }
    }

    // MARK: - Header & Controls

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(headerTitle)
                    .font(.system(.title3, design: .monospaced).weight(.semibold))
                Spacer()
                Text(headerMeasureLine)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
            }
            if level == .brands || level == .families {
                HStack(spacing: 8) {
                    if level == .brands {
                        segmentedPill(
                            options: LedgerMapScale.BrandViewMode.allCases,
                            selection: $brandViewMode,
                            label: \.label
                        )
                    }
                    Spacer()
                    segmentedPill(
                        options: LedgerMapScale.MapBasis.allCases,
                        selection: $basis,
                        label: \.label
                    )
                }
            }
        }
    }

    private var headerTitle: String {
        if let make = selectedMake, let model = selectedModel ?? selectedFamilyName, let year = selectedYear {
            return "\(year) \(make) \(model)"
        }
        if let make = selectedMake, let model = selectedModel {
            return "\(make) \(model)"
        }
        if let make = selectedMake, let fam = selectedFamilyName {
            return "\(make) \(fam)"
        }
        if let make = selectedMake {
            return make
        }
        return "Market Map"
    }

    private var headerMeasureLine: String {
        let clock = receipt?.refreshClock() ?? ""
        if level == .vehicles {
            return "\(vehicles.count.formatted()) confirmed sales\(clock)"
        }
        let total = filteredNodes.reduce(0) { $0 + $1.count }
        guard total > 0 else { return loading ? "reading…" : "0 confirmed sales" }
        let usdTotal = filteredNodes.reduce(0.0) { $0 + ($1.usd ?? $1.value ?? 0) }
        let moneyPrefix = usdTotal > 0 ? "\(LedgerMap.money(usdTotal)) · " : ""
        if level == .brands, let pub = receipt?.populations?.public_records, pub > 0, receipt?.isConfirmedSaleMeasure == true {
            let mapped = receipt?.populations?.mapped_sales ?? total
            return "\(moneyPrefix)\(mapped.formatted()) confirmed sales of \(pub.formatted()) public records\(clock)"
        }
        return "\(moneyPrefix)\(total.formatted()) confirmed sales\(clock)"
    }

    private func segmentedPill<T: Hashable>(options: [T], selection: Binding<T>, label: KeyPath<T, String>) -> some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.self) { opt in
                let active = selection.wrappedValue == opt
                Button {
                    selection.wrappedValue = opt
                } label: {
                    Text(opt[keyPath: label])
                        .font(.system(.caption2, design: .monospaced).weight(active ? .semibold : .regular))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(active ? Color.primary.opacity(0.14) : Color.clear, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(Color(.secondarySystemBackground), in: Capsule())
    }

    // MARK: - Breadcrumbs & Quick-Switch Pills

    private var breadcrumbsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                crumb("All Makes", active: selectedMake == nil) {
                    selectedMake = nil
                    selectedFamilyKey = nil
                    selectedFamilyName = nil
                    selectedModel = nil
                    selectedYear = nil
                    selectedEra = nil
                }
                if let make = selectedMake {
                    Text("›").foregroundStyle(.tertiary)
                    crumb(make, active: selectedFamilyKey == nil && selectedModel == nil && selectedYear == nil) {
                        selectedFamilyKey = nil
                        selectedFamilyName = nil
                        selectedModel = nil
                        selectedYear = nil
                        selectedEra = nil
                    }
                }
                if let fam = selectedFamilyName {
                    Text("›").foregroundStyle(.tertiary)
                    crumb(fam, active: selectedModel == nil && selectedYear == nil) {
                        selectedModel = nil
                        selectedYear = nil
                    }
                }
                if let model = selectedModel, model.lowercased() != (selectedFamilyName ?? "").lowercased() {
                    Text("›").foregroundStyle(.tertiary)
                    crumb(model, active: selectedYear == nil) {
                        selectedYear = nil
                    }
                }
                if let year = selectedYear {
                    Text("›").foregroundStyle(.tertiary)
                    crumb(String(year), active: true) {}
                }
            }
            .font(.system(.footnote, design: .monospaced))
        }
    }

    private func crumb(_ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .fontWeight(active ? .semibold : .regular)
                .foregroundStyle(active ? .primary : .secondary)
                .padding(.vertical, 4)
                .padding(.horizontal, 8)
                .background(active ? Color(.secondarySystemBackground) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .disabled(active)
    }

    @ViewBuilder
    private var quickSwitchPills: some View {
        VStack(alignment: .leading, spacing: 6) {
            // 1. Families pill bar when inside a brand
            if selectedMake != nil, familyNodesCache.count > 1 {
                pillRow(title: "FAMILIES") {
                    pillButton("All \(selectedMake ?? "")", active: selectedFamilyKey == nil && selectedModel == nil) {
                        selectedFamilyKey = nil
                        selectedFamilyName = nil
                        selectedModel = nil
                        selectedYear = nil
                        selectedEra = nil
                    }
                    ForEach(familyNodesCache.prefix(20)) { f in
                        let fk = f.familyKey ?? f.name
                        let active = selectedFamilyKey == fk
                        pillButton("\(f.name) (\(f.count.formatted()))", active: active) {
                            selectedFamilyKey = fk
                            selectedFamilyName = f.name
                            selectedModel = nil
                            selectedYear = nil
                            selectedEra = nil
                        }
                    }
                }
            }

            // 2. Sub-models pill bar when inside a family with >1 sub-models
            if selectedMake != nil, selectedFamilyKey != nil, modelNodesCache.count > 1 {
                pillRow(title: "SUB-MODELS") {
                    pillButton("All \(selectedFamilyName ?? "Family")", active: selectedModel == nil) {
                        selectedModel = nil
                        selectedYear = nil
                    }
                    ForEach(modelNodesCache.prefix(20)) { m in
                        let active = selectedModel == m.name
                        pillButton("\(m.name) (\(m.count.formatted()))", active: active) {
                            selectedModel = m.name
                            selectedYear = nil
                        }
                    }
                }
            }

            // 3. Generation / Era cohort pills when inside a family or model
            let eras = availableEras
            if selectedMake != nil, (selectedFamilyName != nil || selectedModel != nil), !eras.isEmpty {
                pillRow(title: "ERAS") {
                    pillButton("All Eras", active: selectedEra == nil && selectedYear == nil) {
                        selectedEra = nil
                        selectedYear = nil
                    }
                    ForEach(eras) { cohort in
                        let active = selectedEra == cohort.id
                        let text = cohort.count > 0 ? "\(cohort.shortLabel) (\(cohort.count))" : cohort.shortLabel
                        pillButton(text, active: active) {
                            selectedEra = active ? nil : cohort.id
                            selectedYear = nil
                        }
                    }
                }
            }

            // 4. Model years pill bar when inside a family or model
            let yrs = availableYearNodes
            if selectedMake != nil, (selectedFamilyKey != nil || selectedModel != nil), !yrs.isEmpty {
                pillRow(title: "YEARS") {
                    pillButton("All Years", active: selectedYear == nil) {
                        selectedYear = nil
                    }
                    ForEach(yrs, id: \.year) { item in
                        let active = selectedYear == item.year
                        pillButton("\(item.year) (\(item.count))", active: active) {
                            selectedYear = active ? nil : item.year
                        }
                    }
                }
            }
        }
    }

    private var availableEras: [FamilyEraCohort] {
        let yrs = availableYearNodesWithoutEra.map(\.year)
        return FamilyEraCohort.cohorts(
            brand: selectedMake,
            familyName: selectedFamilyName ?? selectedModel,
            years: yrs
        )
    }

    private var availableYearNodesWithoutEra: [(year: Int, count: Int)] {
        if !yearNodesCache.isEmpty {
            return yearNodesCache.compactMap { n in
                guard let y = Int(n.name), y >= 1886, y <= 2100 else { return nil }
                return (y, n.count)
            }.sorted(by: { $0.year > $1.year })
        }
        if let sales = familySalesData?.sales, !sales.isEmpty {
            var counts: [Int: Int] = [:]
            for s in sales {
                if let y = s.year, y >= 1886, y <= 2100 {
                    counts[y, default: 0] += 1
                }
            }
            return counts.map { ($0.key, $0.value) }.sorted(by: { $0.year > $1.year })
        }
        return []
    }

    private var availableYearNodes: [(year: Int, count: Int)] {
        availableYearNodesWithoutEra.filter { FamilyEraCohort.matches(year: $0.year, eraId: selectedEra) }
    }

    private func pillRow<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.trailing, 2)
                content()
            }
        }
    }

    private func pillButton(_ text: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(.system(.caption2, design: .monospaced).weight(active ? .semibold : .regular))
                .foregroundStyle(active ? Color(.systemBackground) : .primary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(active ? Color.primary : Color(.secondarySystemBackground), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Callouts Bar

    @ViewBuilder
    private var mapCalloutsBar: some View {
        let items = LedgerMapScale.callouts(filteredNodes, base: baseline)
        if !items.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(items) { c in
                        Button {
                            selectedMake = c.name
                        } label: {
                            HStack(spacing: 6) {
                                Text(c.kind.label.uppercased())
                                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                Text(c.name)
                                    .font(.system(.caption2, design: .monospaced).weight(.semibold))
                                Text(LedgerMapScale.pct(c.rel))
                                    .font(.system(.caption2, design: .monospaced).weight(.bold))
                                    .foregroundStyle(c.rel >= 0 ? .green : .red)
                                Text("\(c.prior.formatted())→\(c.sold.formatted())")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Family Sales Chart & Like-for-Like Index

    @ViewBuilder
    private var familyChartAndIndexCard: some View {
        if let salesData = familySalesData, !salesData.sales.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                if let ix = familyIndex {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text("SAME CAR, SAME MILES")
                                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(ix.answerText)
                                .font(.system(.footnote, design: .monospaced).weight(.bold))
                                .foregroundStyle(ix.verdict == "up" ? .green : ix.verdict == "down" ? .red : .primary)
                        }
                        Text(ix.evidenceText)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                        let readableSegs = ix.segments.filter { $0.verdict != "too few to tell" && $0.change != nil }
                        if readableSegs.count >= 2 {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(ix.segments) { seg in
                                        let val = (seg.verdict == "too few to tell" || seg.change == nil)
                                            ? "too few"
                                            : (seg.verdict == "flat" ? "flat" : LedgerMapScale.pct(seg.change ?? 0))
                                        Text("\(seg.label) \(val)")
                                            .font(.system(size: 10, design: .monospaced))
                                            .padding(.horizontal, 7)
                                            .padding(.vertical, 3)
                                            .background(Color(.tertiarySystemFill), in: Capsule())
                                    }
                                }
                            }
                        }
                    }
                }

                let scopedSales = salesData.sales.filter { s in
                    guard s.usd >= FamilySalesData.priceFloor else { return false }
                    if let m = selectedModel, (s.model ?? "").lowercased() != m.lowercased() { return false }
                    if let y = selectedYear, s.year != y { return false }
                    return FamilyEraCohort.matches(year: s.year, eraId: selectedEra)
                }

                HStack {
                    Text("\(scopedSales.count.formatted()) CONFIRMED SALES (5Y)")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Spacer()
                    HStack(spacing: 8) {
                        venueLegendDot("BaT", color: .primary)
                        venueLegendDot("Mecum", color: .orange)
                        venueLegendDot("B-J", color: .purple)
                        venueLegendDot("Houses", color: .blue)
                    }
                }

                if #available(iOS 16.0, *), !scopedSales.isEmpty {
                    Chart {
                        ForEach(scopedSales.prefix(600)) { s in
                            if let d = ProfileClock.date(s.sale_date.count <= 10 ? "\(s.sale_date)T00:00:00Z" : s.sale_date) {
                                PointMark(
                                    x: .value("Date", d),
                                    y: .value("Price", s.usd)
                                )
                                .symbolSize(18)
                                .foregroundStyle(venueColor(s.source).opacity(0.65))
                            }
                        }
                    }
                    .chartYScale(type: .log)
                    .frame(height: 130)
                }

                // Upcoming supply & live finish estimates (`FamilySalesChart.tsx` #1819)
                if let up = familyUpcomingSupply, up.counts.total > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            Text("UPCOMING \(up.counts.total.formatted())")
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: 4))
                            if up.counts.batLive > 0 {
                                let mTag = (up.finishFresh && up.finishModel != nil) ? " · M\(up.finishModel!)" : ""
                                Text("\(up.counts.batLive) BaT live\(mTag)")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            if up.counts.auctionCalendar > 0 {
                                Text("\(up.counts.auctionCalendar) calendar")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            if up.counts.facebookMarketplace > 0 {
                                Text("\(up.counts.facebookMarketplace) FB")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(up.liveLots.prefix(8)) { lot in
                                    let bidStr = lot.currentBid.map { "Bid \(LedgerMap.money($0))" } ?? "Live"
                                    let estStr = lot.finishEstimate.map { " → Est \(LedgerMap.money($0))" } ?? ""
                                    upcomingLotChip(
                                        badge: "LIVE",
                                        badgeColor: .green,
                                        title: lot.title,
                                        sub: "\(bidStr)\(estStr)",
                                        uuid: lot.vehicleUUID
                                    )
                                }
                                ForEach(up.calendarLots.prefix(6)) { lot in
                                    let est: String = {
                                        if let lo = lot.estimateLow, let hi = lot.estimateHigh {
                                            return "\(LedgerMap.money(lo))–\(LedgerMap.money(hi))"
                                        }
                                        return lot.runOn ?? "Scheduled"
                                    }()
                                    upcomingLotChip(
                                        badge: (lot.house ?? "CAL").uppercased(),
                                        badgeColor: .orange,
                                        title: lot.title,
                                        sub: est,
                                        uuid: lot.vehicleUUID
                                    )
                                }
                                ForEach(up.classifiedLots.prefix(6)) { lot in
                                    let pStr = lot.price.map { "Ask \(LedgerMap.money($0))" } ?? (lot.location ?? "Classified")
                                    upcomingLotChip(
                                        badge: "FB",
                                        badgeColor: .blue,
                                        title: lot.title,
                                        sub: pStr,
                                        uuid: lot.vehicleUUID
                                    )
                                }
                            }
                        }
                    }
                    .padding(.top, 2)
                }
            }
            .padding(12)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    @ViewBuilder
    private func upcomingLotChip(badge: String, badgeColor: Color, title: String, sub: String, uuid: UUID?) -> some View {
        let content = VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(badge)
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .foregroundStyle(badgeColor)
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
            }
            Text(sub)
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(width: 155, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 6))

        if let uuid {
            if let onSelectVehicle {
                Button { onSelectVehicle(uuid) } label: { content }.buttonStyle(.plain)
            } else {
                NavigationLink(value: VehicleHeaderRow(id: uuid, year: nil, make: selectedMake, model: selectedFamilyName, trim: nil, primary_image_url: nil, city: nil, state: nil)) {
                    content
                }
                .buttonStyle(.plain)
            }
        } else {
            content
        }
    }

    private func venueLegendDot(_ label: String, color: Color) -> some View {
        HStack(spacing: 3) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label).font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
        }
    }

    private func venueColor(_ source: String?) -> Color {
        switch source {
        case "Bring a Trailer": return .primary
        case "Mecum": return .orange
        case "Barrett-Jackson": return .purple
        case "RM Sotheby's", "Gooding & Co", "Bonhams", "Broad Arrow": return .blue
        case "Cars & Bids", "PCarMarket", "Collecting Cars", "SBX Cars": return .green
        default: return .gray
        }
    }

    // MARK: - Canvas

    private var filteredNodes: [LedgerNode] {
        let baseNodes: [LedgerNode] = {
            if level == .years, let era = selectedEra {
                return nodes.filter { n in
                    FamilyEraCohort.matches(year: Int(n.name), eraId: era)
                }
            }
            return nodes
        }()
        if level == .brands || level == .families {
            return baseNodes.map { applyHorizonOverlay($0) }
        }
        return baseNodes
    }

    @ViewBuilder
    private var canvas: some View {
        if loading {
            ProgressView()
                .frame(maxWidth: .infinity, minHeight: 280)
        } else if failed {
            VStack(spacing: 10) {
                Text("The map could not be read.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Retry") { Task { await load() } }
                    .font(.system(.footnote, design: .monospaced))
            }
            .frame(maxWidth: .infinity, minHeight: 280)
        } else if level == .vehicles {
            vehicleList
        } else if level == .brands && brandViewMode == .families && !brandFamilyRows.isEmpty {
            brandFamilyNestedCanvas
        } else if filteredNodes.isEmpty {
            Text("Nothing recorded under this selection.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 280)
        } else {
            GeometryReader { geo in
                let isBrandOrFamily = (level == .brands || level == .families)
                let items = filteredNodes.map { node in
                    (item: node, area: node.area(basis: basis, isBrandOrFamily: isBrandOrFamily))
                }
                let rects = LiveInventory.squarify(items, in: CGRect(origin: .zero, size: geo.size))
                ZStack(alignment: .topLeading) {
                    ForEach(Array(rects.enumerated()), id: \.offset) { _, tile in
                        cell(tile.item, rect: tile.rect)
                            .frame(width: max(0, tile.rect.width - 2), height: max(0, tile.rect.height - 2))
                            .offset(x: tile.rect.minX + 1, y: tile.rect.minY + 1)
                    }
                }
            }
        }
    }

    private var brandFamilyNestedCanvas: some View {
        GeometryReader { geo in
            let areaFn: (BrandFamilyMapRow) -> Double = { r in
                basis == .bat12 ? (r.usd_12m ?? 0) : (r.usd ?? 0)
            }
            let grouped = Dictionary(grouping: brandFamilyRows, by: \.brand)
            let brandGroups: [(brand: String, usd: Double, rows: [BrandFamilyMapRow])] = grouped.compactMap { brand, rows in
                let valid = rows.filter { areaFn($0) > 0 }
                let sum = valid.reduce(0.0) { $0 + areaFn($1) }
                guard sum > 0 else { return nil }
                return (brand, sum, valid)
            }.sorted(by: { $0.usd > $1.usd })

            let outerItems = brandGroups.map { (item: $0, area: $0.usd) }
            let outerRects = LiveInventory.squarify(outerItems, in: CGRect(origin: .zero, size: geo.size))

            ZStack(alignment: .topLeading) {
                ForEach(Array(outerRects.enumerated()), id: \.offset) { _, frame in
                    let b = frame.item
                    let r = frame.rect
                    let headH: CGFloat = (r.height > 44 && r.width > 64) ? 16 : 0
                    let innerRect = CGRect(
                        x: r.minX + 1,
                        y: r.minY + headH + 1,
                        width: max(0, r.width - 2),
                        height: max(0, r.height - headH - 2)
                    )
                    let innerItems = b.rows.map { (item: $0, area: areaFn($0)) }
                    let innerTiles = LiveInventory.squarify(innerItems, in: innerRect)

                    if headH > 0 {
                        Button {
                            selectedMake = b.brand
                        } label: {
                            HStack(spacing: 4) {
                                Text(b.brand.uppercased())
                                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                                    .lineLimit(1)
                                Text(LedgerMap.money(b.usd))
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 4)
                            .frame(width: r.width, height: headH)
                            .background(Color(.tertiarySystemBackground))
                        }
                        .buttonStyle(.plain)
                        .offset(x: r.minX, y: r.minY)
                    }

                    ForEach(Array(innerTiles.enumerated()), id: \.offset) { _, famTile in
                        let row = famTile.item
                        let rawNode = row.toLedgerNode()
                        let node: LedgerNode = {
                            guard isCustomHorizonOverlay,
                                  let m = activeMovers,
                                  let mv = m.familyMoves["\(row.brand)|\(row.family_key)"] ?? m.familyMoves["\(row.brand)::\(row.family_key)"] else {
                                return rawNode
                            }
                            var copy = rawNode
                            copy.sold_12m = mv.sold12m
                            copy.sold_prior_12m = mv.soldPrior12m
                            return copy
                        }()
                        let move: LedgerMapScale.Move = (row.family_key == "more" || row.family_key == "other")
                            ? .none
                            : LedgerMapScale.relativeMove(node, base: baseline, allVenues: basis == .ledger)
                        Button {
                            selectedMake = row.brand
                            if row.family_key != "more" && row.family_key != "other" {
                                selectedFamilyKey = row.family_key
                                selectedFamilyName = row.family ?? row.family_key
                            }
                        } label: {
                            ZStack(alignment: .topLeading) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(LedgerMapScale.tileColor(move))
                                if famTile.rect.width >= 38 && famTile.rect.height >= 22 {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(row.displayLabel)
                                            .font(.system(size: 10, weight: .semibold))
                                            .lineLimit(1)
                                        if famTile.rect.height >= 36 {
                                            let mText = LedgerMapScale.moveTextShort(move)
                                            if !mText.isEmpty {
                                                Text(mText)
                                                    .font(.system(size: 8, design: .monospaced))
                                                    .foregroundStyle(.secondary)
                                                    .lineLimit(1)
                                            }
                                        }
                                    }
                                    .padding(3)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .frame(width: max(0, famTile.rect.width - 1), height: max(0, famTile.rect.height - 1))
                        .offset(x: famTile.rect.minX, y: famTile.rect.minY)
                    }
                }
            }
        }
    }

    private func cell(_ node: LedgerNode, rect: CGRect) -> some View {
        let isBrandOrFamily = (level == .brands || level == .families)
        let move: LedgerMapScale.Move = isBrandOrFamily && node.familyKey != "other"
            ? LedgerMapScale.relativeMove(node, base: baseline, allVenues: basis == .ledger)
            : .none
        let bg: Color = isBrandOrFamily
            ? LedgerMapScale.tileColor(move)
            : warmthFill(node.median_price)

        return Button {
            drill(node)
        } label: {
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(bg)
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5)
                if rect.width >= 44 && rect.height >= 28 {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(node.name)
                            .font(.system(size: rect.width > 95 ? 12 : 10, weight: .semibold))
                            .lineLimit(1)
                        if rect.height >= 44 {
                            if isBrandOrFamily {
                                let mLine = rect.width > 110 ? LedgerMapScale.moveText(move) : LedgerMapScale.moveTextShort(move)
                                if !mLine.isEmpty {
                                    Text(mLine)
                                        .font(.system(size: 10, design: .monospaced).weight(.medium))
                                        .foregroundStyle(.primary.opacity(0.85))
                                        .lineLimit(1)
                                }
                            } else if let med = node.median_price, med > 0 {
                                Text(LedgerMap.money(med))
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        if rect.height >= 62 && rect.width >= 78 {
                            let usdVal = basis == .bat12 ? (node.usd_12m ?? node.usd) : (node.usd ?? node.value)
                            let soldVal = basis == .bat12 ? (node.sold_12m ?? node.count) : node.count
                            if let u = usdVal, u > 0 {
                                Text("\(LedgerMap.money(u)) · \(soldVal.formatted())")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            } else {
                                Text("\(soldVal.formatted()) sold")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                    .padding(6)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Inspect \(node.name)") { inspectedNode = node }
            Button("Open \(node.name)") { drill(node) }
        }
    }

    private func warmthFill(_ price: Double?) -> Color {
        guard let p = price, p > 0 else { return Color(.secondarySystemBackground) }
        let t = min(max((log10(p) - 3.7) / 2.3, 0), 1)
        return Color.orange.opacity(0.10 + 0.32 * t)
    }

    // MARK: - Leaf Vehicle List

    private var vehicleList: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(vehicles) { v in
                Group {
                    if let onSelectVehicle {
                        Button { onSelectVehicle(v.id) } label: { vehicleRowContent(v) }
                            .buttonStyle(.plain)
                    } else {
                        NavigationLink(value: v.headerRow) { vehicleRowContent(v) }
                            .buttonStyle(.plain)
                    }
                }
                Divider()
            }
        }
    }

    private func vehicleRowContent(_ v: LedgerVehicle) -> some View {
        HStack(spacing: 12) {
            if let url = v.primary_image_url.flatMap(URL.init(string:)) {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() }
                    else { Color(.secondarySystemBackground) }
                }
                .frame(width: 64, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(.secondarySystemBackground))
                    .frame(width: 64, height: 48)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(v.name)
                    .font(.footnote.weight(.medium))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    if let src = v.source, !src.isEmpty {
                        Text(src)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    if let sd = v.sale_date, !sd.isEmpty {
                        Text(String(sd.prefix(10)))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    if let mi = v.mileage, mi > 0 {
                        Text("\(Int(mi).formatted()) mi")
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer(minLength: 8)
            Text(LedgerMap.money(v.price))
                .font(.system(.footnote, design: .monospaced).weight(.semibold))
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    // MARK: - Legend & Venue Mix

    private var legendFooter: some View {
        let baseText: String = {
            guard let b = baseline else { return "" }
            return " (\(LedgerMapScale.pct(b.move)), \(b.prior.formatted()) → \(b.sold.formatted()))"
        }()
        let clock = receipt?.refreshClock() ?? ""
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                ForEach(["−50%", "−33%", "−17%", "0", "+17%", "+33%", "+50%"], id: \.self) { lbl in
                    Text(lbl)
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            Text("Color: 12-month Bring a Trailer sales move against the market\(baseText). Size: \(basis == .bat12 ? "measured BaT dollars, last 12 months" : "dollars of confirmed sales across all venues and years"). Prices not adjusted for inflation\(clock).")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }

    private func venueMixBar(_ rows: [LedgerRefreshReceipt.HouseRow]) -> some View {
        let total = rows.reduce(0) { $0 + $1.sales }
        return VStack(alignment: .leading, spacing: 6) {
            if total > 0 {
                GeometryReader { geo in
                    HStack(spacing: 1) {
                        ForEach(rows) { r in
                            let share = CGFloat(r.sales) / CGFloat(total)
                            Rectangle()
                                .fill(venueColor(r.house))
                                .frame(width: max(2, geo.size.width * share))
                        }
                    }
                }
                .frame(height: 6)
                .clipShape(Capsule())

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(rows.filter { Double($0.sales) / Double(total) >= 0.02 }) { r in
                            let pct = max(1, Int((Double(r.sales) * 100.0 / Double(total)).rounded()))
                            HStack(spacing: 4) {
                                Circle().fill(venueColor(r.house)).frame(width: 6, height: 6)
                                Text("\(r.house ?? "other") \(pct)% (\(r.sales.formatted()))")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Relativity & Horizon Movers Card

    private var relativityMoversCard: some View {
        let displayMovers = activeMovers
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Button {
                            showRelativityInfo = true
                        } label: {
                            HStack(spacing: 3) {
                                Text("RELATIVITY")
                                Image(systemName: "info.circle")
                                    .font(.system(size: 9))
                            }
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: 4))
                        }
                        .buttonStyle(.plain)
                        Text(moverHorizon == .upcoming ? "Upcoming vs recent supply" : "What moved against the market")
                            .font(.system(.footnote, design: .monospaced).weight(.semibold))
                    }
                    if let m = displayMovers {
                        let mPct = LedgerMapScale.pct(m.marketMove)
                        let vsLabel = baselineHorizon == .prior ? moverHorizon.windowText : "\(moverHorizon.label) vs \(baselineHorizon.label)"
                        Text("\(vsLabel) · \(m.marketPrior.formatted()) → \(m.marketSold.formatted()) (\(mPct))")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }

            // 8-step Horizon Dial + VS Baseline Selector (#1817)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(MoverHorizon.allCases) { h in
                        let active = moverHorizon == h
                        Button {
                            moverHorizon = h
                        } label: {
                            Text(h.label)
                                .font(.system(size: 10, weight: active ? .bold : .regular, design: .monospaced))
                                .foregroundStyle(active ? Color(.systemBackground) : .primary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(active ? Color.primary : Color(.tertiarySystemFill), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    Text("VS")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(.trailing, 2)
                    ForEach(BaselineHorizon.allCases) { bh in
                        let active = baselineHorizon == bh
                        let disabled = bh.moverHorizon == moverHorizon
                        Button {
                            guard !disabled else { return }
                            baselineHorizon = bh
                        } label: {
                            Text(bh.label)
                                .font(.system(size: 9, weight: active ? .bold : .regular, design: .monospaced))
                                .foregroundStyle(disabled ? Color.secondary.opacity(0.45) : (active ? Color(.systemBackground) : Color.secondary))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(active ? Color.primary.opacity(0.85) : Color(.tertiarySystemFill), in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(disabled)
                    }
                }
            }

            if moversLoading && displayMovers == nil {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 80)
            } else if let m = displayMovers {
                if m.gaining.isEmpty && m.losing.isEmpty {
                    Text("No family moved clearly beyond random variation in this window.")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                } else {
                    if !m.gaining.isEmpty {
                        moverColumn(
                            title: moverHorizon == .upcoming ? "COMING UP MORE" : "SELLING MORE",
                            rows: m.gaining,
                            up: true
                        )
                    }
                    if !m.losing.isEmpty {
                        moverColumn(
                            title: moverHorizon == .upcoming ? "COMING UP LESS" : "SELLING LESS",
                            rows: m.losing,
                            up: false
                        )
                    }
                }
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    private var relativityInfoSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("How Relativity Is Measured")
                        .font(.headline)
                    Text("Every tile and mover row compares a brand or family's sales against the whole market over the selected horizon:")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("move = (family_now / family_base) ÷ (market_now / market_base) − 1")
                        .font(.system(.caption, design: .monospaced))
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 6))
                    Text("• **Confidence gating**: On the Relativity board, a family only appears if its 95% Poisson log-ratio confidence band (`lo` to `hi`) stays entirely above or below 1.0× par.")
                        .font(.footnote)
                    Text("• **VS Baseline**: `PRIOR` compares the window against the immediately preceding window of the same length. Selecting `1D`–`5Y` compares the target window's per-day rate against the chosen baseline horizon.")
                        .font(.footnote)
                    Text("• **UPCOMING**: Compares currently live + scheduled + classified supply against the last 30 days of completed sales across all venues.")
                        .font(.footnote)
                }
                .padding(16)
            }
            .navigationTitle("Relativity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { showRelativityInfo = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func moverColumn(title: String, rows: [ShareMover], up: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("0.5× · 1× PAR · 2×")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            ForEach(rows) { r in
                Button {
                    selectedMake = r.brand
                    selectedFamilyKey = r.familyKey
                    selectedFamilyName = r.family
                    selectedModel = nil
                    selectedYear = nil
                } label: {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(r.brand) \(r.family)")
                                .font(.system(.caption, design: .monospaced).weight(.semibold))
                                .lineLimit(1)
                            HStack(spacing: 6) {
                                Text("\(r.prior.formatted()) → \(r.sold.formatted())")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                if let pm = r.avgPriceMove, abs(pm) >= 0.01 {
                                    Text("avg \(LedgerMapScale.pct(pm))")
                                        .font(.system(size: 9, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        Spacer(minLength: 4)
                        if let bins = r.bins, !bins.isEmpty {
                            moverMiniSparkline(bins: bins, up: up)
                                .frame(width: 40, height: 14)
                        }
                        relativityDotGauge(r: r, up: up)
                            .frame(width: 72, height: 14)
                        Text(LedgerMapScale.pct(r.move))
                            .font(.system(.caption, design: .monospaced).weight(.bold))
                            .foregroundStyle(up ? .green : .red)
                            .frame(width: 48, alignment: .trailing)
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func moverMiniSparkline(bins: [Double], up: Bool) -> some View {
        let maxV = max(bins.max() ?? 1.0, 1.0)
        let half = bins.count / 2
        return HStack(alignment: .bottom, spacing: 1) {
            ForEach(Array(bins.enumerated()), id: \.offset) { idx, v in
                let h = max(1, CGFloat(v / maxV) * 14)
                Rectangle()
                    .fill(idx >= half ? (up ? Color.green.opacity(0.75) : Color.red.opacity(0.75)) : Color.secondary.opacity(0.35))
                    .frame(width: 1, height: h)
            }
        }
    }

    private func relativityDotGauge(r: ShareMover, up: Bool) -> some View {
        GeometryReader { geo in
            let maxLog = log(2.2)
            let xOf: (Double) -> CGFloat = { ratio in
                let clamped = max(-maxLog, min(maxLog, log(max(ratio, 0.05))))
                return CGFloat((clamped + maxLog) / (2.0 * maxLog)) * geo.size.width
            }
            let xLo = xOf(r.lo)
            let xHi = xOf(r.hi)
            let xPt = xOf(r.ratio)
            let mid = geo.size.width * 0.5
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(Color.primary.opacity(0.12))
                    .frame(height: 1)
                Rectangle()
                    .fill(Color.primary.opacity(0.35))
                    .frame(width: 1, height: 10)
                    .offset(x: mid)
                Rectangle()
                    .fill((up ? Color.green : Color.red).opacity(0.45))
                    .frame(width: max(2, xHi - xLo), height: 3)
                    .offset(x: xLo)
                Circle()
                    .fill(up ? Color.green : Color.red)
                    .frame(width: 6, height: 6)
                    .offset(x: xPt - 3)
            }
        }
    }

    // MARK: - Node Inspection Sheet

    private func nodeSheet(_ node: LedgerNode) -> some View {
        let move = LedgerMapScale.relativeMove(node, base: baseline, allVenues: basis == .ledger)
        return NavigationStack {
            List {
                Section(node.name) {
                    if case .move(let rel, let raw, let sold, let prior) = move {
                        LabeledContent("12m vs Market", value: LedgerMapScale.pct(rel))
                        LabeledContent("BaT Sales (12m)", value: "\(prior.formatted()) → \(sold.formatted()) (\(LedgerMapScale.pct(raw)))")
                    }
                    if let u = node.usd, u > 0 {
                        LabeledContent("Confirmed Sales", value: "\(node.count.formatted()) · \(LedgerMap.money(u))")
                    } else {
                        LabeledContent("Confirmed Sales", value: node.count.formatted())
                    }
                    if let off = node.offered, off >= 20, let sa = node.sold_any {
                        let st = Int((Double(sa) * 100.0 / Double(off)).rounded())
                        LabeledContent("Sell-through", value: "\(st)% of \(off.formatted()) offered")
                    }
                    if let med = node.median_price, med > 0 {
                        LabeledContent("Median Price", value: LedgerMap.money(med))
                    }
                    if let m = node.models, m > 0 {
                        LabeledContent("Sub-models", value: m.formatted())
                    }
                }
            }
            .navigationTitle(node.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { inspectedNode = nil }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Open") {
                        let target = node
                        inspectedNode = nil
                        drill(target)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Drill & Data Loading

    private func drill(_ node: LedgerNode) {
        switch level {
        case .brands:
            selectedMake = node.name
        case .families:
            if let fk = node.familyKey {
                selectedFamilyKey = fk
                selectedFamilyName = node.name
            } else {
                selectedModel = node.name
            }
        case .models:
            selectedModel = node.name
        case .years:
            selectedYear = Int(node.name)
        case .vehicles:
            break
        }
    }

    private func load() async {
        loading = true
        failed = false
        defer { loading = false }
        do {
            switch level {
            case .brands:
                let list = try await LedgerMap.brands()
                brandNodesCache = list
                nodes = list
                vehicles = []
                familyNodesCache = []
                modelNodesCache = []
                yearNodesCache = []
                familySalesData = nil
                familyIndex = nil
                familyUpcomingSupply = nil
                if brandFamilyRows.isEmpty {
                    Task {
                        if let bf = await LedgerMap.brandFamilyMap() {
                            brandFamilyRows = bf
                        }
                    }
                }

            case .families:
                guard let make = selectedMake else { return }
                let (fams, isCanonical) = try await LedgerMap.families(brand: make)
                if isCanonical {
                    familyNodesCache = fams
                } else {
                    familyNodesCache = []
                }
                nodes = fams
                vehicles = []
                modelNodesCache = []
                yearNodesCache = []
                familySalesData = nil
                familyIndex = nil
                familyUpcomingSupply = nil

            case .models:
                guard let make = selectedMake, let fk = selectedFamilyKey else { return }
                async let modelsTask = LedgerMap.familyModels(brand: make, familyKey: fk)
                async let salesTask = LedgerMap.familySales(brand: make, familyKey: fk)
                async let indexTask = LedgerMap.familyPriceIndex(brand: make, familyKey: fk)
                async let upcomingTask = LedgerMap.familyUpcomingSupply(brand: make, familyKey: fk)
                let subModels = try await modelsTask
                modelNodesCache = subModels
                familySalesData = await salesTask
                familyIndex = await indexTask
                familyUpcomingSupply = await upcomingTask

                if subModels.count == 1, let only = subModels.first {
                    selectedModel = only.name
                    let yrs = try await LedgerMap.years(make: make, model: only.name)
                    yearNodesCache = yrs
                    nodes = yrs
                } else {
                    nodes = subModels
                }
                vehicles = []

            case .years:
                guard let make = selectedMake else { return }
                if let model = selectedModel {
                    let yrs = try await LedgerMap.years(make: make, model: model)
                    yearNodesCache = yrs
                    nodes = yrs
                } else if let fk = selectedFamilyKey {
                    if familySalesData == nil {
                        familySalesData = await LedgerMap.familySales(brand: make, familyKey: fk)
                    }
                    if familyUpcomingSupply == nil {
                        familyUpcomingSupply = await LedgerMap.familyUpcomingSupply(brand: make, familyKey: fk)
                    }
                    let derived = deriveYearsFromFamilySales(familySalesData?.sales ?? [])
                    yearNodesCache = derived
                    nodes = derived
                }
                vehicles = []

            case .vehicles:
                guard let make = selectedMake, let year = selectedYear else { return }
                if let model = selectedModel {
                    vehicles = try await LedgerMap.sales(make: make, model: model, year: year)
                } else if let fk = selectedFamilyKey {
                    if familySalesData == nil {
                        familySalesData = await LedgerMap.familySales(brand: make, familyKey: fk)
                    }
                    let fromFamily = (familySalesData?.sales ?? []).filter { $0.year == year }
                    vehicles = fromFamily.compactMap { s in
                        guard let uuid = UUID(uuidString: s.vehicle_id) else { return nil }
                        let title = [s.year.map(String.init), make, s.model ?? selectedFamilyName].compactMap { $0 }.joined(separator: " ")
                        return LedgerVehicle(
                            id: uuid,
                            year: s.year,
                            make: make,
                            model: s.model ?? selectedFamilyName,
                            title: title,
                            price: s.usd,
                            image: nil,
                            mileage: nil,
                            sale_date: s.sale_date,
                            source: s.source,
                            url: nil
                        )
                    }
                }
                nodes = []
            }
        } catch {
            failed = true
        }
    }

    private func deriveYearsFromFamilySales(_ sales: [FamilySalesData.Sale]) -> [LedgerNode] {
        var byYear: [Int: [Double]] = [:]
        for s in sales {
            guard let y = s.year, y >= 1886, y <= 2100 else { continue }
            byYear[y, default: []].append(s.usd)
        }
        return byYear.map { year, prices in
            let sorted = prices.sorted()
            let med = sorted.isEmpty ? 0 : sorted[sorted.count / 2]
            let total = prices.reduce(0, +)
            return LedgerNode(
                name: String(year),
                count: prices.count,
                value: total,
                median_price: med,
                min_price: sorted.first,
                max_price: sorted.last,
                sold_count: prices.count,
                auction_count: prices.count,
                avg_bids: nil,
                avg_watchers: nil,
                usd: total
            )
        }.sorted(by: { $0.count > $1.count })
    }
}
