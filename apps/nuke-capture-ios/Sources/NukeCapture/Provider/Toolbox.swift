// Toolbox.swift — a person's tools as user_toolbox_read states them.
//
// user_toolbox_read(p_user_id): each user_tools record matched to its maker's catalog product by the
// same brand and exact part number, with the maker's catalog photo (a pack shot, never a photo of
// this person's tool), the latest captured list price with its page and clock, and the quantity.
// List value is list price × quantity: the maker's price, not resale value and not what was paid.
// Paid amounts and purchase dates come from the owner's receipts and go to the owner only; the
// phone drops them for any other viewer even if a body carried them. Records without a catalog
// match are counted, never described. A visitor reads the list only when the owner made it public;
// otherwise the reader refuses with 'Toolbox not shared'.
// Decoding is tolerant: a missing block reads as not reported, never as zero.

import Foundation
import Supabase

struct Toolbox: Decodable, Equatable {
    struct PackShot: Decodable, Equatable {
        let imageUrl: String
        let basis: String?
        enum CodingKeys: String, CodingKey { case imageUrl = "image_url", basis }
    }

    struct ListPrice: Decodable, Equatable {
        let amount: Double
        let currency: String?
        let pageUrl: String?
        let capturedAt: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            guard let amount = ProviderStandingDecode.number(c, "amount") else {
                throw DecodingError.dataCorruptedError(forKey: JobCodingKey("amount"), in: c, debugDescription: "no list price amount")
            }
            self.amount = amount
            currency = try? c.decode(String.self, forKey: JobCodingKey("currency"))
            pageUrl = try? c.decode(String.self, forKey: JobCodingKey("page_url"))
            capturedAt = try? c.decode(String.self, forKey: JobCodingKey("captured_at"))
        }
    }

    /// From the owner's receipts. The reader states no currency for these amounts.
    struct Paid: Decodable, Equatable {
        let total: Double?
        let receipts: Int?
        let firstPurchase: String?
        let lastPurchase: String?
        let basis: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            total = ProviderStandingDecode.number(c, "total")
            receipts = try? c.decode(Int.self, forKey: JobCodingKey("receipts"))
            firstPurchase = try? c.decode(String.self, forKey: JobCodingKey("first_purchase"))
            lastPurchase = try? c.decode(String.self, forKey: JobCodingKey("last_purchase"))
            basis = try? c.decode(String.self, forKey: JobCodingKey("basis"))
        }
    }

    struct Item: Decodable, Equatable, Identifiable {
        let userToolId: String
        let toolCatalogId: String?
        let brand: String?
        let partNumber: String?
        let name: String?
        /// "maker_page" (as printed on the maker's page) or "receipt_line" (as written on the receipt).
        let nameBasis: String?
        let category: String?
        let quantity: Int?
        let packShot: PackShot?
        let listPrice: ListPrice?
        let listValue: Double?
        let matchBasis: String?
        /// Owner only; nil for every other viewer.
        let paid: Paid?
        var id: String { userToolId }

        init(from decoder: Decoder) throws {
            try self.init(from: decoder, owner: true)
        }

        init(from decoder: Decoder, owner: Bool) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            userToolId = try c.decode(String.self, forKey: JobCodingKey("user_tool_id"))
            toolCatalogId = try? c.decode(String.self, forKey: JobCodingKey("tool_catalog_id"))
            brand = Self.text(c, "brand")
            partNumber = Self.text(c, "part_number")
            name = Self.text(c, "name")
            nameBasis = try? c.decode(String.self, forKey: JobCodingKey("name_basis"))
            category = Self.text(c, "category")
            quantity = try? c.decode(Int.self, forKey: JobCodingKey("quantity"))
            packShot = (try? c.decode(PackShot.self, forKey: JobCodingKey("pack_shot"))).flatMap { $0.imageUrl.isEmpty ? nil : $0 }
            listPrice = try? c.decode(ListPrice.self, forKey: JobCodingKey("list_price"))
            listValue = ProviderStandingDecode.number(c, "list_value")
            matchBasis = try? c.decode(String.self, forKey: JobCodingKey("match_basis"))
            paid = owner ? (try? c.decode(Paid.self, forKey: JobCodingKey("paid"))) : nil
        }

        private static func text(_ c: KeyedDecodingContainer<JobCodingKey>, _ key: String) -> String? {
            (try? c.decode(String.self, forKey: JobCodingKey(key))).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
        }
    }

    struct Totals: Equatable {
        let listValue: Double?
        /// nil when no item has a list price, or when list prices are in more than one currency.
        let listValueCurrency: String?
        /// Owner only; nil for every other viewer.
        let paid: Double?
    }

    struct Coverage: Decodable, Equatable {
        let toolRecords: Int?
        let matchedToCatalog: Int?
        let unmatchedRecords: Int?
        let withPackShot: Int?
        let withListPrice: Int?

        enum CodingKeys: String, CodingKey {
            case toolRecords = "tool_records"
            case matchedToCatalog = "matched_to_catalog"
            case unmatchedRecords = "unmatched_records"
            case withPackShot = "with_pack_shot"
            case withListPrice = "with_list_price"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            toolRecords = try? c.decode(Int.self, forKey: .toolRecords)
            matchedToCatalog = try? c.decode(Int.self, forKey: .matchedToCatalog)
            unmatchedRecords = try? c.decode(Int.self, forKey: .unmatchedRecords)
            withPackShot = try? c.decode(Int.self, forKey: .withPackShot)
            withListPrice = try? c.decode(Int.self, forKey: .withListPrice)
        }
    }

    let userId: String?
    let asOf: String?
    let isOwner: Bool
    let items: [Item]
    let unreadableItems: Int
    let totals: Totals
    let coverage: Coverage?
    /// The reader's own words for each measure, keyed as it sends them.
    let basis: [String: String]

    private struct Viewer: Decodable { let owner: Bool? }

    private struct OwnerItem: Decodable {
        let value: Item?
        init(from decoder: Decoder) throws { value = try? Item(from: decoder, owner: true) }
    }
    private struct VisitorItem: Decodable {
        let value: Item?
        init(from decoder: Decoder) throws { value = try? Item(from: decoder, owner: false) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        userId = try? c.decode(String.self, forKey: JobCodingKey("user_id"))
        asOf = try? c.decode(String.self, forKey: JobCodingKey("as_of"))
        let owner = (try? c.decode(Viewer.self, forKey: JobCodingKey("viewer")))?.owner ?? false
        isOwner = owner
        let raw: [Item?] = owner
            ? ((try? c.decode([OwnerItem].self, forKey: JobCodingKey("items"))) ?? []).map(\.value)
            : ((try? c.decode([VisitorItem].self, forKey: JobCodingKey("items"))) ?? []).map(\.value)
        items = raw.compactMap { $0 }
        unreadableItems = raw.count - items.count
        if let t = try? c.nestedContainer(keyedBy: JobCodingKey.self, forKey: JobCodingKey("totals")) {
            totals = Totals(listValue: ProviderStandingDecode.number(t, "list_value"),
                            listValueCurrency: try? t.decode(String.self, forKey: JobCodingKey("list_value_currency")),
                            paid: owner ? ProviderStandingDecode.number(t, "paid") : nil)
        } else {
            totals = Totals(listValue: nil, listValueCurrency: nil, paid: nil)
        }
        coverage = try? c.decode(Coverage.self, forKey: JobCodingKey("coverage"))
        var words: [String: String] = [:]
        if case .object(let o)? = try? c.decode(JobJSON.self, forKey: JobCodingKey("basis")) {
            for (k, v) in o { if let s = v.stringValue { words[k] = s } }
        }
        basis = words
    }

    /// Categories the reader returned, in name order; items without one are under `ToolboxCopy.noCategory`.
    var categories: [String] {
        let named = Set(items.compactMap(\.category))
        let sorted = named.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        return items.contains { $0.category == nil } ? sorted + [ToolboxCopy.noCategory] : sorted
    }
}

// MARK: - Reader

enum ToolboxReaders {
    static let toolboxName = "user_toolbox_read"

    static func toolbox(userId: String) async -> JobLoad<Toolbox> {
        do {
            let data = try await SupabaseService.client.rpc(toolboxName, params: ["p_user_id": userId]).execute().data
            return .loaded(try JobReaders.decode(Toolbox.self, from: data))
        } catch {
            NSLog("NukeCapture %@ failed: %@", toolboxName, String(describing: error))
            return .refused(refusal(error))
        }
    }

    /// 'Toolbox not shared' is a 42501 for every viewer, signed in or not, so it is read before
    /// JobReaders.refusal would turn a signed-out 42501 into "Sign in".
    static func refusal(_ error: Error, signedIn: Bool = SupabaseService.currentUserId != nil) -> JobRefusal {
        if let pg = error as? PostgrestError, pg.message.contains("Toolbox not shared") {
            return JobRefusal(reader: toolboxName, kind: .unavailable, title: "Toolbox not shared",
                              detail: "Only its owner can see this toolbox until they make it public.")
        }
        return JobReaders.refusal(toolboxName, error, signedIn: signedIn)
    }
}

// MARK: - Sort, filter and words (unit-tested)

enum ToolboxSort: String, CaseIterable, Identifiable {
    case value, name, category
    var id: String { rawValue }
    var label: String {
        switch self {
        case .value: return "List value"
        case .name: return "Name"
        case .category: return "Category"
        }
    }
}

enum ToolboxCopy {
    static let noCategory = "No category"
    static let listValueBasis = "maker list price × quantity — not resale value"
    static let packShotCaption = "Maker's catalog photo, not a photo of your tool"
    static let packShotCaptionVisitor = "Maker's catalog photo, not a photo of their tool"

    static func filtered(_ items: [Toolbox.Item], category: String?) -> [Toolbox.Item] {
        guard let category else { return items }
        if category == noCategory { return items.filter { $0.category == nil } }
        return items.filter { $0.category == category }
    }

    /// Value: highest list value first, unpriced last. Name and category: A–Z. Ties by part number.
    static func sorted(_ items: [Toolbox.Item], by sort: ToolboxSort) -> [Toolbox.Item] {
        func text(_ s: String?) -> String { s ?? "" }
        func ascending(_ a: String?, _ b: String?) -> Bool? {
            switch (a, b) {
            case (nil, nil): return nil
            case (nil, _): return false
            case (_, nil): return true
            case let (x?, y?):
                let r = x.localizedCaseInsensitiveCompare(y)
                return r == .orderedSame ? nil : r == .orderedAscending
            }
        }
        func tie(_ a: Toolbox.Item, _ b: Toolbox.Item) -> Bool {
            ascending(a.partNumber, b.partNumber) ?? (a.userToolId < b.userToolId)
        }
        return items.sorted { a, b in
            switch sort {
            case .value:
                switch (a.listValue, b.listValue) {
                case let (x?, y?) where x != y: return x > y
                case (_?, nil): return true
                case (nil, _?): return false
                default: return tie(a, b)
                }
            case .name:
                return ascending(a.name, b.name) ?? tie(a, b)
            case .category:
                return ascending(a.category, b.category) ?? ascending(a.name, b.name) ?? tie(a, b)
            }
        }
    }

    static func money(_ amount: Double, _ currency: String?) -> String { JobMoney.format(amount, currency) }

    /// The header's list value: a sum only when the reader states one currency for it.
    static func listValueTotal(_ t: Toolbox) -> String {
        guard let v = t.totals.listValue else { return "No list prices captured yet" }
        guard let cur = t.totals.listValueCurrency else { return "Not totalled (more than one currency)" }
        return money(v, cur)
    }

    /// "maker list price × quantity — not resale value · 40 of 126 tools priced".
    static func listValueDecay(_ t: Toolbox) -> String {
        guard let c = t.coverage, let priced = c.withListPrice, let matched = c.matchedToCatalog else { return listValueBasis }
        return "\(listValueBasis) · \(JobCopy.count(priced)) of \(JobCopy.count(matched)) tools priced"
    }

    /// The paid amount carries no currency in the reader, so none is shown.
    static func plainAmount(_ v: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: v)) ?? String(v)
    }

    static func paidTotal(_ t: Toolbox) -> String? {
        guard t.isOwner else { return nil }
        return t.totals.paid.map(plainAmount) ?? "No paid amounts on your receipts"
    }

    static let paidDecay = "from your receipts · currency not recorded"

    static func quantity(_ q: Int?) -> String { q.map { "×\(JobCopy.count($0))" } ?? "Qty not recorded" }

    static func cardValue(_ i: Toolbox.Item) -> String {
        guard let v = i.listValue else { return i.listPrice == nil ? "No list price" : "Qty not recorded" }
        return money(v, i.listPrice?.currency)
    }

    static func title(_ i: Toolbox.Item) -> String { i.name ?? i.partNumber ?? "Unnamed tool" }

    static func partLine(_ i: Toolbox.Item) -> String? {
        let parts = [i.brand, i.partNumber].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func nameBasis(_ i: Toolbox.Item, owner: Bool) -> (status: RootStatus, words: String) {
        switch i.nameBasis {
        case "maker_page"?: return (.attributed, "as printed on the maker's page")
        case "receipt_line"?: return (.recorded, owner ? "as written on your receipt" : "as written on their receipt")
        default: return (.recorded, "source not stated")
        }
    }

    static func matchBasis(_ code: String?) -> String {
        switch code {
        case "same_brand_exact_part_number"?: return "Same brand, exact part number"
        case let other?: return JobCopy.sentence(other)
        case nil: return "Not stated"
        }
    }

    /// "captured Oct 19, 2026".
    static func captured(_ p: Toolbox.ListPrice) -> String {
        JobCopy.day(p.capturedAt).map { "maker's list price, captured \($0)" } ?? "maker's list price, capture date not stated"
    }

    static func makerPage(_ p: Toolbox.ListPrice?) -> URL? {
        guard let raw = p?.pageUrl, let u = URL(string: raw), u.scheme?.lowercased() == "https", u.host != nil else { return nil }
        return u
    }

    /// "Open on shop.snapon.com".
    static func makerPageLabel(_ url: URL) -> String {
        url.host.map { "Open on \($0)" } ?? "Open the maker's page"
    }

    /// A pack shot sized for its frame: imgix resizes on ?w=; other hosts go through NukeImage.
    static func packShotURL(_ raw: String?, width: Int) -> URL? {
        guard let raw, var comps = URLComponents(string: raw), let host = comps.host?.lowercased() else { return nil }
        guard host.hasSuffix(".imgix.net") else { return NukeImage.thumb(raw, width: width) }
        var q = comps.queryItems ?? []
        if !q.contains(where: { $0.name == "w" }) {
            q += [URLQueryItem(name: "w", value: String(width)), URLQueryItem(name: "fit", value: "max"),
                  URLQueryItem(name: "auto", value: "format")]
        }
        comps.queryItems = q
        return comps.url
    }

    /// "126 tool records · 120 matched to the maker's catalog · …"; unmatched records are counted only.
    static func coverageLines(_ t: Toolbox) -> [String] {
        guard let c = t.coverage else { return ["Coverage not reported."] }
        var lines: [String] = []
        if let n = c.toolRecords { lines.append("\(JobCopy.count(n)) tool \(n == 1 ? "record" : "records")") }
        if let n = c.matchedToCatalog { lines.append("\(JobCopy.count(n)) matched to the maker's catalog") }
        if let n = c.withPackShot { lines.append("\(JobCopy.count(n)) with a pack shot") }
        if let n = c.withListPrice { lines.append("\(JobCopy.count(n)) with a list price") }
        if let n = c.unmatchedRecords, n > 0 {
            lines.append("\(JobCopy.count(n)) \(n == 1 ? "record" : "records") without a catalog match, counted and not shown")
        }
        if t.unreadableItems > 0 { lines.append("\(JobCopy.count(t.unreadableItems)) unreadable, not shown") }
        return lines
    }
}
