// ExploreView.swift — search the world's vehicles (Build-2 §5: explore real
// DB data; §3: query → drillable rows). The §5 return that replaces the cut
// Map: not a directory of strangers, a way to FIND a real record and drill in.
//
// Backend is a DIRECT vehicles query via the anon client (sub-100ms), NOT the
// universal-search edge function (measured 24s — unusable for typing). Rows
// drill into VehicleDetailView (a sheet, its own NavigationStack). Reuses
// VehicleHeaderRow from VehicleDetailView.swift — no parallel model.

import SwiftUI

struct ExploreView: View {
    @State private var query = ""
    @State private var results: [VehicleHeaderRow] = []
    @State private var selected: VehicleHeaderRow?
    @State private var loading = false
    @State private var searched = false

    var body: some View {
        NavigationStack {
            Group {
                if loading && results.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if results.isEmpty {
                    // No empty shells — a prompt before searching, an honest
                    // "nothing" after.
                    ContentUnavailableView(
                        searched ? "No matches" : "Find a vehicle",
                        systemImage: searched ? "magnifyingglass" : "binoculars",
                        description: Text(searched
                            ? "Try a make, model, or year."
                            : "Search the record — 18,000+ vehicles.")
                    )
                } else {
                    List(results) { v in
                        Button { selected = v } label: { row(v) }
                            .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Explore")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Year, make, or model")
            .task(id: query) {
                let term = query.trimmingCharacters(in: .whitespaces)
                guard term.count >= 2 else { results = []; searched = false; return }
                try? await Task.sleep(nanoseconds: 300_000_000)   // debounce
                guard !Task.isCancelled else { return }
                await search(term)
            }
            .sheet(item: $selected) { v in
                VehicleDetailView(vehicleId: v.id.uuidString.lowercased())
            }
        }
    }

    @ViewBuilder private func row(_ v: VehicleHeaderRow) -> some View {
        HStack(spacing: 12) {
            // Thumb via the render endpoint (contain — never crop portrait
            // shots), small width; falls back to a flat plate, never a void.
            let thumb = v.primary_image_url.flatMap(thumbURL)
            Color(.secondarySystemFill)
                .frame(width: 54, height: 54)
                .overlay {
                    AsyncImage(url: thumb) { img in
                        img.resizable().scaledToFill()
                    } placeholder: {
                        Image(systemName: "car.side").foregroundStyle(.secondary)
                    }
                }
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 2) {
                Text(v.title.isEmpty ? "VEHICLE" : v.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    /// Small render-endpoint thumbnail (24KB vs multi-MB originals; contain so
    /// portrait iPhone shots aren't mangled).
    private func thumbURL(_ raw: String) -> URL? {
        guard let path = raw.split(separator: "/").last else { return URL(string: raw) }
        let rendered = "\(Config.supabaseURL)/render/image/public/vehicle-photos/\(path)?width=108&resize=contain"
        return URL(string: rendered) ?? URL(string: raw)
    }

    private func search(_ term: String) async {
        loading = true
        defer { loading = false }
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
