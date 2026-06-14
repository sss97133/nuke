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
    @State private var searching = false
    @State private var searched = false

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
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if rows.isEmpty {
                    // Honest empty state only when there is genuinely nothing.
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
                AsyncImage(url: renderThumb(v.primary_image_url, width: 200)) { img in
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

    // ─── Render-endpoint thumbnail. Handles nested capture-relay paths AND
    // external CDN urls (the render endpoint can't transcode those — use as-is).
    private func renderThumb(_ raw: String?, width: Int) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if let r = raw.range(of: "/vehicle-photos/") {
            let path = String(raw[r.upperBound...])
            return URL(string: "\(Config.supabaseURL)/render/image/public/vehicle-photos/\(path)?width=\(width)&resize=contain")
        }
        return URL(string: raw) // external CDN image: render endpoint can't transcode it, use as-is
    }

    // ─── Feed — public vehicles, newest first. Filter to photo-bearing rows in
    // Swift (avoids a fragile not-null PostgREST filter); show ~60.
    private func loadFeed() async {
        guard feed.isEmpty else { return }
        loadingFeed = true
        defer { loadingFeed = false }
        do {
            let raw: [VehicleHeaderRow] = try await SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,trim,primary_image_url")
                .eq("is_public", value: true)
                .neq("status", value: "pending")
                .order("created_at", ascending: false)
                .limit(80)
                .execute()
                .value
            feed = raw
                .filter { ($0.primary_image_url?.isEmpty == false) }
                .prefix(60)
                .map { $0 }
        } catch {
            NSLog("NukeCapture explore feed failed: %@", String(describing: error))
        }
    }

    // ─── Search — existing behaviour, unchanged shape; results land in the grid.
    private func search(_ term: String) async {
        searching = true
        defer { searching = false }
        // Sanitize PostgREST filter metacharacters out of the user term.
        let t = term.replacingOccurrences(of: "*", with: "")
            .replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
        var filter = "make.ilike.*\(t)*,model.ilike.*\(t)*"
        if let yr = Int(t), yr > 1885, yr < 2100 { filter += ",year.eq.\(yr)" }
        do {
            results = try await SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,trim,primary_image_url")
                .eq("is_public", value: true)
                .or(filter)
                .order("year", ascending: false)
                .limit(30)
                .execute()
                .value
            searched = true
        } catch {
            NSLog("NukeCapture explore search failed: %@", String(describing: error))
            searched = true
        }
    }
}
