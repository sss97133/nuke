// ExploreView.swift — the consumer MARKET READ TERMINAL (the decided frame,
// 2026-06-14: Explore is a read terminal onto a market dataset, NOT an Instagram
// wall of newest vehicles; it's the Build-1 form of the cut Map).
//
// LANDING (no query): the live market pulse by metro — marketplace_metro_pulse
//   (clean per-metro rollups: price, turnover, active, avg year). Tap a metro →
//   its make breakdown (marketplace_velocity, the drill). Pure market data.
// SEARCH (≥2 chars): the existing vehicles query → a photo grid of individuals,
//   plus a COHORT row that pushes CohortTerminalView (the reverse-DSO instrument).
// Cells/rows PUSH via .navigationDestination — back chevron, never a dead-end.
// Reuses VehicleHeaderRow + CohortTerminalView. anon client only (explore-without-auth).

import SwiftUI

/// A clean year-make-model the search resolved to — the push target for the
/// COHORT entry. Hashable so it rides a second .navigationDestination on the same
/// stack that pushes individual vehicles. Built ONLY from an unambiguous parse
/// (see detectCohort) or the dominant make+model in the results (dominantCohort).
struct CohortTarget: Hashable {
    let year: Int
    let make: String
    let model: String
    /// "1966 Ford Mustang" — the row label.
    var label: String { "\(year) \(make) \(model)" }
}

/// One metro's market pulse (marketplace_metro_pulse) — the clean LANDING row.
struct MarketMetro: Decodable, Hashable, Identifiable {
    let metro: String              // "City, ST" — may be multi-word ("Colorado Springs, CO")
    let total_listings: Int
    let active: Int
    let sold: Int?
    let avg_price: Int?
    let turnover_pct: Double?
    let avg_year: Int?
    let unique_sellers: Int?

    var id: String { metro }

    /// Split on the LAST ", " so multi-word cities survive — velocity stores city +
    /// state separately and matches these verbatim (city=eq, state=eq).
    var cityState: (city: String, state: String)? {
        guard let comma = metro.range(of: ", ", options: .backwards) else { return nil }
        let city = String(metro[..<comma.lowerBound]).trimmingCharacters(in: .whitespaces)
        let state = String(metro[comma.upperBound...]).trimmingCharacters(in: .whitespaces)
        guard !city.isEmpty, !state.isEmpty else { return nil }
        return (city, state)
    }
}

/// One make's velocity within a metro (marketplace_velocity) — the DRILL row.
struct MarketMake: Decodable, Identifiable {
    let make: String
    let total_listings: Int
    let active_count: Int
    let sold_count: Int?
    let avg_active_price: Double?     // null on low-volume makes
    let avg_sold_price: Double?
    let avg_hours_on_market: Double?
    let turnover_pct: Double?

    var id: String { make }
}

struct ExploreView: View {
    @State private var query = ""
    @State private var metros: [MarketMetro] = []
    @State private var results: [VehicleHeaderRow] = []
    @State private var loadingFeed = false
    @State private var feedError = false
    @State private var searchError = false   // a failed search ≠ "no matches"
    @State private var searched = false
    @State private var feedRetried = false   // cold-launch first call self-heals once
    // The Worklight: report the stage, never a blank spinner; a stall reads as an
    // honest failure with retry, never "nothing here".
    @State private var feedStage = "Reading the market…"

    // 3-column square grid, 2pt gutters — the SEARCH-results photo grid.
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    /// Search is active once the user types ≥2 chars: the landing (market pulse)
    /// gives way to the search-into-individuals grid + cohort.
    private var isSearching: Bool {
        query.trimmingCharacters(in: .whitespaces).count >= 2
    }

    /// The cohort the query resolves to. FIRST the strict explicit parse (a leading
    /// 4-digit year + make + model). Failing that — so "mustang" / "k5 blazer" /
    /// "ford mustang" no longer DEAD-END in the photo grid (the buried-instrument
    /// defect) — DERIVE it from the search results: the dominant make+model among the
    /// matched rows, year taken from those same rows. Grounded in real data, never a
    /// guess. When non-nil, a COHORT TERMINAL row leads the results.
    private var cohort: CohortTarget? {
        if let strict = Self.detectCohort(query) { return strict }
        guard query.trimmingCharacters(in: .whitespaces).count >= 2, !results.isEmpty else { return nil }
        return Self.dominantCohort(in: results)
    }

    /// Derive a cohort from search results when the user didn't type a clean YMM:
    /// the most-common make+model pair (require ≥2 hits so we never guess off a
    /// single row), with the year = the MODE year among that pair's rows. This
    /// un-buries CohortTerminalView for natural queries without inventing data.
    static func dominantCohort(in rows: [VehicleHeaderRow]) -> CohortTarget? {
        struct Acc { var make: String; var model: String; var years: [Int] }
        var groups: [String: Acc] = [:]
        for r in rows {
            guard let mk = r.make?.trimmingCharacters(in: .whitespaces), !mk.isEmpty,
                  let md = r.model?.trimmingCharacters(in: .whitespaces), !md.isEmpty else { continue }
            let key = (mk + "|" + md).lowercased()
            var acc = groups[key] ?? Acc(make: mk, model: md, years: [])
            if let y = r.year, y > 1885 { acc.years.append(y) }
            groups[key] = acc
        }
        guard let top = groups.values.max(by: { $0.years.count < $1.years.count }),
              top.years.count >= 2 else { return nil }
        let modeYear = top.years.reduce(into: [Int: Int]()) { $0[$1, default: 0] += 1 }
            .max(by: { $0.value < $1.value })!.key
        return CohortTarget(year: modeYear, make: titleCase(top.make), model: titleCase(top.model))
    }

    /// Parse a clean year-make-model out of the search term, or nil. STRICT: the
    /// first token must be a valid 4-digit year, then at least two more tokens (a
    /// make + a model remainder). "1966 ford mustang" → (1966, "Ford", "Mustang");
    /// "mustang" / "ford mustang" / "1966 ford" → nil (no clean YMM to resolve).
    static func detectCohort(_ raw: String) -> CohortTarget? {
        let tokens = raw.trimmingCharacters(in: .whitespaces)
            .split(whereSeparator: { $0.isWhitespace })
            .map(String.init)
        guard tokens.count >= 3 else { return nil }            // need year + make + model
        let yearTok = tokens[0]
        guard yearTok.count == 4, let year = Int(yearTok) else { return nil }
        // Calendar year ceiling: next model year is valid (e.g. 2027 in late 2026).
        let nextYear = (Calendar.current.component(.year, from: Date())) + 1
        guard year > 1885, year <= nextYear else { return nil }
        let make = tokens[1]
        let model = tokens[2...].joined(separator: " ")
        guard !make.isEmpty, !model.isEmpty else { return nil }
        return CohortTarget(year: year, make: titleCase(make), model: titleCase(model))
    }

    /// Title-case each word ("ford" → "Ford", "model t" → "Model T"). Leaves
    /// already-uppercase tokens (e.g. "GT350") intact rather than lowercasing them.
    private static func titleCase(_ s: String) -> String {
        s.split(separator: " ").map { word -> String in
            let str = String(word)
            if str == str.uppercased() { return str }          // GT350, K-code stay as typed
            return str.prefix(1).uppercased() + str.dropFirst().lowercased()
        }.joined(separator: " ")
    }

    var body: some View {
        NavigationStack {
            Group {
                if isSearching {
                    searchResults
                } else {
                    marketLanding
                }
            }
            .navigationTitle("Explore")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Year, make, or model")
            .navigationDestination(for: VehicleHeaderRow.self) { v in
                // PUSH (back chevron) — kills the Done-only dead-end.
                VehicleDetailView(vehicleId: v.id.uuidString.lowercased(),
                                  embedInNavigationStack: false)
            }
            .navigationDestination(for: CohortTarget.self) { c in
                // PUSH the cohort instrument. Its comp rows drill back into this
                // same stack via the VehicleHeaderRow destination above.
                CohortTerminalView(make: c.make, model: c.model, year: c.year)
            }
            .navigationDestination(for: MarketMetro.self) { m in
                // PUSH the metro's make breakdown (the C10 drill on a metro number).
                MetroDetailView(metro: m)
            }
            .task { await loadMetros() }
            .task(id: query) {
                let term = query.trimmingCharacters(in: .whitespaces)
                guard term.count >= 2 else { results = []; searched = false; return }
                try? await Task.sleep(nanoseconds: 300_000_000)   // debounce
                guard !Task.isCancelled else { return }
                await search(term)
            }
        }
    }

    // ─── LANDING — the market pulse by metro (the read terminal) ────────────────
    @ViewBuilder private var marketLanding: some View {
        if loadingFeed && metros.isEmpty {
            // Worklight: a labeled, live stage — never a dead blank spinner.
            VStack(spacing: 10) {
                ProgressView()
                Text(feedStage)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .contentTransition(.opacity)
                    .animation(.default, value: feedStage)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if feedError && metros.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load the market", systemImage: "wifi.exclamationmark")
            } description: {
                Text("Check your connection.")
            } actions: {
                Button("Retry") { Task { await loadMetros(force: true) } }
                    .buttonStyle(.borderedProminent)
            }
        } else if metros.isEmpty {
            ContentUnavailableView(
                "No market data",
                systemImage: "binoculars",
                description: Text("Pull to refresh.")
            )
        } else {
            List {
                Section {
                    ForEach(metros) { m in
                        NavigationLink(value: m) { metroRow(m) }
                    }
                } header: {
                    Text("Market pulse · by metro")
                } footer: {
                    Text("The live listings market — where vehicles move, what they cost, how fast. Tap a metro for its make breakdown; search a make or model for its cohort.")
                }
            }
            .refreshable { await loadMetros(force: true) }
        }
    }

    // ─── SEARCH — individuals + the cohort row (unchanged behavior) ─────────────
    @ViewBuilder private var searchResults: some View {
        if searched && searchError && results.isEmpty {
            ContentUnavailableView {
                Label("Couldn't search", systemImage: "wifi.exclamationmark")
            } description: {
                Text("Check your connection.")
            } actions: {
                Button("Retry") {
                    Task { await search(query.trimmingCharacters(in: .whitespaces)) }
                }
                .buttonStyle(.borderedProminent)
            }
        } else if !searched && results.isEmpty && cohort == nil {
            // Debounce in flight — a labeled stage, never a premature "No matches".
            VStack(spacing: 10) {
                ProgressView()
                Text("Searching…")
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if results.isEmpty && cohort == nil {
            ContentUnavailableView(
                "No matches",
                systemImage: "magnifyingglass",
                description: Text("Try a make, model, or year.")
            )
        } else {
            ScrollView {
                // COHORT entry leads the results — pushes CohortTerminalView.
                if let c = cohort {
                    NavigationLink(value: c) { cohortRow(c) }
                        .buttonStyle(.plain)
                    Divider()
                }
                LazyVGrid(columns: columns, spacing: 2) {
                    ForEach(results) { v in
                        NavigationLink(value: v) { cell(v) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // ─── One metro pulse row — native, mono digits, the 5 reliable signals ──────
    @ViewBuilder private func metroRow(_ m: MarketMetro) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(m.metro)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)
                Text("\(m.total_listings) listings")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 14) {
                if let p = m.avg_price { metroStat("avg", "$\(p.formatted())") }
                if let t = m.turnover_pct {
                    metroStat("turnover", "\(t.formatted(.number.precision(.fractionLength(1))))%")
                }
                metroStat("active", "\(m.active)")
                if let s = m.sold, s > 0 { metroStat("sold", "\(s)") }
                if let y = m.avg_year { metroStat("avg yr", "\(y)") }
            }
        }
        .padding(.vertical, 3)
    }

    @ViewBuilder private func metroStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(.caption, design: .monospaced)).foregroundStyle(.primary)
            Text(label).font(.system(size: 9)).foregroundStyle(.secondary)
        }
    }

    // ─── The COHORT row — a standard disclosure row, distinct from the photo grid.
    @ViewBuilder private func cohortRow(_ c: CohortTarget) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "square.grid.3x3.fill")
                .font(.title3)
                .foregroundStyle(.secondary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(c.label)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Text("Cohort Terminal")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    // ─── One square thumbnail cell — render-endpoint thumb, never a void.
    @ViewBuilder private func cell(_ v: VehicleHeaderRow) -> some View {
        Color(.secondarySystemFill)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                CachedAsyncImage(url: NukeImage.thumb(v.primary_image_url, width: 200)) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "car.side")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
            }
            .clipped()
            .contentShape(Rectangle())
    }

    // ─── Landing load — the market pulse. The 12s timeout races the fetch so a
    // stalled client request can never leave a dead spinner; retry-once self-heals
    // the cold-launch first call; dirty "Unknown" metros are dropped (honest geo).
    private func loadMetros(force: Bool = false) async {
        guard force || metros.isEmpty else { return }
        loadingFeed = true
        feedError = false
        feedStage = "Reading the market…"
        defer { loadingFeed = false }
        do {
            let raw: [MarketMetro] = try await withMarketTimeout(seconds: 12) {
                try await SupabaseService.client
                    .from("marketplace_metro_pulse")
                    .select("metro,total_listings,active,sold,avg_price,turnover_pct,avg_year,unique_sellers")
                    .order("total_listings", ascending: false)
                    .limit(50)
                    .execute()
                    .value
            }
            // Drop any dirty-geo metro so the clean landing never shows "Unknown".
            metros = raw.filter { !$0.metro.localizedCaseInsensitiveContains("unknown") }
            feedStage = "\(metros.count) metros · live"
            feedRetried = false
        } catch {
            if !feedRetried {
                feedRetried = true
                try? await Task.sleep(nanoseconds: 400_000_000)
                await loadMetros(force: true)
                return
            }
            feedError = true
            NSLog("NukeCapture explore market pulse failed: %@", String(describing: error))
        }
    }

    // ─── Search — tokenized: a 4-digit year token becomes an AND year.eq filter,
    // the remaining words become an OR(make,model) text match. Order-independent.
    private func search(_ term: String) async {
        let clean = term.replacingOccurrences(of: "*", with: "")
            .replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
        let tokens = clean.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        var year: Int? = nil
        var textTokens: [String] = []
        for tok in tokens {
            if year == nil, tok.count == 4, let n = Int(tok), n > 1885, n < 2100 {
                year = n
            } else {
                textTokens.append(tok)
            }
        }
        let text = textTokens.joined(separator: " ")
        searchError = false
        do {
            var q = SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,trim,primary_image_url")
                .eq("is_public", value: true)
                .neq("status", value: "pending")
            if let yr = year { q = q.eq("year", value: yr) }
            if !text.isEmpty { q = q.or("make.ilike.*\(text)*,model.ilike.*\(text)*") }
            let raw: [VehicleHeaderRow] = try await q
                .order("year", ascending: false)
                .limit(60)
                .execute()
                .value
            results = raw.filter { ($0.primary_image_url?.isEmpty == false) }
            searched = true
        } catch {
            searchError = true
            searched = true
            NSLog("NukeCapture explore search failed: %@", String(describing: error))
        }
    }
}

// ─── Metro detail — the make breakdown behind a metro's pulse ───────────────────
// The C10 drill: a metro number → its composition. The header renders the TAPPED
// row's OWN pulse numbers (the two views don't reconcile — velocity make-rows sum
// ~12-20% under pulse's total — so we never sum the make-rows into a fake total);
// the make section is its own grain. Pure market data, no images, anon.
struct MetroDetailView: View {
    let metro: MarketMetro

    @State private var makes: [MarketMake] = []
    @State private var loading = true
    @State private var loadError = false

    var body: some View {
        List {
            // Header — the pulse the user just tapped, verbatim (no refetch).
            Section {
                HStack(spacing: 18) {
                    stat("listings", "\(metro.total_listings)")
                    stat("active", "\(metro.active)")
                    if let p = metro.avg_price { stat("avg price", "$\(p.formatted())") }
                    if let t = metro.turnover_pct {
                        stat("turnover", "\(t.formatted(.number.precision(.fractionLength(1))))%")
                    }
                }
            } footer: {
                Text("Live listings market for \(metro.metro). The make breakdown below is a separate aggregate — its counts won't sum to the metro total.")
            }

            if loading {
                Section {
                    HStack(spacing: 8) {
                        ProgressView().scaleEffect(0.7)
                        Text("Reading the make breakdown…")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            } else if loadError {
                Section {
                    HStack {
                        Label("Couldn't load", systemImage: "wifi.exclamationmark")
                            .font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry") { Task { await load() } }.font(.caption2)
                    }
                }
            } else if makes.isEmpty {
                Section {
                    Text("No make data for this metro.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Section("By make") {
                    ForEach(makes) { mk in makeRow(mk) }
                }
            }
        }
        .navigationTitle(metro.metro)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private func makeRow(_ mk: MarketMake) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(mk.make).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                Spacer(minLength: 0)
                Text("\(mk.total_listings)")
                    .font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
            }
            HStack(spacing: 14) {
                stat("active", "\(mk.active_count)")
                if let s = mk.sold_count, s > 0 { stat("sold", "\(s)") }
                if let ap = mk.avg_active_price { stat("ask", "$\(Int(ap).formatted())") }
                if let sp = mk.avg_sold_price { stat("sold $", "$\(Int(sp).formatted())") }
                if let h = mk.avg_hours_on_market { stat("hrs on mkt", "\(Int(h))") }
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(.caption, design: .monospaced)).foregroundStyle(.primary)
            Text(label).font(.system(size: 9)).foregroundStyle(.secondary)
        }
    }

    private func load() async {
        loading = true
        loadError = false
        defer { loading = false }
        guard let cs = metro.cityState else { loadError = true; return }
        do {
            makes = try await withMarketTimeout(seconds: 12) {
                try await SupabaseService.client
                    .from("marketplace_velocity")
                    .select("make,total_listings,active_count,sold_count,avg_active_price,avg_sold_price,avg_hours_on_market,turnover_pct")
                    .eq("city", value: cs.city)
                    .eq("state", value: cs.state)
                    .order("total_listings", ascending: false)
                    .limit(40)
                    .execute()
                    .value
            }
        } catch {
            loadError = true
            NSLog("NukeCapture metro detail failed: %@", String(describing: error))
        }
    }
}

/// Race async work against a timeout — first to finish wins; the loser is
/// cancelled. Converts a stalled network call into a recoverable error. Shared by
/// the market landing (ExploreView) + the metro drill (MetroDetailView).
fileprivate func withMarketTimeout<T: Sendable>(
    seconds: Double, _ work: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await work() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            throw CancellationError()
        }
        defer { group.cancelAll() }
        return try await group.next()!
    }
}
