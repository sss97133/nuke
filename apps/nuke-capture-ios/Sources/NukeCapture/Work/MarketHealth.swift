// MarketHealth.swift — how Nuke's job market is forming: job_market_health_read(), anonymous aggregates.
//
// Read with pg_get_functiondef on 2026-10-19 (and nuke_frontend's /work/market page for its words): demand (jobs,
// published open/invite only, new requests, open requirements), supply (technicians linked by evidence, businesses
// claimed, businesses with purchase records), matching (open requests with a backup supplier or a technician who
// fits), flow (signed offers, quotes, starts, completions, invoices, payment records) and history (one row per UTC
// day from the job-market-health-snapshot cron). Counts only: no names, amounts or job details.

import Foundation
import Supabase

struct MarketHealth: Decodable, Equatable {
    /// One daily snapshot: its date and every numeric count it carries.
    struct Day: Decodable, Equatable {
        let date: String
        let values: [String: Int]

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            date = try c.decode(String.self, forKey: JobCodingKey("date"))
            var v: [String: Int] = [:]
            for k in c.allKeys where k.stringValue != "date" {
                if let n = try? c.decode(Int.self, forKey: k) { v[k.stringValue] = n }
            }
            values = v
        }
    }

    let asOf: String?
    let openRequests: Int?
    let jobsOpen: Int?
    let openedThisWeek: Int?
    let technicians: Int?
    let businessesClaimed: Int?
    let businessesWithPurchases: Int?
    let withBackupSupplier: Int?
    let withTechnicianWhoFits: Int?
    let flow: [String: Int]
    let history: [Day]

    private struct Demand: Decodable {
        struct Published: Decodable { let open: Int? }
        struct Fresh: Decodable { let published_open_last_7_days: Int? }
        let open_requirements: Int?
        let published: Published?
        let new_requests: Fresh?
    }
    private struct Supply: Decodable {
        let accounts_with_evidenced_provider_links: Int?
        let verified_claimant_organizations: Int?
        let organizations_with_supply_evidence: Int?
    }
    private struct Matching: Decodable {
        let open_requirements: Int?
        let with_plan_b_supplier: Int?
        let with_evidenced_candidate: Int?
    }
    private struct Flow: Decodable { let counts: [String: Lossy<Int>]? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        asOf = try? c.decode(String.self, forKey: JobCodingKey("as_of"))
        let demand = try? c.decode(Demand.self, forKey: JobCodingKey("demand"))
        let supply = try? c.decode(Supply.self, forKey: JobCodingKey("supply"))
        let matching = try? c.decode(Matching.self, forKey: JobCodingKey("matching"))
        guard demand != nil || supply != nil || matching != nil else {
            throw DecodingError.dataCorruptedError(forKey: JobCodingKey("demand"), in: c, debugDescription: "not a market health read")
        }
        openRequests = matching?.open_requirements ?? demand?.open_requirements
        jobsOpen = demand?.published?.open
        openedThisWeek = demand?.new_requests?.published_open_last_7_days
        technicians = supply?.accounts_with_evidenced_provider_links
        businessesClaimed = supply?.verified_claimant_organizations
        businessesWithPurchases = supply?.organizations_with_supply_evidence
        withBackupSupplier = matching?.with_plan_b_supplier
        withTechnicianWhoFits = matching?.with_evidenced_candidate
        flow = ((try? c.decode(Flow.self, forKey: JobCodingKey("flow")))?.counts ?? [:]).compactMapValues(\.value)
        history = ((try? c.decode([Lossy<Day>].self, forKey: JobCodingKey("history"))) ?? []).compactMap(\.value)
            .sorted { $0.date < $1.date }
    }

    /// A daily series for one history key, oldest first; nil until there are two days to draw.
    func trend(_ key: String) -> [Int]? {
        let points = history.compactMap { $0.values[key] }
        return points.count >= 2 ? points : nil
    }

    var flowTotal: Int { MarketHealthCopy.flowWords.reduce(0) { $0 + (flow[$1.key] ?? 0) } }
}

// MARK: - Words (the web's /work/market words, shortened for a card)

enum MarketHealthCopy {
    static let title = "How Nuke's job market is forming"
    static let note = "Counted from the record, not estimated. No names, amounts or job details here."
    static let flowEmpty = "No offers, quotes, starts, completions or invoices are on record yet. Each will show here as people sign them."
    static let money = "Nuke records payments; it doesn't move money."
    static let webURL = URL(string: "https://nuke.ag/work/market")!

    /// "39 open requests", "1 technician"; "Not counted" when the reader left it out.
    static func count(_ n: Int?, _ one: String, _ many: String) -> String {
        guard let n else { return "\(many.prefix(1).uppercased())\(many.dropFirst()) not counted" }
        return "\(JobCopy.count(n)) \(n == 1 ? one : many)"
    }

    static func demand(_ m: MarketHealth) -> String {
        [count(m.openRequests, "open request", "open requests"),
         count(m.jobsOpen, "job open to technicians", "jobs open to technicians"),
         count(m.openedThisWeek, "job opened this week", "jobs opened this week")].joined(separator: " · ")
    }

    static func supply(_ m: MarketHealth) -> String {
        let claimed = m.businessesClaimed == 0 ? "0 businesses claimed yet" : count(m.businessesClaimed, "business claimed", "businesses claimed")
        return [count(m.technicians, "technician linked by evidence", "technicians linked by evidence"), claimed,
                count(m.businessesWithPurchases, "business with purchase records", "businesses with purchase records")].joined(separator: " · ")
    }

    static func matching(_ m: MarketHealth) -> String {
        [count(m.withBackupSupplier, "request has", "requests have") + " a backup supplier",
         count(m.withTechnicianWhoFits, "request has", "requests have") + " a technician who fits"].joined(separator: " · ")
    }

    static let flowWords: [(key: String, one: String, many: String)] = [
        ("offers", "offer made", "offers made"),
        ("offers_accepted", "offer accepted", "offers accepted"),
        ("quotes_issued", "quote issued", "quotes issued"),
        ("quotes_accepted", "quote accepted", "quotes accepted"),
        ("starts", "job started", "jobs started"),
        ("completions_attested", "job marked done", "jobs marked done"),
        ("completions_accepted", "completion confirmed", "completions confirmed"),
        ("invoices", "invoice issued", "invoices issued"),
        ("payment_witnesses", "payment recorded", "payments recorded"),
    ]

    static func flow(_ m: MarketHealth) -> String {
        guard m.flowTotal > 0 else { return flowEmpty }
        return flowWords.compactMap { w in m.flow[w.key].flatMap { $0 > 0 ? count($0, w.one, w.many) : nil } }.joined(separator: " · ")
    }

    /// "Daily history starts Oct 19; trend lines appear after the second day." or "Trends over 12 days."
    static func history(_ m: MarketHealth) -> String? {
        guard let first = m.history.first else { return nil }
        if m.history.count >= 2 { return "Trends over \(m.history.count) days." }
        return "Daily history starts \(JobCopy.day(first.date) ?? first.date); trend lines appear after the second day."
    }
}

// MARK: - Reader (anon)

enum MarketHealthReader {
    static let name = "job_market_health_read"

    static func read() async -> JobLoad<MarketHealth> {
        await JobReaders.call(name) { try await SupabaseService.client.rpc(name).execute().data }
    }
}
