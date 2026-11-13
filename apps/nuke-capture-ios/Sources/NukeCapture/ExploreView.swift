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
    @State private var searchRequests = ReadRequestGuard()
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
        if ProcessInfo.processInfo.environment["NUKE_DEBUG_EXPLORE_MODE"] == "feed" { return .feed }
        if ProcessInfo.processInfo.environment["NUKE_DEBUG_EXPLORE_MODE"] == "listings" { return .listings }
        if ProcessInfo.processInfo.environment["NUKE_DEBUG_EXPLORE_MODE"] == "map" { return .map }
        if ProcessInfo.processInfo.environment["NUKE_DEBUG_EXPLORE_MODE"] == "map" { return .map }
        #endif
        // Land where the web Market tab lands: the open board, the one population with a
        // recorded clock (market_pulse_live). Map, Pulse and Listings stay one tap away.
        // Land on the passive picture feed (live lots + new classifieds); the lenses
        // stay one tap away in the toggle.
        return .feed
    }()
    enum LandingMode: Hashable { case metros, treemap, map, live, listings, feed }

    // Two big photos across, 12pt gutters — the SEARCH-results grid. Photos lead; names sit beneath.
    private let columns = [GridItem(.flexible(), spacing: NukeSpace.md), GridItem(.flexible(), spacing: NukeSpace.md)]

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

    /// Detects whether a query looks like a vehicle search (make, model, body style, year)
    /// rather than a person/organization name. Used to hide actor results when searching
    /// for vehicles — "Mustang" wants cars, not BaT usernames like "MustangEd69".
    private static func looksLikeVehicleQuery(_ query: String) -> Bool {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return false }

        // Year patterns: 4-digit year or 'XX (decade shorthand)
        if q.range(of: #"^(19|20)\d{2}$"#, options: .regularExpression) != nil { return true }
        if q.range(of: #"'\d{2}"#, options: .regularExpression) != nil { return true }

        // Common makes (case-insensitive)
        let makes: Set<String> = [
            "ford", "chevy", "chevrolet", "dodge", "chrysler", "plymouth", "pontiac", "buick",
            "oldsmobile", "olds", "cadillac", "lincoln", "mercury", "gmc", "jeep", "amc",
            "porsche", "ferrari", "lamborghini", "maserati", "alfa", "fiat", "lancia",
            "bmw", "mercedes", "benz", "audi", "volkswagen", "vw", "volvo", "saab",
            "jaguar", "aston", "bentley", "rolls", "lotus", "triumph", "mg", "austin", "rover",
            "toyota", "honda", "nissan", "datsun", "mazda", "subaru", "mitsubishi", "lexus", "acura",
            "tesla", "rivian", "lucid", "hyundai", "kia", "genesis"
        ]

        // Iconic models that double as names or common words
        let models: Set<String> = [
            "mustang", "camaro", "corvette", "firebird", "challenger", "charger", "cuda", "barracuda",
            "impala", "chevelle", "nova", "malibu", "el camino", "monte carlo", "c10", "k5",
            "bronco", "f100", "f150", "f250", "f350", "ranger", "raptor", "lightning", "thunderbird",
            "911", "356", "944", "928", "cayenne", "boxster", "cayman", "panamera", "taycan",
            "gtr", "gt40", "gt350", "gt500", "boss", "shelby", "cobra", "mach 1", "bullitt",
            "supra", "nsx", "rx7", "skyline", "miata", "mx5", "240z", "280z", "300zx", "370z",
            "m3", "m5", "m6", "e30", "e36", "e46", "e92", "f80", "s2000", "type r", "sti", "wrx",
            "gallardo", "huracan", "aventador", "countach", "diablo", "murcielago",
            "f40", "f50", "enzo", "laferrari", "testarossa", "308", "328", "458", "488", "812",
            "ghibli", "quattroporte", "mc12", "granturismo",
            "db5", "db9", "vantage", "vanquish", "dbs",
            "continental", "phantom", "ghost", "wraith", "cullinan",
            "elise", "exige", "evora", "esprit",
            "tr6", "spitfire", "herald", "gt6",
            "model s", "model 3", "model x", "model y", "roadster", "cybertruck",
            "wrangler", "cj5", "cj7", "willys", "scrambler", "gladiator", "cherokee", "grand cherokee"
        ]

        // Body styles and vehicle terms
        let vehicleTerms: Set<String> = [
            "coupe", "sedan", "convertible", "roadster", "wagon", "hatchback", "fastback",
            "pickup", "truck", "suv", "crossover", "van", "minivan", "bus",
            "hardtop", "softtop", "targa", "spyder", "spider", "cabriolet", "drophead",
            "4x4", "4wd", "awd", "rwd", "fwd",
            "v8", "v6", "v10", "v12", "inline", "flat", "boxer", "turbo", "supercharged",
            "manual", "stick", "auto", "automatic", "cvt", "dct", "pdk",
            "restomod", "resto", "patina", "barn find", "survivor", "numbers matching",
            "classic", "vintage", "antique", "muscle", "pony", "sports car", "supercar", "hypercar"
        ]

        // Check for any matching token
        let tokens = q.split(whereSeparator: { $0.isWhitespace || $0 == "-" }).map(String.init)
        for token in tokens {
            if makes.contains(token) { return true }
            if models.contains(token) { return true }
            if vehicleTerms.contains(token) { return true }
        }

        // Also check multi-word matches
        if models.contains(q) { return true }
        if vehicleTerms.contains(q) { return true }

        // Numeric model names (911, 944, 356, etc.)
        if let num = Int(q), num >= 100 && num < 1000 { return true }

        return false
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
            // The search field lives in the navigation bar, so the bar stays visible:
            // hiding it on the landing hid search entirely.
            // Reclaim the title bar on the landing — the tab already says "Explore",
            // and the Map/Pulse toggle is the real header. (Restored while searching so
            // the search field keeps its chrome.)
            // The navigation bar stays visible: .searchable lives in it, so hiding it on the
            // landing hid the ONLY search field (the Map's "search a ZIP" prompt and vehicle
            // search were unreachable until something else set the query).
            .searchable(text: $query, prompt: landingMode == .map ? "ZIP code or car" : "Search cars: year, make or model")
            .navigationDestination(for: VehicleHeaderRow.self) { v in
                // PUSH (back chevron) — kills the Done-only dead-end.
                VehicleDetailView(vehicleId: v.id.uuidString.lowercased(),
                                  embedInNavigationStack: false).environment(\.vehicleListingContext, true)
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
                let request = beginSearch()
                guard isSearching else { return }
                try? await Task.sleep(nanoseconds: 300_000_000)   // debounce
                guard !Task.isCancelled, searchRequests.isCurrent(request) else { return }
                await search(term, request: request)
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
                case .feed:    ExploreFeedView().padding(.top, 52)
                case .live:    LiveBoardView().padding(.top, 52)
                // Retained classified listings, the web Market tab's captured-listings read (#994).
                case .listings: CapturedListingsView().padding(.top, 52)
                }
            }
            // Two lenses on one market: the Map (geography) and the Pulse (a treemap
            // pivotable by make/model/year/metro/day). "Metros" retired — it was just
            // one grouping; it now lives inside the Pulse's Metro dimension.
            Picker("View", selection: $landingMode) {
                Text("Browse").tag(LandingMode.feed)
                Text("Map").tag(LandingMode.map)
                Text("Trends").tag(LandingMode.treemap)
                Text("Auctions").tag(LandingMode.live)
                Text("For sale").tag(LandingMode.listings)
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
            NukeFeedSkeleton(message: "Checking what's for sale near you…", cards: 2)
        } else if feedError && metros.isEmpty {
            NukeEmptyState(icon: "wifi.exclamationmark", title: "We couldn't load the market",
                           message: "Check your connection, then try again.",
                           actionTitle: "Try again") { Task { await loadMetros(force: true) } }
        } else if metros.isEmpty {
            NukeEmptyState(icon: "binoculars", title: "No market data yet",
                           message: "Pull down to refresh.")
        } else {
            List {
                Section {
                    ForEach(metros) { m in
                        NavigationLink(value: m) { metroRow(m) }
                    }
                } header: {
                    Text("Where cars are selling")
                } footer: {
                    Text("Tap a city to see which makes are for sale there.")
                }
            }
            .refreshable { await loadMetros(force: true) }
        }
    }

    // ─── SEARCH — individuals + the cohort row (unchanged behavior) ─────────────
    @ViewBuilder private var searchResults: some View {
        if searched && searchError && results.isEmpty {
            NukeEmptyState(icon: "wifi.exclamationmark", title: "We couldn't search",
                           message: "Check your connection, then try again.",
                           actionTitle: "Try again") {
                Task { await search(query.trimmingCharacters(in: .whitespaces)) }
            }
        } else if !searched && results.isEmpty && cohort == nil {
            // Debounce in flight — a labeled stage, never a premature "No matches".
            NukeTileGridSkeleton(message: "Looking for cars…")
        } else if results.isEmpty && actorHits.isEmpty && cohort == nil {
            NukeEmptyState(icon: "magnifyingglass", title: "No matches",
                           message: "Try a different make, model or year.")
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    // COHORT entry leads the results — pushes CohortTerminalView.
                    if let c = cohort {
                        NavigationLink(value: c) { cohortRow(c) }
                            .buttonStyle(.plain)
                            .padding(.horizontal, NukeSpace.lg).padding(.top, NukeSpace.sm)
                    }
                    if !actorHits.isEmpty { actorRows }
                    // The denominator before the pictures: what this page is a window onto.
                    if let m = searchMeta {
                        Text(m.plainSentence)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, NukeSpace.lg).padding(.vertical, NukeSpace.sm)
                    }
                    LazyVGrid(columns: columns, spacing: NukeSpace.lg) {
                        ForEach(results) { v in
                            NavigationLink(value: v) { cell(v) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, NukeSpace.lg)
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
                                    if loadingMore { ProgressView() } else { Text("Show more cars") }
                                }
                                .buttonStyle(NukeSecondaryButtonStyle())
                                .disabled(loadingMore)
                            } else if m.limited {
                                Text("Narrow your search to see more cars.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            if let e = loadMoreError {
                                Text(e)
                                    .font(.footnote)
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
                Text(NukeDisplay.count(m.total_listings, "listing"))
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 14) {
                if let p = m.avg_price { metroStat("average price", "$\(p.formatted())") }
                if let t = m.turnover_pct {
                    metroStat("sell through", "\(t.formatted(.number.precision(.fractionLength(1))))%")
                }
                metroStat("for sale now", "\(m.active)")
                // sold is a real count from the view (0 is a fact, not a missing field) —
                // always render it so the stat columns line up row-to-row.
                if let s = m.sold { metroStat("sold", "\(s)") }
                if let y = m.avg_year { metroStat("average year", "\(y)") }
            }
        }
        .padding(.vertical, 3)
    }

    @ViewBuilder private func metroStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(.subheadline, design: .rounded).weight(.semibold)).monospacedDigit().foregroundStyle(.primary)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }

    // ─── The COHORT row — a big, obvious door to how this model is selling.
    @ViewBuilder private func cohortRow(_ c: CohortTarget) -> some View {
        HStack(spacing: NukeSpace.md) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 40, height: 40)
                .background(Color.accentColor.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(c.label)
                    .font(.nukeCardTitle)
                    .foregroundStyle(.primary)
                Text("See how this model is selling")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(NukeSpace.lg)
        .frame(minHeight: NukeSize.minTap)
        .nukeSurface()
        .contentShape(Rectangle())
    }

    // ─── One vehicle tile — a big photo with the car's name beneath, never a void.
    @ViewBuilder private func cell(_ v: VehicleHeaderRow) -> some View {
        NukeVehicleTile(imageURL: NukeImage.thumb(v.primary_image_url, width: 600),
                        name: NukeDisplay.vehicleName(year: v.year, make: v.make, model: v.model),
                        detail: NukeDisplay.joined([v.city, v.state], separator: ", "))
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
    private func beginSearch() -> UUID {
        let request = searchRequests.begin()
        results = []
        actorHits = []
        searchMeta = nil
        searched = false
        searchError = false
        searchFailureText = nil
        loadMoreError = nil
        loadingMore = false
        return request
    }

    private func search(_ term: String, request: UUID? = nil) async {
        guard isSearching, query.trimmingCharacters(in: .whitespaces) == term else { return }
        let request = request ?? beginSearch()
        do {
            let res = try await UniversalSearch.vehicles(query: term, types: UniversalSearch.firstPageTypes)
            guard res.success else { throw URLError(.badServerResponse) }
            guard !Task.isCancelled, searchRequests.isCurrent(request), query.trimmingCharacters(in: .whitespaces) == term else { return }
            // Actors only when the query doesn't look like a vehicle (make/model/year).
            // When someone searches "Mustang" or "911" they want cars, not BaT usernames like "MustangEd69".
            // Include actors only for queries that look like names (space-separated words without numbers
            // that don't match common vehicle terms).
            let vehicleRows = res.results.compactMap(\.headerRow)
            let looksLikeVehicle = !vehicleRows.isEmpty || Self.looksLikeVehicleQuery(term)
            actorHits = looksLikeVehicle ? [] : res.results.filter { $0.type == "organization" || $0.type == "external_identity" || ($0.type == "user" && UUID(uuidString: $0.id) != nil) }
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
            guard !Task.isCancelled, searchRequests.isCurrent(request), query.trimmingCharacters(in: .whitespaces) == term else { return }
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
        guard let request = searchRequests.current, query.trimmingCharacters(in: .whitespaces) == meta.query else { return }
        guard let reader = meta.reader else { loadMoreError = Self.pageFailure; return }
        loadingMore = true
        loadMoreError = nil
        defer { if searchRequests.isCurrent(request) { loadingMore = false } }
        do {
            let res = try await UniversalSearch.vehicles(query: meta.query, offset: offset, source: reader)
            guard res.success, let m = res.meta, m.offset == offset, m.vehicle_source == reader, let more = m.has_more,
                  m.pagination_limited == true ? (more && m.next_offset == nil) : (more ? (m.next_offset ?? 0) > offset : m.next_offset == nil)
            else { throw URLError(.badServerResponse) }
            guard !Task.isCancelled, searchRequests.isCurrent(request), meta.query == searchMeta?.query,
                  query.trimmingCharacters(in: .whitespaces) == meta.query else { return }
            // The web sorts photos first within each page and appends later pages in the door's order
            // (useSearchPage.ts); re-sorting the whole walk had moved page one's photo-less hits to the end.
            let page = Self.photosFirst(res.results.compactMap(\.headerRow).filter { hit in !results.contains { $0.id == hit.id } })
            results = results + page
            searchMeta = SearchCoverage(query: meta.query, rows: results, meta: m, milliseconds: res.search_time_ms)
        } catch {
            guard !Task.isCancelled, searchRequests.isCurrent(request), query.trimmingCharacters(in: .whitespaces) == meta.query else { return }
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

        /// What a person needs to know about this page, in plain words. The engineering detail
        /// (reader, door timing, paging internals) stays in `sentence`, for logs and tests.
        var plainSentence: String {
            var line = NukeDisplay.count(returned, "car")
            if withoutPhoto > 0 { line += " · \(withoutPhoto) without a photo, shown last" }
            return line
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
                    stat("for sale now", "\(metro.active)")
                    if let p = metro.avg_price { stat("average price", "$\(p.formatted())") }
                    if let t = metro.turnover_pct {
                        stat("sell through", "\(t.formatted(.number.precision(.fractionLength(1))))%")
                    }
                }
            } footer: {
                Text("Cars listed for sale in \(metro.metro). The makes below are counted separately, so they may not add up to the total.")
            }

            if loading {
                Section {
                    VStack(alignment: .leading, spacing: NukeSpace.sm) {
                        NukeSkeletonBlock(height: 16)
                        NukeSkeletonBlock(height: 16).frame(maxWidth: 220)
                        NukeSkeletonBlock(height: 16).frame(maxWidth: 160)
                    }
                    .accessibilityLabel("Loading makes")
                }
            } else if loadError {
                Section {
                    HStack {
                        Label("Couldn't load the makes", systemImage: "wifi.exclamationmark")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Spacer()
                        Button("Try again") { Task { await load() } }
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: NukeSize.minTap)
                    }
                }
            } else if makes.isEmpty {
                Section {
                    Text("No makes to show for this city yet.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            } else {
                Section("Makes for sale here") {
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
                Text(mk.make).font(.system(.body, design: .rounded).weight(.semibold)).foregroundStyle(.primary)
                Spacer(minLength: 0)
                Text(NukeDisplay.count(mk.total_listings, "listing"))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            HStack(spacing: 14) {
                stat("for sale", "\(mk.active_count)")
                if let s = mk.sold_count, s > 0 { stat("sold", "\(s)") }
                if let ap = mk.avg_active_price { stat("avg asking", "$\(Int(ap).formatted())") }
                if let sp = mk.avg_sold_price { stat("avg sold", "$\(Int(sp).formatted())") }
                if let h = mk.avg_hours_on_market { stat("hours listed", "\(Int(h))") }
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(.subheadline, design: .rounded).weight(.semibold)).monospacedDigit().foregroundStyle(.primary)
            Text(label).font(.caption2).foregroundStyle(.secondary)
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
