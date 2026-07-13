// MarketMapView — the market as GEOGRAPHY, honestly.
//
// A county CHOROPLETH, not a blob of circles. Each US county is filled light→rich
// by how many listings sit there (county_density_all, summed over mv_make_geographic
// _density). County boundaries are the bundled census polygons (us-counties.geojson,
// FIPS-keyed); the fill is the only thing the query drives. Nothing is placed at a
// position we don't actually know — a county aggregate asserts "N here", never a
// fake pin. (The precision ladder — 353K GPS cars become real footprints on deep
// zoom — is the next layer up from this honest base.)
//
// Grammar per the design canon: Apple-stock MapKit, structure over decoration. The
// datum is AREA × fill-density; a quantile ramp keeps the long tail from washing out.

import SwiftUI
import MapKit

/// One county's listing count (county_density_all). name/state may be null for a
/// FIPS with density but no boundary-table row.
struct CountyCount: Decodable {
    let fips: String
    let name: String?
    let state_fips: String?
    let count: Int
}

/// get_make_heatmap(p_make) → per-county density for ONE make. This is what answers
/// "where are the most Broncos" — the same choropleth, filtered to a make.
struct MakeHeatmap: Decodable { let counties: [HeatCounty] }
struct HeatCounty: Decodable { let fips: String; let county_name: String?; let count: Int }

struct MarketMapView: View {
    @State private var counts: [String: Int] = [:]
    @State private var names: [String: String] = [:]
    @State private var breaks: [Int] = []
    @State private var loading = true
    @State private var failed = false
    @State private var selected: (fips: String, name: String, count: Int)?
    @State private var make: String? = nil        // nil = all listings; else "where are the most <make>"
    @State private var showMakePicker = false

    var body: some View {
        ZStack(alignment: .top) {
            CountyChoropleth(counts: counts, breaks: breaks) { fips in
                guard let c = counts[fips] else { selected = nil; return }
                selected = (fips, names[fips] ?? "County", c)
            }
            .ignoresSafeArea(edges: .bottom)

            // The make filter — "where are the most ___". Data drives the fill.
            HStack {
                Button { showMakePicker = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "car.2.fill").font(.caption2)
                        Text(make ?? "All makes").font(.system(.subheadline).weight(.semibold))
                        Image(systemName: "chevron.down").font(.caption2)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(.ultraThinMaterial, in: Capsule())
                    .overlay(Capsule().stroke(Color(uiColor: .separator).opacity(0.4), lineWidth: 0.5))
                }
                .tint(.primary)
                if make != nil {
                    Button { make = nil } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }
            // Clear the floating Map/Pulse toggle riding above (ExploreView).
            .padding(.horizontal, 12).padding(.top, 52)

            if loading {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Reading the market…")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(.top, 52)
            } else if failed {
                ContentUnavailableView {
                    Label("Couldn't load map", systemImage: "map")
                } actions: {
                    Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
                }
                .background(.ultraThinMaterial)
            }
        }
        .safeAreaInset(edge: .bottom) { footer }
        .sheet(isPresented: $showMakePicker) { MakePickerSheet(selected: $make) }
        .task(id: make ?? "·") { await load() }
    }

    // Selected-county readout, else the legend. The color scale IS the legend.
    @ViewBuilder private var footer: some View {
        Group {
            if let s = selected {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(s.name).font(.system(.subheadline).weight(.semibold))
                        Text("\(s.count.formatted()) listing\(s.count == 1 ? "" : "s")")
                            .font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("FIPS \(s.fips)").font(.system(.caption2, design: .monospaced)).foregroundStyle(.tertiary)
                }
            } else {
                HStack(spacing: 8) {
                    Text("fewer").font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                    LinearGradient(colors: rampSwatch, startPoint: .leading, endPoint: .trailing)
                        .frame(height: 8).clipShape(Capsule())
                    Text("more").font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                    Spacer()
                    Text(make.map { "\($0) by county" } ?? "listings by county")
                        .font(.system(.caption2, design: .monospaced)).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }

    private var rampSwatch: [Color] {
        stride(from: 0.0, through: 1.0, by: 0.2).map { Color(rampUIColor(t: $0)) }
    }

    private func load() async {
        loading = true; failed = false; selected = nil
        do {
            var c = [String: Int](); var n = [String: String]()
            if let mk = make {
                let hm: MakeHeatmap = try await SupabaseService.client
                    .rpc("get_make_heatmap", params: ["p_make": mk]).execute().value
                for r in hm.counties { c[r.fips] = r.count; if let nm = r.county_name { n[r.fips] = nm } }
            } else {
                let rows: [CountyCount] = try await SupabaseService.client
                    .rpc("county_density_all").execute().value
                for r in rows { c[r.fips] = r.count; if let nm = r.name { n[r.fips] = nm } }
            }
            counts = c; names = n
            breaks = quantileBreaks(Array(c.values), bins: 7)
            loading = false
        } catch {
            failed = true; loading = false
        }
    }
}

// ─── Color ramp: pale warm → deep rich, alpha climbing with density ──────────────
private func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * max(0, min(1, t)) }

/// t in 0…1 → the fill color. Pale amber (sparse) to deep red (dense); alpha rises
/// so empty counties read as bare map, hot ones as solid blocks.
func rampUIColor(t: Double) -> UIColor {
    UIColor(red: lerp(0.99, 0.60, t), green: lerp(0.86, 0.08, t),
            blue: lerp(0.42, 0.11, t), alpha: lerp(0.32, 0.88, t))
}

/// Quantile breaks so a few giant counties don't flatten everyone else into one bin.
func quantileBreaks(_ values: [Int], bins: Int) -> [Int] {
    let s = values.filter { $0 > 0 }.sorted()
    guard s.count >= bins else { return s }
    return (1..<bins).map { s[Int(Double($0) / Double(bins) * Double(s.count))] }
}

// ─── The MKMapView choropleth ────────────────────────────────────────────────────
struct CountyChoropleth: UIViewRepresentable {
    let counts: [String: Int]
    let breaks: [Int]
    let onTap: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.mapType = .mutedStandard
        map.pointOfInterestFilter = .excludingAll
        map.showsCompass = false
        map.region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 39.5, longitude: -98.35),
            span: MKCoordinateSpan(latitudeDelta: 34, longitudeDelta: 44))
        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.handleTap(_:)))
        map.addGestureRecognizer(tap)
        context.coordinator.attach(map)   // parse + add overlays off-main
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.applyCountsIfReady(map)
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: CountyChoropleth
        private var overlays: [MKOverlay] = []
        private var appliedToken = -1
        init(_ parent: CountyChoropleth) { self.parent = parent }

        // Parse the bundled polygons once, off the main thread, then add them.
        func attach(_ map: MKMapView) {
            DispatchQueue.global(qos: .userInitiated).async { [weak self, weak map] in
                let parsed = Self.parseOverlays()
                DispatchQueue.main.async {
                    guard let self, let map else { return }
                    self.overlays = parsed
                    map.addOverlays(parsed)
                    self.applyCountsIfReady(map)
                }
            }
        }

        // When the counts arrive after the overlays, re-render with the real fills.
        func applyCountsIfReady(_ map: MKMapView) {
            guard !overlays.isEmpty, !parent.counts.isEmpty else { return }
            let token = parent.counts.count &+ parent.breaks.reduce(0, &+)
            guard token != appliedToken else { return }
            appliedToken = token
            for o in overlays where map.renderer(for: o) != nil {
                recolor(map.renderer(for: o)!, o)
            }
        }

        private func recolor(_ renderer: MKOverlayRenderer, _ overlay: MKOverlay) {
            let fips = (overlay as? MKShape)?.title ?? ""
            let color = parent.counts[fips].map { rampUIColor(t: self.tForCount($0)) } ?? .clear
            if let r = renderer as? MKPolygonRenderer { r.fillColor = color; r.setNeedsDisplay() }
            else if let r = renderer as? MKMultiPolygonRenderer { r.fillColor = color; r.setNeedsDisplay() }
        }

        private func tForCount(_ count: Int) -> Double {
            guard count > 0 else { return 0 }
            let b = parent.breaks
            guard !b.isEmpty else { return 1 }
            var bin = 0; for br in b where count > br { bin += 1 }
            return Double(bin) / Double(b.count)
        }

        // MKMapViewDelegate — color each county on first render from current counts.
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            let fips = (overlay as? MKShape)?.title ?? ""
            let color = parent.counts[fips].map { rampUIColor(t: self.tForCount($0)) } ?? .clear
            let stroke = UIColor.separator.withAlphaComponent(0.18)
            if let mp = overlay as? MKMultiPolygon {
                let r = MKMultiPolygonRenderer(multiPolygon: mp)
                r.fillColor = color; r.strokeColor = stroke; r.lineWidth = 0.25
                return r
            }
            let r = MKPolygonRenderer(polygon: overlay as! MKPolygon)
            r.fillColor = color; r.strokeColor = stroke; r.lineWidth = 0.25
            return r
        }

        // Tap → the county containing the point (bbox pre-filter, then path hit-test).
        @objc func handleTap(_ gr: UITapGestureRecognizer) {
            guard let map = gr.view as? MKMapView else { return }
            let mapPoint = MKMapPoint(map.convert(gr.location(in: map), toCoordinateFrom: map))
            for o in overlays where o.boundingMapRect.contains(mapPoint) {
                if let poly = o as? MKPolygon, Self.contains(poly, mapPoint) {
                    parent.onTap(poly.title ?? ""); return
                }
                if let mpoly = o as? MKMultiPolygon {
                    for poly in mpoly.polygons where Self.contains(poly, mapPoint) {
                        parent.onTap(mpoly.title ?? ""); return
                    }
                }
            }
        }

        private static func contains(_ poly: MKPolygon, _ mp: MKMapPoint) -> Bool {
            let r = MKPolygonRenderer(polygon: poly)
            return r.path?.contains(r.point(for: mp)) ?? false
        }

        private static func parseOverlays() -> [MKOverlay] {
            guard let url = Bundle.main.url(forResource: "us-counties", withExtension: "geojson"),
                  let data = try? Data(contentsOf: url),
                  let objs = try? MKGeoJSONDecoder().decode(data) else { return [] }
            var out: [MKOverlay] = []
            for case let f as MKGeoJSONFeature in objs {
                let fips = f.identifier ?? Self.fipsFromProps(f.properties)
                for g in f.geometry {
                    if let p = g as? MKPolygon { p.title = fips; out.append(p) }
                    else if let mp = g as? MKMultiPolygon { mp.title = fips; out.append(mp) }
                }
            }
            return out
        }

        private static func fipsFromProps(_ data: Data?) -> String {
            guard let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let f = obj["fips"] as? String else { return "" }
            return f
        }
    }
}

// ─── Make picker — "where are the most ___" ──────────────────────────────────────
// The pivot value. Makes come from treemap_by_brand (real inventory counts), so the
// list is ordered by how much is actually out there — no hardcoded registry.
struct MakePickerSheet: View {
    @Binding var selected: String?
    @Environment(\.dismiss) private var dismiss
    @State private var makes: [TreemapNode] = []
    @State private var query = ""

    private var filtered: [TreemapNode] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? makes : makes.filter { $0.name.lowercased().contains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                Button {
                    selected = nil; dismiss()
                } label: {
                    HStack {
                        Text("All makes").fontWeight(.semibold)
                        Spacer()
                        if selected == nil { Image(systemName: "checkmark").foregroundStyle(.tint) }
                    }
                }
                ForEach(filtered) { m in
                    Button {
                        selected = m.name; dismiss()
                    } label: {
                        HStack {
                            Text(m.name).foregroundStyle(.primary)
                            Spacer()
                            Text(m.count.formatted())
                                .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                            if selected == m.name { Image(systemName: "checkmark").foregroundStyle(.tint) }
                        }
                    }
                }
            }
            .searchable(text: $query, prompt: "Make")
            .navigationTitle("Where are the most…")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                if makes.isEmpty {
                    let rows: [TreemapNode] = (try? await SupabaseService.client
                        .rpc("treemap_by_brand").execute().value) ?? []
                    makes = rows.sorted { $0.count > $1.count }
                }
            }
        }
    }
}
