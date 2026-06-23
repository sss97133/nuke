// ExploreView.swift — the world's vehicles as a VISUAL GRID (Build-2 §5: explore
// real DB data; §3: query → drillable rows). The §5 return that replaces the cut
// Map: not a search box that's empty until you type, but an Instagram-style wall
// of real records you scroll and drill into.
//
// Two backends, one grid:
//   • FEED (on .task, ~99ms): public vehicles, newest first, only those with a
//     photo — the wall you land on.
//   • SEARCH (≥2 chars): the existing DIRECT vehicles query via the anon client
//     (sub-100ms), NOT the universal-search edge function (measured 24s).
// Cells PUSH into VehicleDetailView via .navigationDestination — a back chevron,
// not a Done-only dead-end. Reuses VehicleHeaderRow from VehicleDetailView.swift.

import SwiftUI

/// A clean year-make-model the search resolved to — the push target for the
/// COHORT entry. Hashable so it rides a second .navigationDestination on the same
/// stack that pushes individual vehicles. Built ONLY from an unambiguous parse
/// (see detectCohort); the app never guesses a cohort it can't cleanly read.
struct CohortTarget: Hashable {
    let year: Int
    let make: String
    let model: String
    /// "1966 Ford Mustang" — the row label.
    var label: String { "\(year) \(make) \(model)" }
}

struct ExploreView: View {
    @State private var query = ""
    @State private var feed: [VehicleHeaderRow] = []
    @State private var results: [VehicleHeaderRow] = []
    @State private var loadingFeed = false
    @State private var feedError = false
    @State private var searchError = false   // a failed search ≠ "no matches"
    @State private var searched = false
    @State private var feedRetried = false   // cold-launch first call self-heals once
    // The Worklight: the feed reports the stage it's IN, never a blank spinner. A
    // stall/timeout reads as an honest failure with retry — never "nothing here".
    @State private var feedStage = "Searching the catalog…"

    // 3-column square grid, 2pt gutters — the Instagram wall.
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    /// What the grid shows: search results when typing, the feed otherwise.
    private var rows: [VehicleHeaderRow] {
        query.trimmingCharacters(in: .whitespaces).count >= 2 ? results : feed
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
        // Title-case the make/model for display + the RPC (matches the web's
        // register-then-fetch casing; the RPC is case-tolerant but this reads right).
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
                if loadingFeed && feed.isEmpty && !searched {
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
                } else if feedError && feed.isEmpty && !searched {
                    // The load timed out / failed — NEVER an endless spinner.
                    ContentUnavailableView {
                        Label("Couldn't load Explore", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text("Check your connection.")
                    } actions: {
                        Button("Retry") { Task { await loadFeed(force: true) } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if searched && searchError && results.isEmpty {
                    // The search request failed — never let that read as "No matches".
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
                } else if rows.isEmpty && cohort == nil {
                    ContentUnavailableView(
                        searched ? "No matches" : "Nothing to show",
                        systemImage: searched ? "magnifyingglass" : "binoculars",
                        description: Text(searched
                            ? "Try a make, model, or year."
                            : "Pull to refresh the feed.")
                    )
                } else {
                    ScrollView {
                        // COHORT entry — when the query parses to a clean YMM, the
                        // cohort itself leads the results: a single standard row that
                        // pushes the CohortTerminalView (the whole population as one
                        // instrument). The individual vehicle grid follows, unchanged.
                        if let c = cohort {
                            NavigationLink(value: c) { cohortRow(c) }
                                .buttonStyle(.plain)
                            Divider()
                        }
                        LazyVGrid(columns: columns, spacing: 2) {
                            ForEach(rows) { v in
                                NavigationLink(value: v) { cell(v) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }
                    .refreshable { await loadFeed(force: true) }
                }
            }
            .navigationTitle("Explore")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Year, make, or model")
            .navigationDestination(for: VehicleHeaderRow.self) { v in
                // PUSH (back chevron) — this is what kills the Done-only dead-end.
                VehicleDetailView(vehicleId: v.id.uuidString.lowercased(),
                                  embedInNavigationStack: false)
            }
            .navigationDestination(for: CohortTarget.self) { c in
                // PUSH the cohort instrument. Its comp rows drill back into this
                // same stack via the VehicleHeaderRow destination above.
                CohortTerminalView(make: c.make, model: c.model, year: c.year)
            }
            .task { await loadFeed() }
            .task(id: query) {
                let term = query.trimmingCharacters(in: .whitespaces)
                guard term.count >= 2 else { results = []; searched = false; return }
                try? await Task.sleep(nanoseconds: 300_000_000)   // debounce
                guard !Task.isCancelled else { return }
                await search(term)
            }
        }
    }

    // ─── The COHORT row — a standard, full-width List-style row (icon · YMM ·
    // "Cohort Terminal" · chevron). Native grammar: it reads as a system
    // disclosure row, distinct from the photo grid below it, signaling "this opens
    // a different KIND of thing — the population, not one vehicle."
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

    // ─── One square thumbnail cell — render-endpoint thumb, a flat plate +
    // SF-symbol fallback, never a void.
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

    // ─── Feed — public vehicles, newest first, photo-bearing. A 12s timeout
    // races the fetch so a stalled client request can NEVER leave a dead
    // spinner (the failure mode Skylar caught): timeout → error state + Retry.
    private func loadFeed(force: Bool = false) async {
        guard force || feed.isEmpty else { return }
        loadingFeed = true
        feedError = false
        feedStage = "Searching the catalog…"
        defer { loadingFeed = false }
        do {
            let raw: [VehicleHeaderRow] = try await withTimeout(seconds: 12) {
                try await SupabaseService.client
                    .from("vehicles")
                    .select("id,year,make,model,trim,primary_image_url")
                    .eq("is_public", value: true)
                    .neq("status", value: "pending")
                    .order("created_at", ascending: false)
                    .limit(80)
                    .execute()
                    .value
            }
            feedStage = "Found \(raw.count) · loading photos…"
            feed = raw
                .filter { ($0.primary_image_url?.isEmpty == false) }
                .prefix(60)
                .map { $0 }
            feedRetried = false
        } catch {
            // The cold-launch first network call can stall (data_stall) and trip
            // the 12s timeout — retry ONCE before surfacing the failure, so the
            // passive feed self-heals instead of greeting you with an error.
            if !feedRetried {
                feedRetried = true
                try? await Task.sleep(nanoseconds: 400_000_000)
                await loadFeed(force: true)
                return
            }
            feedError = true
            NSLog("NukeCapture explore feed failed: %@", String(describing: error))
        }
    }

    /// Race async work against a timeout — first to finish wins; the loser is
    /// cancelled. Converts a stalled network call into a recoverable error.
    private func withTimeout<T: Sendable>(seconds: Double,
                                          _ work: @escaping @Sendable () async throws -> T) async throws -> T {
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

    // ─── Search — tokenized: a 4-digit year token becomes an AND year.eq filter,
    // the remaining words become an OR(make,model) text match. So "1966 mustang"
    // is year=1966 AND (make/model ~ "mustang"), not one literal ILIKE that no row
    // can satisfy. Order-independent: "mustang 1966" resolves identically.
    private func search(_ term: String) async {
        // Sanitize PostgREST filter metacharacters out of the user term.
        let clean = term.replacingOccurrences(of: "*", with: "")
            .replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
        // Split into whitespace tokens; pull out a single 4-digit year (1886–2100).
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
            // Build the query with the public/status filters shared by every path,
            // then conditionally chain the year (AND) and the make/model text (OR).
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
            // Only imaged vehicles — a grid of blank car-outline placeholders reads
            // as broken (the feed already filters this way). Over-fetch, then trim.
            results = raw.filter { ($0.primary_image_url?.isEmpty == false) }
            searched = true
        } catch {
            searchError = true
            searched = true
            NSLog("NukeCapture explore search failed: %@", String(describing: error))
        }
    }
}
