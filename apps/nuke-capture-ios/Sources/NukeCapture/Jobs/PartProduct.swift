// PartProduct.swift — a part on a job as a product page (work_order_part_read).
//
// The reader (anon + authenticated, SECURITY DEFINER; migration 20261020070500) returns one part line:
// what it is (name and brand withheld from visitors when they name a person), its recorded line status
// (the record's mark, not a sign-off), its recorded prices (no currency is recorded; the job screens read
// them as dollars), the seller link, the part's product link (the seller page that evidenced the product,
// with the seller's photo; migration 20261020074500), the retailer offers recorded against it, the labor
// lines sharing its job code, and a catalog listing for the same part number. A product page or catalog
// listing describes the product at its own clock, never the part that was installed, so each is labelled
// with its source.
// Links open the seller's page in Safari; nothing is bought in the app. Part lines carry no key to an
// operation, so the reader names no operation and attributes no photo to a part; the page says so.

import SwiftUI

struct WorkOrderPartProduct: Decodable, Equatable {
    struct Part: Decodable, Equatable {
        let id: String
        let part_name: String?
        let part_name_visibility: String?
        let brand: String?
        let brand_visibility: String?
        let part_number: String?
        let category: String?
        let quantity: Double?
    }
    struct Line: Decodable, Equatable {
        let status: String?
        let recorded_at: String?
        let ai_extracted: Bool?
        let notes: String?
    }
    struct Price: Decodable, Equatable {
        let unit_price: Double?
        let total_price: Double?
        let is_comped: Bool?
    }
    struct Supplier: Decodable, Equatable {
        let label: String?
        let label_visibility: String?
        let buy_url: String?
        let buy_url_host: String?
    }
    struct Labor: Decodable, Equatable, Identifiable {
        let id: String
        let task_name: String?
        let status: String?
    }
    struct Operation: Decodable, Equatable {
        let jobOpCode: String?
        let labor: [Labor]

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            jobOpCode = try? c.decode(String.self, forKey: JobCodingKey("job_op_code"))
            labor = (try? c.decode([Lossy<Labor>].self, forKey: JobCodingKey("labor")))?.compactMap(\.value) ?? []
        }
    }
    struct CatalogSource: Decodable, Equatable {
        let name: String?
        let provider: String?
    }
    struct CatalogMatch: Decodable, Equatable {
        let catalog_part_id: String?
        let part_number: String?
        let name: String?
        let description: String?
        let manufacturer: String?
        let price_current: Double?
        let currency: String?
        let in_stock: Bool?
        let fits_models: [String]?
        let year_start: Int?
        let year_end: Int?
        let installation_difficulty: String?
        let product_image_url: String?
        let supplier_url: String?
        let source: CatalogSource?
        let clock: String?
    }
    struct Catalog: Decodable, Equatable {
        let state: String?
        let match_basis: String?
        let match: CatalogMatch?
        var same_as_product_link: Bool? = nil
    }
    struct ProductLink: Decodable, Equatable {
        let image_url: String?
        let product_name: String?
        let manufacturer: String?
        let part_number_as_printed: String?
        let source: String?
        let page_url: String?
        let page_host: String?
        let match_basis: String?
        let captured_at: String?
    }
    struct Offer: Decodable, Equatable, Identifiable {
        let id: String
        let retailer: String?
        let brand: String?
        let part_number: String?
        let condition: String?
        let price: Double?
        let in_stock: Bool?
        let url: String?
        let url_host: String?
        let is_selected: Bool?
        let recorded_at: String?
        let store_location: String?
        let notes: String?
    }
    struct Evidence: Decodable, Equatable {
        let state: String?
        let images: [WorkOrderEvidence.Photo]
        let imagesWithheld: Int
        let jobAttachments: Int?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            state = try? c.decode(String.self, forKey: JobCodingKey("state"))
            images = (try? c.decode([Lossy<WorkOrderEvidence.Photo>].self, forKey: JobCodingKey("images")))?.compactMap(\.value) ?? []
            imagesWithheld = (try? c.decode(Int.self, forKey: JobCodingKey("images_withheld"))) ?? 0
            jobAttachments = try? c.decode(Int.self, forKey: JobCodingKey("job_attachments"))
        }
    }

    let partId: String
    let asOf: String?
    let vehicleLabel: String?
    let part: Part?
    let line: Line?
    let price: Price?
    let supplier: Supplier?
    let imageUrl: String?
    let operation: Operation?
    let productLink: ProductLink?
    let productLinkBasis: String?
    let catalog: Catalog?
    let offers: [Offer]
    let evidence: Evidence?
    let party: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        partId = try c.decode(String.self, forKey: JobCodingKey("part_id"))
        asOf = try? c.decode(String.self, forKey: JobCodingKey("as_of"))
        vehicleLabel = (try? c.decode([String: JobJSON].self, forKey: JobCodingKey("vehicle_label")))?["text"]?.stringValue
        part = try? c.decode(Part.self, forKey: JobCodingKey("part"))
        line = try? c.decode(Line.self, forKey: JobCodingKey("line"))
        price = try? c.decode(Price.self, forKey: JobCodingKey("price"))
        supplier = try? c.decode(Supplier.self, forKey: JobCodingKey("supplier"))
        imageUrl = (try? c.decode([String: JobJSON].self, forKey: JobCodingKey("image")))?["url"]?.stringValue
        operation = try? c.decode(Operation.self, forKey: JobCodingKey("operation"))
        productLink = try? c.decode(ProductLink.self, forKey: JobCodingKey("product_link"))
        productLinkBasis = try? c.decode(String.self, forKey: JobCodingKey("product_link_basis"))
        catalog = try? c.decode(Catalog.self, forKey: JobCodingKey("catalog"))
        offers = (try? c.decode([Lossy<Offer>].self, forKey: JobCodingKey("offers")))?.compactMap(\.value) ?? []
        evidence = try? c.decode(Evidence.self, forKey: JobCodingKey("evidence"))
        party = (try? c.decode([String: JobJSON].self, forKey: JobCodingKey("viewer")))?["party"] == .bool(true)
    }
}

enum PartProductReaders {
    static let name = "work_order_part_read"

    static func read(partId: String) async -> JobLoad<WorkOrderPartProduct> {
        await JobReaders.call(name) {
            try await SupabaseService.client.rpc(name, params: ["p_part_id": partId]).execute().data
        }
    }
}

// MARK: - Words (pure; unit-tested)

enum PartProductCopy {
    static let withheldName = "Part (name withheld: it named a person)"

    /// "Bilstein 5100 Front Shock Absorber"; the brand leads only when the name does not already say it.
    static func title(name: String?, brand: String?, nameWithheld: Bool) -> String {
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        let b = brand?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        guard let n else { return nameWithheld ? withheldName : (b.map { "\($0) part" } ?? "Part, name not recorded") }
        guard let b, !n.lowercased().contains(b.lowercased()) else { return n }
        return "\(b) \(n)"
    }

    static func title(_ p: WorkOrderOperations.Part) -> String {
        title(name: p.part_name, brand: p.brand, nameWithheld: p.part_name_visibility != nil)
    }

    static func title(_ p: WorkOrderPartProduct.Part?) -> String {
        title(name: p?.part_name, brand: p?.brand, nameWithheld: p?.part_name_visibility != nil)
    }

    static func status(_ s: String?) -> String {
        switch s {
        case "installed"?: return "Installed"
        case "quoted"?: return "Quoted"
        case "not_used"?: return "Not used"
        case "cancelled"?: return "Cancelled"
        case let other?: return JobCopy.sentence(other)
        case nil: return "No status"
        }
    }

    static let statusBasis = "the part line's recorded status, not a sign-off"

    static func money(_ v: Double?) -> String? { v.map { JobMoney.format($0, "USD") } }

    static func quantity(_ q: Double?) -> String? {
        guard let q else { return nil }
        return q == q.rounded() ? String(Int(q)) : String(q)
    }

    /// The recorded total, else the recorded unit price; both as recorded, never multiplied out.
    static func price(_ p: WorkOrderPartProduct.Price?, quantity: Double?) -> (value: String, detail: String?) {
        let unit = money(p?.unit_price)
        let qty = quantity.flatMap { $0 == 1 ? nil : self.quantity($0) }
        let unitLine = unit.map { u in qty.map { "\($0) × \(u) each, as recorded" } ?? "\(u) each, as recorded" }
        let comped = p?.is_comped == true ? "goodwill, not charged" : nil
        if let total = money(p?.total_price) {
            return (total, [comped, unitLine].compactMap { $0 }.joined(separator: " · ").nilIfEmpty)
        }
        if let unit { return (unit + " each", [comped, qty.map { "quantity \($0)" }].compactMap { $0 }.joined(separator: " · ").nilIfEmpty) }
        return ("Not recorded", comped)
    }

    /// "PN BSN-24-187077 · $229.73" under a part row.
    static func rowDetail(_ p: WorkOrderOperations.Part) -> String {
        let price = money(p.total_price) ?? money(p.unit_price).map { "\($0) each" }
        return [p.part_number.map { "PN \($0)" }, quantity(p.quantity).flatMap { $0 == "1" ? nil : "qty \($0)" },
                p.is_comped == true ? "comped" : price]
            .compactMap { $0 }.joined(separator: " · ").nilIfEmpty ?? "No part number or price recorded"
    }

    /// Installed first, then quoted, then the rest; the reader's order within each.
    static func ordered(_ parts: [WorkOrderOperations.Part]) -> [WorkOrderOperations.Part] {
        let rank: (String?) -> Int = { s in s == "installed" ? 0 : s == "quoted" ? 1 : 2 }
        return parts.enumerated().sorted { (rank($0.element.status), $0.offset) < (rank($1.element.status), $1.offset) }.map(\.element)
    }

    /// "15 parts · 13 installed · 1 quoted".
    static func partsLine(_ parts: [WorkOrderOperations.Part]) -> String {
        let installed = parts.filter { $0.status == "installed" }.count
        let quoted = parts.filter { $0.status == "quoted" }.count
        return ["\(parts.count) part\(parts.count == 1 ? "" : "s") on record",
                installed == 0 ? nil : "\(installed) installed", quoted == 0 ? nil : "\(quoted) quoted"]
            .compactMap { $0 }.joined(separator: " · ")
    }

    private static let retailers: [String: String] = [
        "rockauto": "RockAuto", "autozone": "AutoZone", "oreilly": "O'Reilly", "summitracing": "Summit Racing",
        "amazon": "Amazon", "homedepot": "Home Depot", "costco": "Costco", "gmpartsgiant": "GM Parts Giant",
    ]

    static func retailer(_ key: String?, host: String?) -> String {
        if let k = key?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty {
            return retailers[k.lowercased()] ?? (k == k.lowercased() ? k.prefix(1).uppercased() + k.dropFirst() : k)
        }
        return host ?? "Retailer not recorded"
    }

    static func stock(_ b: Bool?) -> String {
        switch b {
        case true?: return "In stock"
        case false?: return "Out of stock"
        case nil: return "Stock not recorded"
        }
    }

    /// "new · In stock · recorded Feb 4, 2026".
    static func offerDetail(_ o: WorkOrderPartProduct.Offer) -> String {
        [o.condition.map { JobCopy.sentence($0).lowercased() }, stock(o.in_stock),
         [o.brand, o.part_number].compactMap { $0 }.joined(separator: " ").nilIfEmpty,
         JobCopy.day(o.recorded_at).map { "recorded \($0)" }]
            .compactMap { $0 }.joined(separator: " · ")
    }

    static func safeURL(_ s: String?) -> URL? {
        guard let s, let u = URL(string: s), let scheme = u.scheme?.lowercased(), scheme == "https" || scheme == "http", u.host != nil else { return nil }
        return u
    }

    /// Why no catalog listing is shown, in plain words; nil when one is matched.
    static func catalogGap(_ c: WorkOrderPartProduct.Catalog?) -> String? {
        switch c?.state {
        case "matched"?:
            if c?.match == nil { return "The catalog listing could not be read." }
            return c?.same_as_product_link == true ? "Same listing as the product page above." : nil
        case "no_part_number"?: return "No part number is recorded on this line, so no catalog listing is matched."
        case "no_catalog_row"?: return "No catalog in Nuke lists this part number."
        case "not_matched_brand_disagrees"?: return "A catalog lists this part number under a different maker, so it isn't matched."
        case "not_matched_manufacturer_not_recorded"?: return "A catalog lists this part number without a maker, so it isn't matched to this brand."
        case "not_matched_part_number_ambiguous"?: return "Several catalog listings share this part number and no brand is recorded, so none is matched."
        case "withheld_with_brand"?: return "Not matched: the brand on this line is withheld from you."
        default: return "Catalog match not stated."
        }
    }

    /// "as listed by Holley · updated May 1, 2026 00:00 UTC".
    static func catalogDecay(_ m: WorkOrderPartProduct.CatalogMatch) -> String {
        [(m.source?.name ?? m.source?.provider).map { "as listed by \($0)" } ?? "as listed by a catalog",
         JobClock.text(m.clock).map { "updated \($0)" }]
            .compactMap { $0 }.joined(separator: " · ")
    }

    static func years(_ m: WorkOrderPartProduct.CatalogMatch) -> String? {
        switch (m.year_start, m.year_end) {
        case let (s?, e?): return s == e ? "\(s)" : "\(s)–\(e)"
        case let (s?, nil): return "\(s) on"
        case let (nil, e?): return "through \(e)"
        default: return nil
        }
    }

    static func fits(_ m: WorkOrderPartProduct.CatalogMatch) -> String? {
        let models = (m.fits_models ?? []).filter { !$0.isEmpty }
        let line = [models.isEmpty ? nil : models.prefix(6).joined(separator: ", ") + (models.count > 6 ? " +\(models.count - 6) more" : ""),
                    years(m)].compactMap { $0 }.joined(separator: " · ")
        return line.nilIfEmpty
    }

    /// "found from the job's own buy link".
    static func matchBasis(_ b: String?) -> String? {
        switch b {
        case "job_buy_url_page"?: return "found from the job's own buy link"
        case "brand_and_part_number_on_page"?: return "brand and part number match the seller's page"
        case "brand_and_product_name_on_page"?: return "brand and product name match the seller's page"
        case "asin_page"?: return "found by its Amazon product page"
        case let other?: return JobCopy.sentence(other).lowercased()
        case nil: return nil
        }
    }

    /// "summitracing.com · captured Oct 19, 2026 20:59 UTC".
    static func productDecay(_ l: WorkOrderPartProduct.ProductLink) -> String {
        [l.page_host ?? l.source, JobClock.text(l.captured_at).map { "captured \($0)" }]
            .compactMap { $0 }.joined(separator: " · ").nilIfEmpty ?? "seller page"
    }

    /// The hero image and what it is: the part line's own photo, else the seller's product photo, else the catalog's.
    static func hero(_ p: WorkOrderPartProduct) -> (url: String?, caption: String) {
        if let u = p.imageUrl { return (u, "Photo on the part record") }
        if let l = p.productLink, let u = l.image_url {
            return (u, "Seller's product photo · \(l.page_host ?? l.source ?? "seller page") · not the installed part")
        }
        if p.catalog?.state == "matched", let m = p.catalog?.match, let u = m.product_image_url {
            return (u, "Catalog photo · \(m.source?.name ?? m.source?.provider ?? "catalog") · not the installed part")
        }
        return (nil, "No photo of this part on record")
    }

    /// What the part was for: the labor lines sharing its job code, or why none is named.
    static func purpose(_ op: WorkOrderPartProduct.Operation?) -> (values: [String], decay: String) {
        guard let code = op?.jobOpCode else {
            return (["Not linked to an operation"], "part lines carry no link to the job's operations yet")
        }
        let tasks = op?.labor.map { $0.task_name ?? "Labor line (details hidden to protect a name)" } ?? []
        if tasks.isEmpty { return (["Job code \(code)"], "no labor line on this job records the code") }
        return (tasks, "labor line\(tasks.count == 1 ? "" : "s") with the same job code (\(code))")
    }

    static func photos(_ e: WorkOrderPartProduct.Evidence?) -> String {
        guard let e else { return "Photos not stated." }
        if e.state == "not_linkable" {
            let job = e.jobAttachments.map { $0 == 0 ? "No photos are filed to this job yet." : "\($0) filing\($0 == 1 ? "" : "s") on this job, under Evidence." }
            return ["Photos are filed to a job's operations, and this part isn't linked to one, so none is shown here.", job]
                .compactMap { $0 }.joined(separator: " ")
        }
        let shown = "\(e.images.count) photo\(e.images.count == 1 ? "" : "s")"
        return e.imagesWithheld == 0 ? shown : "\(shown) · \(e.imagesWithheld) not shown to you"
    }

    /// "0 offers · no catalog listing · as of Oct 19, 2026 21:02 UTC".
    static func coverage(_ p: WorkOrderPartProduct) -> String {
        let withLink = p.offers.filter { safeURL($0.url) != nil }.count
        return ["\(p.offers.count) retailer offer\(p.offers.count == 1 ? "" : "s")" + (p.offers.isEmpty ? "" : " (\(withLink) with a link)"),
                p.productLink == nil ? "no product page linked" : "product page linked",
                p.catalog?.state == "matched" ? "1 catalog listing" : "no catalog listing",
                JobClock.text(p.asOf).map { "as of \($0)" }]
            .compactMap { $0 }.joined(separator: " · ")
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

// MARK: - Views

/// A square product thumbnail, or a parts-box placeholder when no image is on record.
struct PartThumb: View {
    let url: String?
    var size: CGFloat = 44

    var body: some View {
        CachedAsyncImage(url: NukeImage.thumb(url, width: Int(size * 3)), maxPixel: size * 3) { img in
            img.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                Color.secondary.opacity(0.12)
                Image(systemName: "shippingbox").font(.system(size: size * 0.4)).foregroundStyle(.tertiary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

struct PartStatusChip: View {
    let status: String?

    var body: some View {
        Text(PartProductCopy.status(status))
            .font(.caption2.weight(.medium))
            .foregroundStyle(status == "installed" ? Color.green : Color.secondary)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Capsule().fill((status == "installed" ? Color.green : Color.secondary).opacity(0.12)))
    }
}

/// One part in the job's list: thumbnail, brand and name, part number and price, status.
struct PartProductRow: View {
    let part: WorkOrderOperations.Part

    var body: some View {
        HStack(spacing: 10) {
            PartThumb(url: part.product?.image_url)
            VStack(alignment: .leading, spacing: 2) {
                Text(PartProductCopy.title(part)).font(.footnote).lineLimit(2)
                Text(PartProductCopy.rowDetail(part))
                    .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            PartStatusChip(status: part.status)
        }
        .padding(.vertical, 2)
    }
}

/// The product page for one part on a job.
struct PartProductView: View {
    let partId: String
    @State private var read: JobLoad<WorkOrderPartProduct> = .loading
    @State private var viewing: WorkOrderEvidence.Photo?

    var body: some View {
        List {
            switch read {
            case .loading:
                Section { Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
            case .refused(let refusal):
                Section { JobRefusalRow(refusal: refusal) }
            case .loaded(let p):
                content(p)
            }
        }
        .navigationTitle("Part")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $viewing) { image in
            NavigationStack {
                CachedAsyncImage(url: NukeImage.thumb(image.image_url, width: 1600), maxPixel: 1600) { img in
                    img.resizable().scaledToFit()
                } placeholder: { ProgressView() }
            }
        }
    }

    private func load() async { read = await PartProductReaders.read(partId: partId) }

    @ViewBuilder private func content(_ p: WorkOrderPartProduct) -> some View {
        let hero = PartProductCopy.hero(p)
        Section {
            VStack(alignment: .leading, spacing: 8) {
                CachedAsyncImage(url: NukeImage.thumb(hero.url, width: 900), maxPixel: 900) { img in
                    img.resizable().scaledToFit()
                } placeholder: {
                    ZStack {
                        Color.secondary.opacity(0.1)
                        Image(systemName: "shippingbox").font(.system(size: 44)).foregroundStyle(.tertiary)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 160, maxHeight: 240)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                Text(hero.caption).font(.caption2).foregroundStyle(.secondary)
                if let brand = p.part?.brand { Text(brand.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                Text(PartProductCopy.title(p.part)).font(.headline)
                HStack {
                    if let pn = p.part?.part_number {
                        Text("PN \(pn)").font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                    }
                    Spacer()
                    PartStatusChip(status: p.line?.status)
                }
            }
            .padding(.vertical, 4)
        }

        Section {
            RootedValueView(label: "Status", value: PartProductCopy.status(p.line?.status), status: .recorded,
                            decay: PartProductCopy.statusBasis)
            let price = PartProductCopy.price(p.price, quantity: p.part?.quantity)
            RootedValueView(label: "Recorded price", value: price.value, status: .recorded, decay: price.detail ?? "recorded on the job, not a payment")
            if let q = PartProductCopy.quantity(p.part?.quantity) {
                RootedValueView(label: "Quantity", value: q, status: .recorded)
            }
            let purpose = PartProductCopy.purpose(p.operation)
            ForEach(Array(purpose.values.enumerated()), id: \.offset) { _, v in
                RootedValueView(label: "For", value: v, status: p.operation?.labor.isEmpty == false ? .attributed : .recorded, decay: purpose.decay)
            }
            if let v = p.vehicleLabel { RootedValueView(label: "Vehicle", value: v, status: .attributed) }
            if let label = p.supplier?.label {
                RootedValueView(label: "Supplier", value: label, status: .recorded, decay: "shown to the people on this job")
            }
            if let notes = p.line?.notes, !notes.isEmpty {
                RootedValueView(label: "Note", value: notes, status: .recorded, decay: "shown to the people on this job")
            }
            if p.line?.ai_extracted == true {
                Text("This line was read from a document by software.").font(.caption2).foregroundStyle(.secondary)
            }
        } header: {
            Text("On this job")
        }

        if let l = p.productLink {
            Section {
                let decay = PartProductCopy.productDecay(l)
                if let name = l.product_name { RootedValueView(label: "Listed as", value: name, status: .attributed, decay: decay) }
                if let maker = l.manufacturer { RootedValueView(label: "Maker", value: maker, status: .attributed, decay: decay) }
                if let pn = l.part_number_as_printed { RootedValueView(label: "Part number on page", value: pn, status: .attributed, decay: decay) }
                if let basis = PartProductCopy.matchBasis(l.match_basis) {
                    Text("Matched: \(basis).").font(.caption2).foregroundStyle(.secondary)
                }
                if let url = PartProductCopy.safeURL(l.page_url) {
                    Link(destination: url) { Label("View on \(l.page_host ?? url.host ?? "the seller's site")", systemImage: "safari") }
                }
            } header: {
                Text("Product page")
            } footer: {
                Text("The seller's page for this product. It describes the product, not the part installed.")
            }
        }

        Section {
            if let url = PartProductCopy.safeURL(p.supplier?.buy_url), p.supplier?.buy_url != p.productLink?.page_url {
                Link(destination: url) {
                    Label("View at \(p.supplier?.buy_url_host ?? url.host ?? "the seller")", systemImage: "safari")
                }
            }
            if p.offers.isEmpty {
                Text("No retailer offers are recorded for this part.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(p.offers) { offer($0) }
        } header: {
            Text("Where to buy")
        } footer: {
            Text("Prices as recorded on their dates, not current. Links open the seller's site in Safari; Nuke doesn't place orders or take payment here.")
        }

        Section {
            if let gap = PartProductCopy.catalogGap(p.catalog) {
                Text(gap).font(.footnote).foregroundStyle(.secondary)
            } else if let m = p.catalog?.match {
                let decay = PartProductCopy.catalogDecay(m)
                if let name = m.name { RootedValueView(label: "Listed as", value: name, status: .attributed, decay: decay) }
                if let maker = m.manufacturer { RootedValueView(label: "Maker", value: maker, status: .attributed, decay: decay) }
                if let price = m.price_current {
                    RootedValueView(label: "Catalog price", value: JobMoney.format(price, m.currency), status: .attributed, decay: decay)
                }
                if let stock = m.in_stock { RootedValueView(label: "Catalog stock", value: PartProductCopy.stock(stock), status: .attributed, decay: decay) }
                if let fits = PartProductCopy.fits(m) { RootedValueView(label: "Fits", value: fits, status: .attributed, decay: decay) }
                if let d = m.installation_difficulty { RootedValueView(label: "Install difficulty", value: JobCopy.sentence(d), status: .attributed, decay: decay) }
                if let d = m.description, !d.isEmpty { Text(d).font(.footnote).foregroundStyle(.secondary).lineLimit(6) }
                if let url = PartProductCopy.safeURL(m.supplier_url) {
                    Link(destination: url) { Label("Catalog page", systemImage: "safari") }
                }
            }
        } header: {
            Text("Catalog listing")
        } footer: {
            Text("A catalog's listing for the same part number, matched exactly. It describes the catalog item, not the part installed.")
        }

        Section {
            if let e = p.evidence, !e.images.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(e.images) { image in
                            Button { viewing = image } label: { PartThumb(url: image.image_url, size: 80) }.buttonStyle(.plain)
                        }
                    }
                }
            }
            Text(PartProductCopy.photos(p.evidence)).font(.footnote).foregroundStyle(.secondary)
        } header: {
            Text("Photos filed for it")
        } footer: {
            Text(PartProductCopy.coverage(p) + ".")
        }
    }

    @ViewBuilder private func offer(_ o: WorkOrderPartProduct.Offer) -> some View {
        let row = HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(PartProductCopy.retailer(o.retailer, host: o.url_host)).font(.subheadline.weight(.medium))
                    if o.is_selected == true {
                        Text("Chosen").font(.caption2.weight(.semibold)).foregroundStyle(.green)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Capsule().fill(Color.green.opacity(0.12)))
                    }
                }
                Text(PartProductCopy.offerDetail(o)).font(.caption2).foregroundStyle(.secondary)
                if let loc = o.store_location { Text(loc).font(.caption2).foregroundStyle(.tertiary) }
                if let n = o.notes { Text(n).font(.caption2).foregroundStyle(.tertiary) }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 2) {
                Text(PartProductCopy.money(o.price) ?? "No price").font(.system(.subheadline, design: .monospaced))
                if PartProductCopy.safeURL(o.url) != nil {
                    Image(systemName: "arrow.up.right.square").font(.caption).foregroundStyle(.blue)
                }
            }
        }
        if let url = PartProductCopy.safeURL(o.url) {
            Link(destination: url) { row }.buttonStyle(.plain)
        } else {
            row
        }
    }
}
