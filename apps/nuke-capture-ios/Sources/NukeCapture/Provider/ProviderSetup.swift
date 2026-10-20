// ProviderSetup.swift — technician onboarding (web /work/setup parity) over live readers and Signs.
//
// Read from their bodies with pg_get_functiondef on 2026-10-19: my_suggested_provider_links (technician
// records your work points to, with a claim row; work recorded under your account, with confirm_provider_record;
// public shops within 150 m of your photos, with an ask-to-join row), provider_profile_read (service area,
// availability, tools seen vs claimed, vouches, identity bridge), set_provider_service_area,
// set_provider_availability; plus the rows the suggestions reader names (account_link_claims self_claim insert,
// organization_contributors pending insert) and the account's own profiles and user_tools rows under their
// owner policies. Copy follows nuke_frontend/src/pages/provider-setup. Nothing here is checked by Nuke until
// work backs it up; nothing is a rating, a booking or a payment.

import Foundation
import Supabase

fileprivate extension JobJSON {
    subscript(_ key: String) -> JobJSON? { if case .object(let o) = self { return o[key] }; return nil }
    var num: Double? { if case .number(let n) = self { return n }; return nil }
    var flag: Bool? { if case .bool(let b) = self { return b }; return nil }
    var list: [JobJSON] { if case .array(let a) = self { return a }; return [] }
    var dict: [String: JobJSON]? { if case .object(let o) = self { return o }; return nil }
    var strings: [String] { list.compactMap(\.stringValue) }
}

// MARK: - my_suggested_provider_links

struct ProviderSuggestions: Equatable {
    struct Actor: Equatable, Identifiable {
        let id: String
        let name: String
        let direct: Bool
        let evidence: String
        let claim: String?
        let linkedElsewhere: Bool
        let claimRow: [String: JobJSON]?
    }
    struct Shop: Equatable, Identifiable {
        let id: String
        let name: String
        let evidence: String
        let joinRow: [String: JobJSON]?
    }
    struct Record: Equatable, Identifiable {
        let sourceKind: String
        let sourceId: String
        let snapshotHash: String
        let title: String
        let detail: String
        let confirmation: String
        var id: String { sourceKind + sourceId }
    }

    let actors: [Actor]
    let shops: [Shop]
    let records: [Record]

    static let kindWords = ["work_session": "work days of yours", "observation": "photos or records of yours", "org_membership": "shop memberships"]

    init(json: JobJSON) {
        actors = (json["actor_links"]?.list ?? []).compactMap { o in
            let actor = o["actor"]
            let row = o["actions"]?.list.first { $0["action"]?.stringValue == "claim" }?["row"]?.dict
            let id = actor?["actor_id"]?.stringValue ?? row?["actor_id"]?.stringValue ?? actor?["label"]?.stringValue ?? UUID().uuidString
            let ev = o["evidence"]
            let direct = Int(ev?["direct"]?.num ?? 0), corr = Int(ev?["corroborating"]?.num ?? 0)
            let strength = [direct > 0 ? "\(direct) direct" : nil, corr > 0 ? "\(corr) corroborating" : nil].compactMap { $0 }.joined(separator: ", ")
            let kinds = (ev?["by_kind"]?.dict ?? [:]).sorted { $0.key < $1.key }.compactMap { k, v -> String? in
                guard let n = v.num, n > 0 else { return nil }
                return "\(Int(n)) \(Self.kindWords[k] ?? JobCopy.sentence(k).lowercased())"
            }.joined(separator: ", ")
            return Actor(id: id, name: Self.actorName(actor), direct: o["strength"]?.stringValue == "direct",
                         evidence: [strength, kinds].filter { !$0.isEmpty }.joined(separator: " — ").nilIfEmpty ?? "no evidence counted",
                         claim: Self.claimWords(o["your_claim"]), linkedElsewhere: o["linked_to_another_account"]?.flag == true, claimRow: row)
        }
        shops = (json["organizations"]?.list ?? []).compactMap { o in
            guard let org = o["organization"], let id = org["organization_id"]?.stringValue else { return nil }
            let ev = o["evidence"]
            let photos = Int(ev?["photos_at_site"]?.num ?? 0), days = Int(ev?["days"]?.num ?? 0), r = Int(ev?["radius_m"]?.num ?? 150)
            let span = [JobCopy.day(ev?["first_at"]?.stringValue), JobCopy.day(ev?["last_at"]?.stringValue)].compactMap { $0 }
            let when = span.count == 2 && span[0] != span[1] ? " · \(span[0]) – \(span[1])" : (span.first.map { " · \($0)" } ?? "")
            let row = o["actions"]?.list.first { $0["action"]?.stringValue == "ask_to_join" }?["row"]?.dict
            return Shop(id: id, name: org["name"]?.stringValue ?? "Unnamed shop",
                        evidence: "\(photos.formatted()) of your photos on \(days) day\(days == 1 ? "" : "s") within \(r) m" + when, joinRow: row)
        }
        let rc = json["recorded_contributions"]
        var recs: [Record] = []
        for c in rc?["contractor_work"]?.list ?? [] {
            guard let id = c["source_id"]?.stringValue, let h = c["snapshot_hash"]?.stringValue else { continue }
            let hours = c["labor_hours"]?.num
            recs.append(Record(sourceKind: "contractor_work_contribution", sourceId: id, snapshotHash: h,
                               title: c["work_description"]?.stringValue ?? c["work_category"]?.stringValue.map(JobCopy.sentence) ?? "Recorded work",
                               detail: [c["organization"]?["name"]?.stringValue, JobCopy.day(c["work_date"]?.stringValue),
                                        hours.map { "\(JobCopy.plainNumber($0)) h recorded" }, c["verified_by_shop"]?.flag == true ? "verified by the shop" : nil]
                                        .compactMap { $0 }.joined(separator: " · "),
                               confirmation: c["confirmation"]?["state"]?.stringValue ?? "unconfirmed"))
        }
        for t in rc?["technician_records"]?.list ?? [] {
            guard let id = t["source_id"]?.stringValue, let h = t["snapshot_hash"]?.stringValue else { continue }
            let specs = t["specializations"]?.strings.map(JobCopy.sentence).joined(separator: ", ")
            recs.append(Record(sourceKind: "technician", sourceId: id, snapshotHash: h,
                               title: "Technician record" + (t["certification_level"]?.stringValue.map { " · \(JobCopy.sentence($0))" } ?? ""),
                               detail: [t["organization"]?["name"]?.stringValue, specs?.nilIfEmpty,
                                        t["experience_years"]?.num.map { "\(Int($0)) years" }].compactMap { $0 }.joined(separator: " · "),
                               confirmation: t["confirmation"]?["state"]?.stringValue ?? "unconfirmed"))
        }
        records = recs
    }

    static func actorName(_ a: JobJSON?) -> String {
        if let h = a?["handle"]?.stringValue { return "@" + h }
        if let r = a?["role"]?.stringValue { return "Unnamed \(JobCopy.sentence(r).lowercased()) record" }
        return "Unnamed technician record"
    }

    static func claimWords(_ c: JobJSON?) -> String? {
        guard let c, c.dict != nil else { return nil }
        let when = JobCopy.day(c["filed_at"]?.stringValue)
        switch c["status"]?.stringValue {
        case "approved"?: return "Linked" + (c["rung"]?.stringValue == "self_claim" ? " (self-claimed)" : ", backed by your work") + (when.map { " · claimed \($0)" } ?? "")
        case "rejected"?: return "Your claim was not approved" + (when.map { " · claimed \($0)" } ?? "")
        default: return "You claimed this" + (when.map { " on \($0)" } ?? "") + " — waiting for review"
        }
    }

    static func confirmation(_ state: String) -> String {
        switch state {
        case "confirmed": return "You confirmed this record"
        case "changed_since_confirmed": return "Changed since you confirmed it"
        default: return "Not confirmed by you yet"
        }
    }
}

// MARK: - The provider page, as setup reads it (provider_profile_read)

struct ProviderSetupProfile: Equatable {
    struct Window: Equatable { let dow: Int; let start: String; let end: String }

    let bridge: String
    let areaDeclared: Bool
    let city: String?
    let state: String?
    let radius: Int?
    let mobile: Bool
    let availabilityDeclared: Bool
    let timezone: String?
    let weekly: [Window]
    let exceptions: [JobJSON]
    let toolsSeen: [(label: String, count: Int)]
    let framesWithTools: Int
    let framesAnalyzed: Int
    let toolsClaimed: [(category: String, records: Int)]
    let vouches: Int
    let profession: String?
    let expertise: [String]

    static func == (a: Self, b: Self) -> Bool { a.bridge == b.bridge && a.city == b.city && a.weekly == b.weekly && a.vouches == b.vouches }

    init(json: JobJSON) {
        bridge = json["identity_bridge"]?["state"]?.stringValue ?? "none"
        let s = json["service_area"]
        areaDeclared = s?["state"]?.stringValue == "declared"
        city = s?["city"]?.stringValue
        state = s?["state_code"]?.stringValue
        radius = s?["radius_miles"]?.num.map { Int($0) }
        mobile = s?["mobile"]?.flag == true
        let a = json["availability"]
        availabilityDeclared = a?["state"]?.stringValue == "declared"
        timezone = a?["timezone"]?.stringValue
        weekly = (a?["weekly"]?.list ?? []).compactMap { w in
            guard let d = w["dow"]?.num else { return nil }
            return Window(dow: Int(d), start: w["start"]?.stringValue ?? "", end: w["end"]?.stringValue ?? "")
        }
        exceptions = a?["exceptions_upcoming"]?.list ?? []
        let seen = json["tools"]?["seen_in_frame"]
        toolsSeen = (seen?["top_labels"]?.list ?? []).compactMap { l in l["label"]?.stringValue.map { ($0, Int(l["occurrences"]?.num ?? 0)) } }
        framesWithTools = Int(seen?["frames_with_tools"]?.num ?? 0)
        framesAnalyzed = Int(seen?["frames_analyzed"]?.num ?? 0)
        let owned = json["tools"]?["claimed_owned"]
        toolsClaimed = ((owned?["user_tools"]?.list ?? []) + (owned?["tool_inventory"]?.list ?? [])).compactMap { c in
            c["category"]?.stringValue.map { ($0, Int(c["records"]?.num ?? 0)) }
        }
        vouches = (json["vouched_for_by"]?["items"]?.list ?? []).count
        let account = json["claims"]?["account"]
        profession = account?["profession"]?.stringValue
        expertise = account?["expertise_areas"]?.strings ?? []
    }

    static let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    var areaWords: String? {
        guard areaDeclared, let city, let state else { return nil }
        return "\(city), \(state) within \(radius.map(String.init) ?? "?") miles" + (mobile ? ", travels to the vehicle" : "")
    }

    var weeklyWords: String? {
        guard availabilityDeclared else { return nil }
        if weekly.isEmpty { return "No weekly windows" + (timezone.map { " (\($0))" } ?? "") }
        return weekly.map { "\(Self.days[max(0, min(6, $0.dow))]) \($0.start)–\($0.end)" }.joined(separator: ", ") + (timezone.map { " (\($0))" } ?? "")
    }

    var toolRecords: Int { toolsClaimed.reduce(0) { $0 + $1.records } }
}

/// The account's own profile row (username, public, trade).
struct OwnProviderRow: Decodable, Equatable {
    let username: String?
    let is_public: Bool?
    let profession: String?
    let expertise_areas: [String]?
}

struct ToolKey: Decodable, Equatable {
    let source_kind: String
    let source_key: String
    let requirement_key: String
}

// MARK: - Checklist and builders (pure; the screen sends exactly these)

enum ProviderSetupDrafting {
    struct Item: Equatable, Identifiable {
        enum State: String { case done, partial, missing, optional }
        let key: String
        let label: String
        let state: State
        let words: String
        var id: String { key }
    }

    static func hasTrade(profession: String?, expertise: [String]) -> Bool {
        !expertise.isEmpty || (profession.map { !$0.isEmpty && $0 != "enthusiast" } ?? false)
    }

    static func checklist(_ p: ProviderSetupProfile?, own: OwnProviderRow?) -> [Item] {
        let bridge = p?.bridge ?? "none"
        let handle = own?.username?.trimmingCharacters(in: .whitespaces).nilIfEmpty
        let tools = p?.toolRecords ?? 0, vouches = p?.vouches ?? 0
        return [
            bridge == "evidenced" ? Item(key: "link", label: "Technician link", state: .done, words: "Linked to your technician record and backed by your work.")
            : bridge == "claimed" ? Item(key: "link", label: "Technician link", state: .partial, words: "Your link is self-claimed — Nuke confirms it when your work backs it up.")
            : Item(key: "link", label: "Technician link", state: .missing, words: "Not linked. If a technician record below is yours, claim it."),
            handle != nil && own?.is_public == true
                ? Item(key: "public", label: "Public page", state: .done, words: "Clients can open your page as @\(handle!).")
                : Item(key: "public", label: "Public page", state: .missing, words: "Set a username and make your profile public so clients can open your page."),
            hasTrade(profession: own?.profession, expertise: own?.expertise_areas ?? [])
                ? Item(key: "trade", label: "Trade", state: .done, words: "Your trade is on your page, labelled self-described.")
                : Item(key: "trade", label: "Trade", state: .missing, words: "Say what you do. It is shown as self-described."),
            p?.areaDeclared == true
                ? Item(key: "area", label: "Service area", state: .done, words: "\(p?.areaWords ?? "Declared").")
                : Item(key: "area", label: "Service area", state: .missing, words: "No service area yet, so matching cannot tell whether a job is near you."),
            p?.availabilityDeclared == true
                ? Item(key: "availability", label: "Availability", state: .done, words: "\(p?.weeklyWords ?? "Declared").")
                : Item(key: "availability", label: "Availability", state: .missing, words: "No availability yet; jobs show it as unknown."),
            tools > 0
                ? Item(key: "tools", label: "Tools", state: .done, words: "\(tools) tool record\(tools == 1 ? "" : "s") you say you own. Not checked in person.")
                : Item(key: "tools", label: "Tools", state: .missing, words: "No tools claimed; requests that need a tool will say a backup supplier is needed."),
            vouches > 0
                ? Item(key: "vouches", label: "Vouches", state: .done, words: "\(vouches) vouch\(vouches == 1 ? "" : "es") from people or shops you worked with.")
                : Item(key: "vouches", label: "Vouches", state: .optional, words: "Ask a shop or tool owner you have worked with to vouch for you or co-sign an offer."),
        ]
    }

    static let professions: [(key: String, title: String)] = [
        ("mechanic", "Mechanic or technician"), ("dealer", "Dealer"), ("collector", "Collector"), ("enthusiast", "Enthusiast"), ("other", "Other"),
    ]

    private static let contact = #"(@|\d{3}[-. )]*\d{3}[-. ]*\d{4})"#

    struct TradeRow: Encodable, Equatable, Sendable { let profession: String; let expertise_areas: [String] }

    static func trade(profession: String, expertise: String) -> Result<TradeRow, JobSignFailure> {
        guard professions.contains(where: { $0.key == profession }) else { return .failure(JobSignFailure(text: "Pick what best describes you.")) }
        var seen = Set<String>()
        let items = expertise.split(whereSeparator: { $0 == "," || $0 == "\n" }).map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
        guard items.count <= 12 else { return .failure(JobSignFailure(text: "Up to 12 areas of expertise.")) }
        guard items.allSatisfy({ (2...40).contains($0.count) }) else { return .failure(JobSignFailure(text: "Each area is 2 to 40 characters.")) }
        guard !items.contains(where: { $0.range(of: contact, options: .regularExpression) != nil }) else {
            return .failure(JobSignFailure(text: "Take out phone numbers and emails."))
        }
        return .success(TradeRow(profession: profession, expertise_areas: items))
    }

    struct AreaParams: Encodable, Equatable, Sendable { let p_city: String; let p_state: String; let p_radius_miles: Int; let p_mobile: Bool }

    static func area(city: String, state: String, radius: String, mobile: Bool) -> Result<AreaParams, JobSignFailure> {
        let c = city.trimmingCharacters(in: .whitespaces).split(separator: " ").joined(separator: " ")
        let s = state.trimmingCharacters(in: .whitespaces).uppercased()
        guard (2...60).contains(c.count), c.rangeOfCharacter(from: CharacterSet(charactersIn: "0123456789@,;")) == nil else {
            return .failure(JobSignFailure(text: "A city name only (no street address, numbers or contact details)."))
        }
        guard s.count == 2, s.allSatisfy({ $0.isLetter && $0.isASCII }) else { return .failure(JobSignFailure(text: "A two-letter state code, like NV.")) }
        guard let r = Int(radius.trimmingCharacters(in: .whitespaces)), (1...500).contains(r) else {
            return .failure(JobSignFailure(text: "Radius is 1 to 500 miles."))
        }
        return .success(AreaParams(p_city: c, p_state: s, p_radius_miles: r, p_mobile: mobile))
    }

    struct DayDraft: Equatable { var on: Bool; var start: String; var end: String }

    struct AvailabilityParams: Encodable, Equatable { let p_windows: JobJSON }

    static func availability(timezone: String, days: [DayDraft], keep exceptions: [JobJSON]) -> Result<AvailabilityParams, JobSignFailure> {
        let tz = timezone.trimmingCharacters(in: .whitespaces)
        guard !tz.isEmpty else { return .failure(JobSignFailure(text: "Pick your timezone.")) }
        let hhmm = #"^([01][0-9]|2[0-3]):[0-5][0-9]$"#
        var weekly: [JobJSON] = []
        for (i, d) in days.enumerated() where d.on {
            let okStart = d.start.range(of: hhmm, options: .regularExpression) != nil
            let okEnd = d.end.range(of: hhmm, options: .regularExpression) != nil || d.end == "24:00"
            guard okStart, okEnd, d.start < d.end else {
                return .failure(JobSignFailure(text: "\(ProviderSetupProfile.days[i]): start before end, as HH:MM."))
            }
            weekly.append(.object(["dow": .number(Double(i)), "start": .string(d.start), "end": .string(d.end)]))
        }
        let kept: [JobJSON] = exceptions.compactMap { x in
            guard let date = x["date"]?.stringValue else { return nil }
            var o: [String: JobJSON] = ["date": .string(date), "available": .bool(x["available"]?.flag == true)]
            if let s = x["start"]?.stringValue, let e = x["end"]?.stringValue { o["start"] = .string(s); o["end"] = .string(e) }
            return .object(o)
        }
        return .success(AvailabilityParams(p_windows: .object(["timezone": .string(tz), "weekly": .array(weekly), "exceptions": .array(kept)])))
    }

    struct ToolRow: Encodable, Equatable, Sendable {
        let user_id: String
        let description: String
        let category: String?
        let metadata: [String: String]
    }

    static func tool(userId: String, description: String, category: String) -> Result<ToolRow, JobSignFailure> {
        let d = description.trimmingCharacters(in: .whitespaces).split(separator: " ").joined(separator: " ")
        guard (2...120).contains(d.count) else { return .failure(JobSignFailure(text: "Name the tool in 2 to 120 characters.")) }
        guard d.range(of: contact, options: .regularExpression) == nil else { return .failure(JobSignFailure(text: "Take out phone numbers and emails.")) }
        let c = category.trimmingCharacters(in: .whitespaces)
        return .success(ToolRow(user_id: userId, description: d, category: c.isEmpty ? nil : c,
                                metadata: ["source": "provider_setup", "claim_basis": "self_claim"]))
    }

    /// Requirement keys a tool meets through the reviewed map (exact terms and categories only).
    static func keys(_ map: [ToolKey], description: String, category: String) -> [String] {
        let text = description.lowercased(), cat = category.lowercased().trimmingCharacters(in: .whitespaces)
        var out = Set<String>()
        for m in map {
            if m.source_kind == "tool_term",
               text.range(of: "\\b\(NSRegularExpression.escapedPattern(for: m.source_key))\\b", options: .regularExpression) != nil { out.insert(m.requirement_key) }
            if m.source_kind == "tool_category", !cat.isEmpty, m.source_key == cat { out.insert(m.requirement_key) }
        }
        return out.sorted()
    }

    static func keyWords(_ key: String) -> String {
        key.split(separator: ".").map { $0.replacingOccurrences(of: "_", with: " ") }.joined(separator: " · ")
    }

    struct ConfirmParams: Encodable, Equatable, Sendable { let p_source_kind: String; let p_source_id: String; let p_snapshot_hash: String }

    static func confirm(_ r: ProviderSuggestions.Record) -> ConfirmParams {
        ConfirmParams(p_source_kind: r.sourceKind, p_source_id: r.sourceId, p_snapshot_hash: r.snapshotHash)
    }

    static func failure(_ error: Error) -> String {
        let m = (error as? PostgrestError)?.message ?? ""
        if let pg = error as? PostgrestError, pg.code == "23505" { return "Already on record." }
        if m.contains("Sign-in required") || m.contains("Authentication required") { return "Sign in first." }
        if !m.isEmpty, m.count < 200 { return JobCopy.sentence(m) }
        return ReadFailure.text(error)
    }
}

// MARK: - Reads and writes

enum ProviderSetupReaders {
    static func suggestions() async -> JobLoad<ProviderSuggestions> {
        let raw: JobLoad<JobJSON> = await JobReaders.call("my_suggested_provider_links") {
            try await SupabaseService.client.rpc("my_suggested_provider_links").execute().data
        }
        switch raw {
        case .loaded(let j): return .loaded(ProviderSuggestions(json: j))
        case .refused(let r): return .refused(r)
        case .loading: return .loading
        }
    }

    static func profile(userId: String) async -> JobLoad<ProviderSetupProfile> {
        let raw: JobLoad<JobJSON> = await JobReaders.call("provider_profile_read") {
            try await SupabaseService.client.rpc("provider_profile_read", params: ["p_user_id": userId]).execute().data
        }
        switch raw {
        case .loaded(let j): return .loaded(ProviderSetupProfile(json: j))
        case .refused(let r): return .refused(r)
        case .loading: return .loading
        }
    }

    static func own(userId: String) async -> OwnProviderRow? {
        try? await SupabaseService.client.from("profiles").select("username,is_public,profession,expertise_areas")
            .eq("id", value: userId).single().execute().value
    }

    static func toolKeys() async -> [ToolKey] {
        ((try? await SupabaseService.client.from("tool_requirement_key_map").select("source_kind,source_key,requirement_key").execute().value)
            ?? [ToolKey]()).filter { $0.source_kind == "tool_term" || $0.source_kind == "tool_category" }
    }
}

enum ProviderSetupWriters {
    private static func run(_ op: () async throws -> Void) async -> String? {
        do { try await op(); return nil } catch {
            NSLog("NukeCapture provider setup write failed: %@", String(describing: error))
            return ProviderSetupDrafting.failure(error)
        }
    }

    static func insert(_ table: String, _ row: [String: JobJSON]) async -> String? {
        await run { try await SupabaseService.client.from(table).insert(JobJSON.object(row)).execute() }
    }
    static func saveTrade(userId: String, _ row: ProviderSetupDrafting.TradeRow) async -> String? {
        await run { try await SupabaseService.client.from("profiles").update(row).eq("id", value: userId).execute() }
    }
    static func addTool(_ row: ProviderSetupDrafting.ToolRow) async -> String? {
        await run { try await SupabaseService.client.from("user_tools").insert(row).execute() }
    }
    static func rpc<P: Encodable & Sendable>(_ name: String, _ params: P) async -> String? {
        await run { try await SupabaseService.client.rpc(name, params: params).execute() }
    }
    static func availability(_ p: ProviderSetupDrafting.AvailabilityParams) async -> String? {
        await run { try await SupabaseService.client.rpc("set_provider_availability", params: ["p_windows": p.p_windows]).execute() }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
