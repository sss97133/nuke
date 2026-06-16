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
                } else if rows.isEmpty {
                    ContentUnavailableView(
                        searched ? "No matches" : "Nothing to show",
                        systemImage: searched ? "magnifyingglass" : "binoculars",
                        description: Text(searched
                            ? "Try a make, model, or year."
                            : "Pull to refresh the feed.")
                    )
                } else {
                    ScrollView {
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

    // ─── Search — existing behaviour, unchanged shape; results land in the grid.
    private func search(_ term: String) async {
        // Sanitize PostgREST filter metacharacters out of the user term.
        let t = term.replacingOccurrences(of: "*", with: "")
            .replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
        var filter = "make.ilike.*\(t)*,model.ilike.*\(t)*"
        if let yr = Int(t), yr > 1885, yr < 2100 { filter += ",year.eq.\(yr)" }
        searchError = false
        do {
            let raw: [VehicleHeaderRow] = try await SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,trim,primary_image_url")
                .eq("is_public", value: true)
                .or(filter)
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
