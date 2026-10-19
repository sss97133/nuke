// JobQuotes.swift — quotes, people and statements as the open readers send them.
//
// work_order_quotes_read: the current quote version with its frozen scope, priced lines
// (flat, hourly, day_rate, per_operation; amount + currency), the deposit it requests (a term,
// not a payment), validity, the quoting party, version history and acceptance state, plus
// viewer.actions with accept_quote only for the eligible customer. work_order_statement_read:
// parts and labor totals for everyone, payments and balances only for the parties, and a
// contact action that is brokered by Nuke. Prices are open data; people appear by public
// handle or as an unnamed party; ids and hashes are never primary text.

import Foundation

// MARK: - People

/// A party as the reader labels it: a public handle, an organization name, or "unnamed party".
struct JobPerson: Decodable, Equatable {
    let kind: String?
    /// A public profile the person can be opened at; present only for public handles.
    let profileId: String?
    let handle: String?
    let name: String?
    let label: String?
    let role: String?
    /// "authenticated_sign" when the party signed through Nuke; otherwise source-attributed.
    let attribution: String?

    init(kind: String? = nil, profileId: String? = nil, handle: String? = nil, name: String? = nil, label: String? = nil,
         role: String? = nil, attribution: String? = nil) {
        self.kind = kind; self.profileId = profileId; self.handle = handle; self.name = name; self.label = label
        self.role = role; self.attribution = attribution
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        func str(_ k: String) -> String? {
            (try? c.decode(String.self, forKey: JobCodingKey(k))).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
        }
        self.init(kind: str("kind"), profileId: str("profile_id"), handle: str("handle"), name: str("name"), label: str("label"),
                  role: str("role"), attribution: str("attribution"))
    }

    /// "@handle", the organization's name, or "Unnamed party".
    var text: String {
        if let handle { return "@" + handle }
        if kind == "organization", let name { return name }
        return "Unnamed party"
    }

    var signedThroughNuke: Bool { attribution == "authenticated_sign" }
}

// MARK: - Money (open prices; currency always shown with its amount)

enum JobMoney {
    static func format(_ amount: Double, _ currency: String?) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = Locale(identifier: "en_US")
        f.currencyCode = currency ?? "USD"
        return f.string(from: NSNumber(value: amount)) ?? "\(amount) \(currency ?? "")"
    }
}

// MARK: - Quote

struct QuoteLine: Decodable, Equatable, Identifiable {
    let index: Int
    let refKind: String?
    let description: String?
    /// "withheld_personal_info" when the reader hid a description that named a person.
    let descriptionVisibility: String?
    let pricingBasis: String?
    let amount: Double?
    let currency: String?
    let unit: String?
    let quantity: Double?

    var id: Int { index }

    enum CodingKeys: String, CodingKey {
        case description, amount, currency, unit, quantity
        case refKind = "ref_kind"
        case descriptionVisibility = "description_visibility"
        case pricingBasis = "pricing_basis"
    }

    init(index: Int, from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.index = index
        refKind = try? c.decode(String.self, forKey: .refKind)
        description = (try? c.decode(String.self, forKey: .description)).flatMap { $0.isEmpty ? nil : $0 }
        descriptionVisibility = try? c.decode(String.self, forKey: .descriptionVisibility)
        pricingBasis = try? c.decode(String.self, forKey: .pricingBasis)
        amount = Self.number(c, .amount)
        currency = try? c.decode(String.self, forKey: .currency)
        unit = try? c.decode(String.self, forKey: .unit)
        quantity = Self.number(c, .quantity)
    }

    init(from decoder: Decoder) throws { try self.init(index: 0, from: decoder) }

    private static func number(_ c: KeyedDecodingContainer<CodingKeys>, _ k: CodingKeys) -> Double? {
        if let d = try? c.decode(Double.self, forKey: k), d.isFinite { return d }
        if let s = try? c.decode(String.self, forKey: k), let d = Double(s), d.isFinite { return d }
        return nil
    }
}

struct QuoteTotal: Decodable, Equatable {
    let currency: String?
    let total: Double?
    /// false when a rate line has no stated quantity, so the sum is a floor, not the total.
    let complete: Bool

    enum CodingKeys: String, CodingKey { case currency, total, complete }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        currency = try? c.decode(String.self, forKey: .currency)
        total = (try? c.decode(Double.self, forKey: .total)).flatMap { $0.isFinite ? $0 : nil }
        complete = (try? c.decode(Bool.self, forKey: .complete)) == true
    }
}

struct DepositRequest: Decodable, Equatable {
    let amount: Double
    let currency: String
}

struct Quote: Decodable, Equatable {
    let quoteId: String
    let version: Int
    let quoteHash: String?
    let quotingParty: JobPerson?
    let validUntil: String?
    let expired: Bool
    let lines: [QuoteLine]
    let unpricedLines: Int
    let totals: [QuoteTotal]
    let depositRequested: DepositRequest?
    let scopeStatus: String?

    enum CodingKeys: String, CodingKey {
        case version, expired, lines
        case quoteId = "quote_id"
        case quoteHash = "quote_hash"
        case quotingParty = "quoting_party"
        case validUntil = "valid_until"
        case unpricedLines = "unpriced_lines"
        case totalsByCurrency = "totals_by_currency"
        case depositRequested = "deposit_requested"
        case scopeStatus = "scope_status"
    }

    private struct LineList: Decodable {
        let lines: [QuoteLine]
        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            var out: [QuoteLine] = []
            var i = 0
            while !c.isAtEnd {
                if let line = try? QuoteLine(index: i, from: c.superDecoder()) { out.append(line) }
                i += 1
            }
            lines = out
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        quoteId = try c.decode(String.self, forKey: .quoteId)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 1
        quoteHash = try? c.decode(String.self, forKey: .quoteHash)
        quotingParty = try? c.decode(JobPerson.self, forKey: .quotingParty)
        validUntil = try? c.decode(String.self, forKey: .validUntil)
        expired = (try? c.decode(Bool.self, forKey: .expired)) == true
        lines = (try? c.decode(LineList.self, forKey: .lines))?.lines ?? []
        unpricedLines = (try? c.decode(Int.self, forKey: .unpricedLines)) ?? 0
        totals = (try? c.decode([QuoteTotal].self, forKey: .totalsByCurrency)) ?? []
        depositRequested = try? c.decode(DepositRequest.self, forKey: .depositRequested)
        scopeStatus = try? c.decode(String.self, forKey: .scopeStatus)
    }

    /// "Version 3 · Revised 2 times", "Version 1".
    var versionLine: String {
        let revisions = max(version - 1, 0)
        switch revisions {
        case 0: return "Version \(version)"
        case 1: return "Version \(version) · Revised once"
        default: return "Version \(version) · Revised \(revisions) times"
        }
    }
}

struct QuoteHistoryEntry: Decodable, Equatable, Identifiable {
    let quoteId: String
    let version: Int
    let state: String?
    let observedAt: String?

    var id: String { quoteId }

    enum CodingKeys: String, CodingKey {
        case version, state
        case quoteId = "quote_id"
        case observedAt = "observed_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        quoteId = try c.decode(String.self, forKey: .quoteId)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 0
        state = try? c.decode(String.self, forKey: .state)
        observedAt = try? c.decode(String.self, forKey: .observedAt)
    }
}

struct QuoteAcceptance: Decodable, Equatable {
    let state: String
    let acceptedByViewer: Bool
    let quoteVersion: Int?
    let signedAt: String?
    let signerRole: String?
    let signer: JobPerson?
    let withheldReason: String?

    enum CodingKeys: String, CodingKey {
        case state, signer
        case acceptedByViewer = "accepted_by_viewer"
        case quoteVersion = "quote_version"
        case signedAt = "signed_at"
        case signerRole = "signer_role"
        case withheldReason = "withheld_reason"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = (try? c.decode(String.self, forKey: .state)) ?? "not_accepted"
        acceptedByViewer = (try? c.decode(Bool.self, forKey: .acceptedByViewer)) == true
        quoteVersion = try? c.decode(Int.self, forKey: .quoteVersion)
        signedAt = try? c.decode(String.self, forKey: .signedAt)
        signerRole = try? c.decode(String.self, forKey: .signerRole)
        signer = try? c.decode(JobPerson.self, forKey: .signer)
        withheldReason = try? c.decode(String.self, forKey: .withheldReason)
    }
}

struct JobQuotes: Decodable, Equatable {
    let workOrderId: String?
    let currentQuote: Quote?
    let history: [QuoteHistoryEntry]
    let acceptance: QuoteAcceptance?
    let viewer: JobViewer?
    let displayTitle: String?
    let vehicleLabel: JobVehicleLabel?
    let asOf: String?

    enum CodingKeys: String, CodingKey {
        case history, acceptance, viewer
        case workOrderId = "work_order_id"
        case currentQuote = "current_quote"
        case displayTitle = "display_title"
        case vehicleLabel = "vehicle_label"
        case asOf = "as_of"
    }

    private struct HistorySlot: Decodable {
        let entry: QuoteHistoryEntry?
        init(from decoder: Decoder) throws { entry = try? QuoteHistoryEntry(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workOrderId = try? c.decode(String.self, forKey: .workOrderId)
        currentQuote = try? c.decode(Quote.self, forKey: .currentQuote)
        history = ((try? c.decode([HistorySlot].self, forKey: .history)) ?? []).compactMap(\.entry)
        acceptance = try? c.decode(QuoteAcceptance.self, forKey: .acceptance)
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
        displayTitle = try? c.decode(String.self, forKey: .displayTitle)
        vehicleLabel = try? c.decode(JobVehicleLabel.self, forKey: .vehicleLabel)
        asOf = try? c.decode(String.self, forKey: .asOf)
    }

    /// The accept_quote step the server offers this viewer, if any.
    var acceptAction: JobAction? { viewer?.actions.first { $0.kind == "accept_quote" } }
}

/// accept_work_order_quote's receipt.
struct QuoteAcceptanceReceipt: Decodable, Equatable {
    let quoteVersion: Int?
    let signedAt: String?
    let duplicate: Bool
    let depositCollected: Bool
    let paymentAuthorized: Bool

    enum CodingKeys: String, CodingKey {
        case duplicate
        case quoteVersion = "quote_version"
        case signedAt = "signed_at"
        case depositCollected = "deposit_collected"
        case paymentAuthorized = "payment_authorized"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        quoteVersion = try? c.decode(Int.self, forKey: .quoteVersion)
        signedAt = try? c.decode(String.self, forKey: .signedAt)
        duplicate = (try? c.decode(Bool.self, forKey: .duplicate)) == true
        depositCollected = (try? c.decode(Bool.self, forKey: .depositCollected)) == true
        paymentAuthorized = (try? c.decode(Bool.self, forKey: .paymentAuthorized)) == true
    }
}

// MARK: - Statement

struct StatementLine: Decodable, Equatable, Identifiable {
    let id: String
    let name: String?
    let quantity: Double?
    let unitPrice: Double?
    let total: Double?
    let hours: Double?
    let rate: Double?
    let comped: Bool

    enum CodingKeys: String, CodingKey {
        case id, quantity, hours
        case partName = "part_name"
        case taskName = "task_name"
        case unitPrice = "unit_price"
        case totalPrice = "total_price"
        case totalCost = "total_cost"
        case hourlyRate = "hourly_rate"
        case isComped = "is_comped"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func num(_ k: CodingKeys) -> Double? {
            if let d = try? c.decode(Double.self, forKey: k), d.isFinite { return d }
            if let s = try? c.decode(String.self, forKey: k), let d = Double(s), d.isFinite { return d }
            return nil
        }
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        name = (try? c.decode(String.self, forKey: .partName)) ?? (try? c.decode(String.self, forKey: .taskName))
        quantity = num(.quantity)
        unitPrice = num(.unitPrice)
        hours = num(.hours)
        rate = num(.hourlyRate)
        let qty = quantity
        let unit = unitPrice
        total = num(.totalPrice) ?? num(.totalCost) ?? { if let q = qty, let u = unit { return q * u }; return nil }()
        comped = (try? c.decode(Bool.self, forKey: .isComped)) == true
    }
}

struct StatementPayment: Decodable, Equatable, Identifiable {
    let id: String
    let amount: Double?
    let paymentDate: String?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case id, amount, status
        case paymentDate = "payment_date"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        amount = (try? c.decode(Double.self, forKey: .amount)) ?? (try? c.decode(String.self, forKey: .amount)).flatMap(Double.init)
        paymentDate = try? c.decode(String.self, forKey: .paymentDate)
        status = try? c.decode(String.self, forKey: .status)
    }
}

struct StatementWorkOrder: Decodable, Equatable, Identifiable {
    let id: String
    let displayTitle: String?
    let status: String?
    let parts: [StatementLine]
    let labor: [StatementLine]
    /// nil when the reader withheld payments from this viewer (not a party).
    let payments: [StatementPayment]?
    let partsTotal: Double?
    let laborTotal: Double?
    let compedValue: Double?
    let paymentsTotal: Double?
    let balanceDue: Double?
    let moneyVisible: Bool

    enum CodingKeys: String, CodingKey {
        case id, status, parts, labor, payments
        case displayTitle = "display_title"
        case partsTotal = "parts_total"
        case laborTotal = "labor_total"
        case compedValue = "comped_value"
        case paymentsTotal = "payments_total"
        case balanceDue = "balance_due"
        case moneyVisible = "money_visible"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func num(_ k: CodingKeys) -> Double? { (try? c.decode(Double.self, forKey: k)).flatMap { $0.isFinite ? $0 : nil } }
        id = try c.decode(String.self, forKey: .id)
        displayTitle = try? c.decode(String.self, forKey: .displayTitle)
        status = try? c.decode(String.self, forKey: .status)
        parts = (try? c.decode([StatementLine].self, forKey: .parts)) ?? []
        labor = (try? c.decode([StatementLine].self, forKey: .labor)) ?? []
        moneyVisible = (try? c.decode(Bool.self, forKey: .moneyVisible)) == true
        payments = moneyVisible ? ((try? c.decode([StatementPayment].self, forKey: .payments)) ?? []) : nil
        partsTotal = num(.partsTotal)
        laborTotal = num(.laborTotal)
        compedValue = num(.compedValue)
        paymentsTotal = moneyVisible ? num(.paymentsTotal) : nil
        balanceDue = moneyVisible ? num(.balanceDue) : nil
    }
}

struct JobStatement: Decodable, Equatable {
    struct Totals: Decodable, Equatable {
        let parts: Double?
        let labor: Double?
        let subtotal: Double?
        let goodwill: Double?
        let payments: Double?
        let balance: Double?
    }
    struct Shop: Decodable, Equatable {
        let name: String?
        let city: String?
        let state: String?
        var place: String? {
            let p = [city, state].compactMap { $0 }.filter { !$0.isEmpty }
            return p.isEmpty ? nil : p.joined(separator: ", ")
        }
    }
    struct Contact: Decodable, Equatable {
        let action: String?
        let available: Bool
    }

    let error: String?
    let vehicleLabel: JobVehicleLabel?
    let shop: Shop?
    let contact: Contact?
    let workOrders: [StatementWorkOrder]
    let totals: Totals?
    let viewer: JobViewer?
    let asOf: String?

    enum CodingKeys: String, CodingKey {
        case error, vehicle, shop, contact, totals, viewer
        case workOrders = "work_orders"
        case asOf = "as_of"
    }

    private struct WOSlot: Decodable {
        let wo: StatementWorkOrder?
        init(from decoder: Decoder) throws { wo = try? StatementWorkOrder(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        error = try? c.decode(String.self, forKey: .error)
        vehicleLabel = try? c.decode(JobVehicleLabel.self, forKey: .vehicle)
        shop = try? c.decode(Shop.self, forKey: .shop)
        contact = try? c.decode(Contact.self, forKey: .contact)
        workOrders = ((try? c.decode([WOSlot].self, forKey: .workOrders)) ?? []).compactMap(\.wo)
        totals = try? c.decode(Totals.self, forKey: .totals)
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
        asOf = try? c.decode(String.self, forKey: .asOf)
    }
}
