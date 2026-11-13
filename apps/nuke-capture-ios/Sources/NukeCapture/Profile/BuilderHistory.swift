// BuilderHistory.swift — under the photo record: the vehicles, the work and the money behind it.
//
// Three versioned read functions (migration 20261116050000), each computed from evidence rows:
//
//   profile_vehicle_relationships_read_v1 → vehicles tied to the person by evidence, each with its roles
//                                           and the first and last evidence time. Roles are derived,
//                                           never declared; a visitor sees title-backed owner only.
//   profile_labor_read_v1                 → work sessions split into owner-confirmed and inferred,
//                                           never added together. Hours read "inferred", never "proven".
//   profile_money_read_v1                 → the account's own money flows (others get visible:false),
//                                           trusted totals apart from flagged rows.
//
// The profile shows each as one row of counts that drills into the reader's own breakdown. The
// Garage tab owns the vehicle list and the shop's capability; this section does not repeat them.

import SwiftUI

// ─── Reader payloads (exact shapes, verified against prod 2026-11-12) ──────────────────────────

struct VehicleRelationshipsRead: Decodable {
    struct Role: Decodable {
        let role: String?
        let first_at: String?
        let last_at: String?
    }
    struct Vehicle: Decodable {
        let vehicle_id: String
        let year: Int?
        let make: String?
        let model: String?
        let ownership_class: String?
        let roles: [Role]?
    }
    let evidence_visible: Bool?
    let class_counts: [String: Int]?
    let vehicles: [Vehicle]?
}

struct LaborRead: Decodable {
    struct Status: Decodable { let sessions: Int?; let minutes: Int? }
    struct Basis: Decodable {
        let hours: Double?
        let minutes: Int?
        let sessions: Int?
        let vehicles: Int?
        let first_day: String?
        let last_day: String?
        let sessions_without_duration: Int?
        let by_status: [String: Status]?
        let confidence: Double?
    }
    let owner_confirmed: Basis?
    let inferred: Basis?
    let evidence_visible: Bool?
    let rule: String?
}

struct MoneyRead: Decodable {
    struct Total: Decodable, Identifiable {
        let scope: String?
        let direction: String?
        let basis: String?
        let currency: String?
        let trusted_amount: Double?
        let trusted_count: Int?
        let flagged_amount: Double?
        let flagged_count: Int?
        var id: String { [scope, direction, basis, currency].map { $0 ?? "-" }.joined(separator: "|") }
    }
    let visible: Bool
    let totals: [Total]?
    let rule: String?
}

// ─── Pure summaries (unit-tested in UnitTests/BuilderHistoryTests.swift) ────────────────────────

struct VehicleTimeline: Equatable {
    struct Count: Equatable, Identifiable { let key: String; let label: String; let n: Int; var id: String { key } }
    struct YearCount: Equatable, Identifiable { let year: Int; let n: Int; var id: Int { year } }
    /// Vehicles the reader returned.
    let total: Int
    /// New vehicles per year of first evidence, ascending, from the 1st-percentile year to the last.
    let perYear: [YearCount]
    /// Vehicles with no dated evidence role (shown as unknown, not dropped).
    let undated: Int
    /// First-evidence years before the span start (misdated or long-tail).
    let earlier: Int
    /// owned · contributed · unresolved · no evidence yet, in that order, zeros left out.
    let classes: [Count]

    static let classOrder: [(keys: [String], label: String)] = [
        (["owner"], "owned"),
        (["contributor"], "contributed"),
        (["ambiguous", "unresolved"], "unresolved"),
        (["no_evidence"], "no evidence yet"),
    ]

    /// Nil when the reader returned no vehicle list (unknown, not zero vehicles).
    init?(_ read: VehicleRelationshipsRead) {
        guard let vehicles = read.vehicles else {
            guard let counts = read.class_counts, !counts.isEmpty else { return nil }
            self.init(vehicles: [], counts: counts)
            return
        }
        self.init(vehicles: vehicles, counts: read.class_counts ?? [:])
    }

    private init(vehicles: [VehicleRelationshipsRead.Vehicle], counts: [String: Int]) {
        var byYear: [Int: Int] = [:]
        var undated = 0
        for v in vehicles {
            let firsts = (v.roles ?? []).compactMap { $0.first_at.flatMap { Int($0.prefix(4)) } }
            if let y = firsts.min() { byYear[y, default: 0] += 1 } else { undated += 1 }
        }
        let ascending = byYear.keys.sorted().map { ($0, byYear[$0]!) }
        let start = PhotoHistory.percentileStart(ascending)
        let last = ascending.last?.0
        var perYear: [YearCount] = []
        if let start, let last, start <= last { for y in start...last { perYear.append(YearCount(year: y, n: byYear[y] ?? 0)) } }
        self.total = vehicles.isEmpty ? counts.values.reduce(0, +) : vehicles.count
        self.perYear = perYear
        self.undated = undated
        self.earlier = start.map { s in ascending.filter { $0.0 < s }.reduce(0) { $0 + $1.1 } } ?? 0
        self.classes = Self.classOrder.compactMap { c in
            let n = c.keys.reduce(0) { $0 + (counts[$1] ?? 0) }
            return n > 0 ? Count(key: c.keys[0], label: c.label, n: n) : nil
        }
    }

    var headline: String { NukeDisplay.count(total, "vehicle") }
    var detail: String? {
        classes.isEmpty ? nil : classes.map { "\($0.n.formatted()) \($0.label)" }.joined(separator: " · ")
    }
    /// "First evidence 2016 · 38 undated"; nil with no dated vehicle.
    var spanLine: String? {
        var parts: [String] = []
        if let first = perYear.first?.year { parts.append("First evidence \(first)") }
        if undated > 0 { parts.append("\(undated.formatted()) undated") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

enum LaborCopy {
    /// "1,444.8h" → "1,445h"; under 10 h keeps one decimal ("1.4h").
    static func hours(_ h: Double) -> String {
        h < 10 ? "\(h.formatted(.number.precision(.fractionLength(0...1))))h" : "\(Int(h.rounded()).formatted())h"
    }

    /// "1,445h inferred"; nil when the reader has no inferred sessions.
    static func inferredHeadline(_ r: LaborRead) -> String? {
        guard let b = r.inferred, let h = b.hours else { return nil }
        return "\(hours(h)) inferred"
    }

    /// "1,910 sessions · 111 vehicles · last 2026-06-20".
    static func inferredDetail(_ r: LaborRead) -> String? {
        guard let b = r.inferred else { return nil }
        let parts = [b.sessions.map { NukeDisplay.count($0, "session") },
                     b.vehicles.map { NukeDisplay.count($0, "vehicle") },
                     b.last_day.map { "last \($0)" }].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// "1.4h confirmed by you · 4 sessions" (own) / "… confirmed by the owner" (visitor); nil when none.
    static func confirmedLine(_ r: LaborRead, isOwn: Bool) -> String? {
        guard let b = r.owner_confirmed, let s = b.sessions, s > 0 else { return nil }
        let who = isOwn ? "confirmed by you" : "owner-confirmed"
        return [b.hours.map { "\(hours($0)) \(who)" } ?? who, NukeDisplay.count(s, "session")].joined(separator: " · ")
    }
}

enum MoneyCopy {
    struct Summary: Equatable {
        let receipts: Int
        let payments: Int
        let inUSD: Double?
        let outUSD: Double?
        let heldBack: Int
    }

    /// Personal scope only (organization flows are the organization's), trusted USD amounts only. A NULL
    /// currency is unrecorded, not USD, so it never joins a dollar sum; those rows count as held back.
    static func summary(_ m: MoneyRead) -> Summary? {
        guard m.visible, let totals = m.totals, !totals.isEmpty else { return nil }
        func rows(_ t: MoneyRead.Total) -> Int { (t.trusted_count ?? 0) + (t.flagged_count ?? 0) }
        let personal = totals.filter { $0.scope == "personal" }
        func usd(_ dir: String) -> Double? {
            let xs = personal.filter { $0.direction == dir && $0.currency == "USD" }.compactMap(\.trusted_amount)
            return xs.isEmpty ? nil : xs.reduce(0, +)
        }
        return Summary(
            receipts: totals.filter { $0.basis == "receipt_total" }.reduce(0) { $0 + rows($1) },
            payments: totals.filter { $0.basis == "payment" }.reduce(0) { $0 + rows($1) },
            inUSD: usd("in"), outUSD: usd("out"),
            heldBack: totals.reduce(0) { $0 + ($1.flagged_count ?? 0) })
    }

    static func countsLine(_ s: Summary) -> String {
        [NukeDisplay.count(s.receipts, "receipt"), NukeDisplay.count(s.payments, "payment")].joined(separator: " · ")
    }

    static func usd(_ x: Double) -> String { x.formatted(.currency(code: "USD").precision(.fractionLength(0))) }

    /// "$348,650 in · $267,098 out · trusted rows"; nil when no trusted USD flow.
    static func flowLine(_ s: Summary) -> String? {
        let parts = [s.inUSD.map { "\(usd($0)) in" }, s.outUSD.map { "\(usd($0)) out" }].compactMap { $0 }
        return parts.isEmpty ? nil : (parts + ["trusted rows"]).joined(separator: " · ")
    }
}

// ─── Loader ─────────────────────────────────────────────────────────────────────────────────────

enum BuilderHistoryReader {
    static func vehicles(userId: String) async throws -> VehicleRelationshipsRead {
        try await SupabaseService.client.rpc("profile_vehicle_relationships_read_v1", params: ["p_user_id": userId]).execute().value
    }
    static func labor(userId: String) async throws -> LaborRead {
        try await SupabaseService.client.rpc("profile_labor_read_v1", params: ["p_user_id": userId]).execute().value
    }
    static func money(userId: String) async throws -> MoneyRead {
        try await SupabaseService.client.rpc("profile_money_read_v1", params: ["p_user_id": userId]).execute().value
    }
}

// ─── The section ────────────────────────────────────────────────────────────────────────────────

struct BuilderHistorySection: View {
    let userId: String
    let isOwn: Bool
    /// Opens the Garage tab (own profile); nil for a visitor, whose public vehicles are listed below.
    var openGarage: (() -> Void)? = nil

    @State private var vehicles: VehicleTimeline?
    @State private var vehiclesLoaded = false
    @State private var vehiclesFailed = false
    @State private var labor: LaborRead?
    @State private var laborFailed = false
    @State private var money: MoneyRead?

    var body: some View {
        Section {
            vehiclesRow
            laborRow
            if isOwn { moneyRow }
        } header: {
            Text("Builder history")
        }
        .task(id: userId) { await load() }
    }

    private func load() async {
        async let v: Void = loadVehicles()
        async let l: Void = loadLabor()
        async let m: Void = loadMoney()
        _ = await (v, l, m)
    }
    private func loadVehicles() async {
        defer { vehiclesLoaded = true }
        do { vehicles = VehicleTimeline(try await BuilderHistoryReader.vehicles(userId: userId)); vehiclesFailed = false }
        catch { vehiclesFailed = true; NSLog("NukeCapture profile vehicles read failed: %@", String(describing: error)) }
    }
    private func loadLabor() async {
        do { labor = try await BuilderHistoryReader.labor(userId: userId); laborFailed = false }
        catch { laborFailed = true; NSLog("NukeCapture profile labor read failed: %@", String(describing: error)) }
    }
    private func loadMoney() async {
        guard isOwn else { return }
        do { money = try await BuilderHistoryReader.money(userId: userId) }
        catch { NSLog("NukeCapture profile money read failed: %@", String(describing: error)) }
    }

    // Vehicles: the count, the classes, and new vehicles per year of first evidence.
    @ViewBuilder private var vehiclesRow: some View {
        if let v = vehicles {
            let content = VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(v.headline).font(.nukeCardTitle).monospacedDigit().foregroundStyle(Color.primary)
                    Spacer()
                    if let span = v.spanLine { Text(span).font(.caption).monospacedDigit().foregroundStyle(.secondary) }
                }
                if let detail = v.detail {
                    Text(detail).font(.footnote).monospacedDigit().foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if v.perYear.count > 1 { VehicleYearStrip(perYear: v.perYear) }
            }
            .frame(maxWidth: .infinity, minHeight: NukeSize.minTap, alignment: .leading)
            .contentShape(Rectangle())
            if let openGarage {
                Button(action: openGarage) { content }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the Garage tab")
            } else {
                content
            }
        } else if vehiclesFailed {
            Text("Vehicle history unavailable").font(.footnote).foregroundStyle(.secondary)
        } else if !vehiclesLoaded {
            NukeSkeletonBlock(height: 44)
        }
        // Loaded with no vehicle evidence: no row, never "0 vehicles".
    }

    @ViewBuilder private var laborRow: some View {
        if let labor, let headline = LaborCopy.inferredHeadline(labor) ?? LaborCopy.confirmedLine(labor, isOwn: isOwn) {
            NavigationLink { LaborDetailView(read: labor, isOwn: isOwn) } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(headline).font(.nukeCardTitle).monospacedDigit().foregroundStyle(Color.primary)
                    if let d = LaborCopy.inferredDetail(labor) {
                        Text(d).font(.footnote).monospacedDigit().foregroundStyle(.secondary)
                    }
                    if LaborCopy.inferredHeadline(labor) != nil, let c = LaborCopy.confirmedLine(labor, isOwn: isOwn) {
                        Text(c).font(.caption).monospacedDigit().foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 2)
            }
        } else if laborFailed {
            Text("Work history unavailable").font(.footnote).foregroundStyle(.secondary)
        }
        // A reader that answered with no sessions: no row, never "0h".
    }

    @ViewBuilder private var moneyRow: some View {
        if let money, let s = MoneyCopy.summary(money) {
            NavigationLink { MoneyDetailView(read: money) } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(MoneyCopy.countsLine(s)).font(.nukeCardTitle).monospacedDigit().foregroundStyle(Color.primary)
                    if let flow = MoneyCopy.flowLine(s) {
                        Text(flow).font(.footnote).monospacedDigit().foregroundStyle(.secondary)
                    }
                    Text("\(s.heldBack.formatted()) rows held back for review · only you see this")
                        .font(.caption).monospacedDigit().foregroundStyle(.tertiary)
                }
                .padding(.vertical, 2)
            }
        }
    }
}

/// New vehicles per year of first evidence: small bars, the year under the first and last.
struct VehicleYearStrip: View {
    let perYear: [VehicleTimeline.YearCount]

    var body: some View {
        let peak = max(perYear.map(\.n).max() ?? 1, 1)
        VStack(spacing: 2) {
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(perYear) { y in
                    RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                        .fill(y.n > 0 ? Color.accentColor.opacity(0.72) : Color.secondary.opacity(0.25))
                        .frame(height: y.n > 0 ? max(3, 28 * CGFloat(y.n) / CGFloat(peak)) : 1)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 28, alignment: .bottom)
            HStack {
                Text(String(perYear.first?.year ?? 0))
                Spacer()
                Text(String(perYear.last?.year ?? 0))
            }
            .font(.caption2).monospacedDigit().foregroundStyle(.tertiary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("New vehicles per year of first evidence")
        .accessibilityValue(perYear.map { "\($0.year): \($0.n)" }.joined(separator: ", "))
    }
}

/// The labor reader's own breakdown: confirmed and inferred side by side, by status, with the rule.
struct LaborDetailView: View {
    let read: LaborRead
    let isOwn: Bool

    var body: some View {
        List {
            basisSection(isOwn ? "Confirmed by you" : "Owner-confirmed", read.owner_confirmed)
            basisSection("Inferred", read.inferred)
            if let rule = read.rule {
                Section { Text(rule).font(.caption).foregroundStyle(.secondary) } header: { Text("How this is computed") }
            }
        }
        .navigationTitle("Work")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private func basisSection(_ title: String, _ b: LaborRead.Basis?) -> some View {
        Section {
            if let b {
                if let h = b.hours { LabeledContent("Hours", value: LaborCopy.hours(h)) }
                if let s = b.sessions { LabeledContent("Sessions", value: s.formatted()) }
                if let n = b.sessions_without_duration, n > 0 { LabeledContent("Sessions with no duration", value: n.formatted()) }
                if let v = b.vehicles { LabeledContent("Vehicles", value: v.formatted()) }
                if let last = b.last_day { LabeledContent("Last day", value: last) }
                if let c = b.confidence { LabeledContent("Mean confidence", value: c.formatted(.percent.precision(.fractionLength(0)))) }
                ForEach((b.by_status ?? [:]).keys.sorted(), id: \.self) { k in
                    let s = b.by_status?[k]
                    LabeledContent(k.replacingOccurrences(of: "_", with: " ")) {
                        Text([s?.sessions.map { NukeDisplay.count($0, "session") },
                              s?.minutes.map { LaborCopy.hours(Double($0) / 60) }].compactMap { $0 }.joined(separator: " · "))
                            .monospacedDigit()
                    }
                }
            } else {
                Text("None on record").font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text(title)
        }
    }
}

/// The money reader's totals, per scope, direction, basis and currency: trusted apart from flagged.
struct MoneyDetailView: View {
    let read: MoneyRead

    var body: some View {
        List {
            ForEach(["personal", "organization"], id: \.self) { scope in
                let rows = (read.totals ?? []).filter { $0.scope == scope }
                if !rows.isEmpty {
                    Section {
                        ForEach(rows) { t in
                            VStack(alignment: .leading, spacing: 2) {
                                Text([t.direction, t.basis?.replacingOccurrences(of: "_", with: " ")].compactMap { $0 }.joined(separator: " · "))
                                    .font(.subheadline)
                                Text(line(t)).font(.caption).monospacedDigit().foregroundStyle(.secondary)
                            }
                        }
                    } header: {
                        Text(scope.capitalized)
                    }
                }
            }
            if let rule = read.rule {
                Section { Text(rule).font(.caption).foregroundStyle(.secondary) } header: { Text("How this is computed") }
            }
        }
        .navigationTitle("Money")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func line(_ t: MoneyRead.Total) -> String {
        let cur = t.currency ?? "currency unrecorded"
        let trusted = t.trusted_amount.map { "\($0.formatted(.number.precision(.fractionLength(0...2)))) \(cur) trusted (\(t.trusted_count ?? 0))" }
        let flagged = (t.flagged_count ?? 0) > 0
            ? "\(t.flagged_count!.formatted()) flagged\(t.flagged_amount.map { ", \($0.formatted(.number.precision(.fractionLength(0...2)))) \(cur)" } ?? "")"
            : nil
        return [trusted, flagged].compactMap { $0 }.joined(separator: " · ")
    }
}
