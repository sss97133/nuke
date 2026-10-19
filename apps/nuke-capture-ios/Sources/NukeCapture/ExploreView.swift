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
    @State private var query: String = {
        #if DEBUG
        // Screenshot loop: NUKE_DEBUG_EXPLORE_QUERY="k5 blazer" lands on the search
        // results deterministically (same NUKE_DEBUG_* convention; DEBUG only).
        if let q = ProcessInfo.processInfo.environment["NUKE_DEBUG_EXPLORE_QUERY"], !q.isEmpty { return q }
        #endif
        return ""
    }()
    @State private var metros: [MarketMetro] = []
    @State private var results: [VehicleHeaderRow] = []
    @State private var loadingFeed = false
    @State private var feedError = false
    @State private var searchError = false   // a failed search ≠ "no matches"
    @State private var feedFailureText: String?
    @State private var searchFailureText: String?
    @State private var searched = false
    @State private var feedRetried = false   // cold-launch first call self-heals once
    // The Worklight: report the stage, never a blank spinner; a stall reads as an
    // honest failure with retry, never "nothing here".
    @State private var feedStage = "Reading the market…"
    // Landing has two lenses on the SAME market: the metro list (where) and the
    // treemap (what, by volume). Both drill into the cohort terminal.
    @State private var landingMode: LandingMode = {
        #if DEBUG
        // Screenshot loop: NUKE_DEBUG_EXPLORE_MODE=pulse roots straight on the treemap
        // (matches the NUKE_DEBUG_* deep-link pattern; DEBUG only, never ships).
        if ProcessInfo.processInfo.environment["NUKE_DEBUG_EXPLORE_MODE"] == "pulse" { return .treemap }
        if ProcessInfo.processInfo.environment["NUKE_DEBUG_EXPLORE_MODE"] == "live" { return .live }
        if ProcessInfo.processInfo.environment["NUKE_DEBUG_EXPLORE_MODE"] == "listings" { return .listings }
        if ProcessInfo.processInfo.environment["NUKE_DEBUG_EXPLORE_MODE"] == "map" { return .map }
        #endif
        // Land where the web Market tab lands: the open board, the one population with a
        // recorded clock (market_pulse_live). Map, Pulse and Listings stay one tap away.
        return .live
    }()
    enum LandingMode: Hashable { case metros, treemap, map, live, listings }

    // 3-column square grid, 2pt gutters — the SEARCH-results photo grid.
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    /// Search is active once the user types ≥2 chars: the landing (market pulse)
    /// gives way to the search-into-individuals grid + cohort.
    private var isSearching: Bool {
        let term = query.trimmingCharacters(in: .whitespaces)
        // Keep ZIP entry on the map, including intermediate digits while typing.
        // Vehicle searches still use the established result/cohort destinations.
        if landingMode == .map && !term.isEmpty && term.count <= 10 &&
            term.allSatisfy({ ($0 >= "0" && $0 <= "9") || $0 == "-" }) { return false }
        return term.count >= 2
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
            // Reclaim the title bar on the landing — the tab already says "Explore",
            // and the Map/Pulse toggle is the real header. (Restored while searching so
            // the search field keeps its chrome.)
            .toolbar(isSearching ? .visible : .hidden, for: .navigationBar)
            .searchable(text: $query, prompt: landingMode == .map ? "ZIP, or vehicle" : "Year, make, or model")
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
            .navigationDestination(for: TreemapStep.self) { step in
                // Recursive pulse: a cell → the deeper treemap, or the cars at the leaf.
                if let gb = step.groupBy, let dim = PulseDim(rawValue: gb) {
                    MarketTreemapView(filters: step.filters, fixedGroupBy: dim)
                } else {
                    FilteredVehicleGrid(filters: step.filters)
                }
            }
            .navigationDestination(for: PulseTailPage.self) { page in
                // The folded tail: a treemap of just the makes too small to draw above,
                // now with room to be legible. Drills onward like any other cell.
                MarketTreemapView(filters: page.filters,
                                  fixedGroupBy: PulseDim(rawValue: page.groupBy),
                                  injectedNodes: page.nodes,
                                  injectedTitle: page.title)
            }
            .task(id: landingMode) { if landingMode == .metros { await loadMetros() } }
            .task(id: query) {
                let term = query.trimmingCharacters(in: .whitespaces)
                guard isSearching else { results = []; searchMeta = nil; actorHits = []; searched = false; return }
                try? await Task.sleep(nanoseconds: 300_000_000)   // debounce
                guard !Task.isCancelled else { return }
                await search(term)
            }
        }
    }

    // ─── LANDING — two lenses on one market (metros / treemap), segmented toggle ─
    // The market flows EDGE-TO-EDGE; the Map/Pulse toggle FLOATS over it as glass (no
    // opaque strip). Each lens carries its own floating chrome below the toggle.
    @ViewBuilder private var marketLanding: some View {
        ZStack(alignment: .top) {
            Group {
                switch landingMode {
                case .metros:  metroList
                case .map:     MarketMapView(query: $query)
                case .treemap: MarketTreemapView()
                // The open board from market_pulse_live, the reader the web Market tab stands on.
                case .live:    LiveBoardView().padding(.top, 52)
                // Retained classified listings, the web Market tab's captured-listings read (#994).
                case .listings: CapturedListingsView().padding(.top, 52)
                }
            }
            // Two lenses on one market: the Map (geography) and the Pulse (a treemap
            // pivotable by make/model/year/metro/day). "Metros" retired — it was just
            // one grouping; it now lives inside the Pulse's Metro dimension.
            Picker("View", selection: $landingMode) {
                Text("Map").tag(LandingMode.map)
                Text("Pulse").tag(LandingMode.treemap)
                Text("Live").tag(LandingMode.live)
                Text("Listings").tag(LandingMode.listings)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 10)
            // Floating glass: one UNIFORM frosted material for the toggle + status bar so
            // it reads as chrome (not a color wash that samples the cells below), fading
            // into the live market at its lower edge.
            .background(
                Rectangle().fill(.regularMaterial)
                    .mask(LinearGradient(stops: [.init(color: .black, location: 0),
                                                 .init(color: .black, location: 0.7),
                                                 .init(color: .clear, location: 1)],
                                         startPoint: .top, endPoint: .bottom))
                    .ignoresSafeArea(edges: .top)
                    .allowsHitTesting(false)
            )
        }
    }

    // ─── The metro-list lens (the market pulse by metro) ─────────────────────────
    @ViewBuilder private var metroList: some View {
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
                Label("Couldn't load the market", systemImage: "exclamationmark.triangle")
            } description: {
                Text(feedFailureText ?? "The read failed.")
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
                Label("Couldn't search", systemImage: "exclamationmark.triangle")
            } description: {
                Text(searchFailureText ?? "The search failed.")
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
            ScrollViewReader { proxy in
                ScrollView {
                    // COHORT entry leads the results — pushes CohortTerminalView.
                    if let c = cohort {
                        NavigationLink(value: c) { cohortRow(c) }
                            .buttonStyle(.plain)
                        Divider()
                    }
                    if !actorHits.isEmpty { actorRows }
                    // The denominator before the pictures: what this page is a window onto.
                    if let m = searchMeta {
                        Text(m.sentence)
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16).padding(.vertical, 6)
                    }
                    LazyVGrid(columns: columns, spacing: 2) {
                        ForEach(results) { v in
                            NavigationLink(value: v) { cell(v) }
                                .buttonStyle(.plain)
                        }
                    }
                    // The foot of the walk, as the web's search page ends it: the door's next page
                    // when it says one exists, the refine line when the door capped the walk, and
                    // the web's own failure sentence when a page did not come (never a silent stop;
                    // the button stays as the retry).
                    if let m = searchMeta {
                        VStack(spacing: 8) {
                            if m.nextOffset != nil {
                                Button {
                                    Task { await loadMoreResults() }
                                } label: {
                                    if loadingMore { ProgressView() } else { Text("More results") }
                                }
                                .buttonStyle(.bordered)
                                .disabled(loadingMore)
                            } else if m.limited {
                                Text("Refine your search to see more results.")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            if let e = loadMoreError {
                                Text(e)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .id("more")
                    }
                }
                .onChange(of: scrollToFootTick) { _, _ in proxy.scrollTo("more", anchor: .bottom) }
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
                // sold is a real count from the view (0 is a fact, not a missing field) —
                // always render it so the stat columns line up row-to-row.
                if let s = m.sold { metroStat("sold", "\(s)") }
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
            feedFailureText = ReadFailure.text(error)
            NSLog("NukeCapture explore market pulse failed: %@", String(describing: error))
        }
    }

    // ─── Search — the web's door. universal-search owns public eligibility, the ranked
    // full-text reader, the year and ILIKE fallbacks and VIN/URL detection; the phone
    // asks it the same question the site does: 100 hits a page, hits without a photo kept
    // and sorted last (useSearchPage.ts), later pages on the door's next_offset with the
    // reader it chose on page one. The door counts no total for a text query, so none is shown.
    private func search(_ term: String) async {
        searchError = false
        do {
            let res = try await UniversalSearch.vehicles(query: term, types: UniversalSearch.firstPageTypes)
            guard res.success else { throw URLError(.badServerResponse) }
            // Actors the door matched by name lead the results: an organization opens its measures,
            // a person their profile. Vehicles follow in the grid.
            actorHits = res.results.filter { $0.type == "organization" || $0.type == "external_identity" || ($0.type == "user" && UUID(uuidString: $0.id) != nil) }
            let rows = Self.photosFirst(res.results.compactMap(\.headerRow))
            results = rows
            loadMoreError = nil
            searchMeta = SearchCoverage(query: term, rows: rows, meta: res.meta, milliseconds: res.search_time_ms)
            searched = true
            #if DEBUG
            // Screenshot loop: NUKE_DEBUG_EXPLORE_PAGES=1 walks that many more pages through the
            // door, then NUKE_DEBUG_SCROLL_TO=more lands on the foot of the walk (DEBUG only).
            if let n = Int(ProcessInfo.processInfo.environment["NUKE_DEBUG_EXPLORE_PAGES"] ?? ""), n > 0 {
                for _ in 0..<n { await loadMoreResults() }
                if ProcessInfo.processInfo.environment["NUKE_DEBUG_SCROLL_TO"] == "more" { scrollToFootTick += 1 }
            }
            #endif
        } catch {
            searchError = true
            searchFailureText = ReadFailure.text(error)
            searched = true
            NSLog("NukeCapture explore search failed: %@", String(describing: error))
        }
    }

    /// The next page from the door, appended, under the web's own guards (useSearchPage.ts
    /// handleLoadMore): the walk needs the reader page one chose, the page must answer at the
    /// offset asked and with that reader, a next offset must move forward, and a capped walk
    /// ends with no offset. A page that fails a guard is reported in the web's sentence and the
    /// button stays as the retry; a page that lands after the query moved on is dropped.
    private func loadMoreResults() async {
        guard let meta = searchMeta, let offset = meta.nextOffset, !loadingMore else { return }
        guard let reader = meta.reader else { loadMoreError = Self.pageFailure; return }
        loadingMore = true
        loadMoreError = nil
        defer { loadingMore = false }
        do {
            let res = try await UniversalSearch.vehicles(query: meta.query, offset: offset, source: reader)
            guard res.success, let m = res.meta, m.offset == offset, m.vehicle_source == reader, let more = m.has_more,
                  m.pagination_limited == true ? (more && m.next_offset == nil) : (more ? (m.next_offset ?? 0) > offset : m.next_offset == nil)
            else { throw URLError(.badServerResponse) }
            guard meta.query == searchMeta?.query else { return }
            // The web sorts photos first within each page and appends later pages in the door's order
            // (useSearchPage.ts); re-sorting the whole walk had moved page one's photo-less hits to the end.
            let page = Self.photosFirst(res.results.compactMap(\.headerRow).filter { hit in !results.contains { $0.id == hit.id } })
            results = results + page
            searchMeta = SearchCoverage(query: meta.query, rows: results, meta: m, milliseconds: res.search_time_ms)
        } catch {
            NSLog("NukeCapture explore search page failed: %@", String(describing: error))
            loadMoreError = Self.pageFailure
        }
    }
    private static let pageFailure = "More results could not be loaded. Try again."

    /// The web's order within a page: hits with a photo first, the rest after, each group in the door's order.
    private static func photosFirst(_ rows: [VehicleHeaderRow]) -> [VehicleHeaderRow] {
        rows.filter { $0.primary_image_url?.isEmpty == false } + rows.filter { $0.primary_image_url?.isEmpty != false }
    }

    /// What the grid is a window onto: how many public records the door returned so far, how
    /// many lack a photo, whether a next page exists, which reader answered. The door does not
    /// count the whole match set for a text query, so the total is stated as not counted
    /// rather than guessed (fleet-relative reporting).
    struct SearchCoverage {
        let query: String
        let returned: Int
        let withoutPhoto: Int
        /// The next page's offset, only when the door says more exist and did not cap the walk
        /// (the web's hasMore = has_more && !pagination_limited).
        let nextOffset: Int?
        let limited: Bool
        let reader: String?
        let milliseconds: Int?

        init(query: String, rows: [VehicleHeaderRow], meta: UniversalSearchMeta?, milliseconds: Int?) {
            self.query = query
            returned = rows.count
            withoutPhoto = rows.filter { $0.primary_image_url?.isEmpty != false }.count
            limited = meta?.pagination_limited == true
            nextOffset = (meta?.has_more == true && !limited) ? meta?.next_offset : nil
            reader = meta?.vehicle_source
            self.milliseconds = milliseconds
        }

        var sentence: String {
            var parts: [String] = ["\(returned) public records" + (withoutPhoto > 0 ? " · \(withoutPhoto) without a photo, shown last" : "")]
            if nextOffset != nil { parts.append("more pages · total not counted") }
            else if limited { parts.append("walk capped by the door · total not counted") }
            else { parts.append("end of results") }
            if let r = reader { parts.append("reader \(r)") }
            if let ms = milliseconds { parts.append("door \(ms) ms") }
            return parts.joined(separator: " · ")
        }
    }
    @State private var searchMeta: SearchCoverage?
    @State private var actorHits: [UniversalSearchHit] = []

    /// Organizations and people the door matched by name, each a door to its endpoint.
    @ViewBuilder private var actorRows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(actorHits) { hit in
                Group {
                    if let route = hit.actorRoute {
                        NavigationLink { ActorProfileView(route: route) } label: { actorRow(hit, icon: route.kind == "identity" ? "person.crop.circle" : "building.2") }
                    } else {
                        NavigationLink { ProfileView(userId: hit.id.lowercased(), isOwn: false) } label: { actorRow(hit, icon: "person") }
                    }
                }
                .buttonStyle(.plain)
                Divider().padding(.leading, 52)
            }
        }
    }
    private func actorRow(_ hit: UniversalSearchHit, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.title3).foregroundStyle(.secondary).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(hit.title ?? "Unnamed").font(.subheadline.weight(.semibold))
                if let sub = hit.subtitle, !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .contentShape(Rectangle())
    }
    @State private var loadingMore = false
    @State private var loadMoreError: String?
    @State private var scrollToFootTick = 0
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
                        Label("Couldn't load", systemImage: "exclamationmark.triangle")
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
