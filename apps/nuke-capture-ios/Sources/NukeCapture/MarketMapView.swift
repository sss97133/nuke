// The map is a spatial and temporal query lens. ZIP polygons lead the visual;
// counties partition indexed reads behind the canvas. Historical location
// evidence is not a claim of present inventory, seller residence or a sale.

import SwiftUI
import MapKit
import Charts

struct CountySelection: Identifiable {
    let fips: String
    var id: String { fips }
}

struct MarketMapView: View {
    @Binding var query: String
    var body: some View { CountyZIPDrill(query: $query) }
}

// County-tagged public observations are a different grain from the map snapshot.
// Fold a bounded set on-device, preserving absent/conflicting source ZIPs.
struct CountyLocationRow: Decodable, Identifiable {
    let id: UUID
    let observed_at: String?
    let source_platform: String?
    let source_url: String?
    let postal_code: String?
    let city: String?
    let precision: String?
    let confidence: Double?
    let vehicles: VehicleHeaderRow

    // Parse once during decoding, rather than repeatedly during sorting/panning.
    let observedDate: Date?
    enum CodingKeys: String, CodingKey {
        case id, observed_at, source_platform, source_url, postal_code, city, precision, confidence, vehicles
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        observed_at = try c.decodeIfPresent(String.self, forKey: .observed_at)
        source_platform = try c.decodeIfPresent(String.self, forKey: .source_platform)
        source_url = try c.decodeIfPresent(String.self, forKey: .source_url)
        postal_code = try c.decodeIfPresent(String.self, forKey: .postal_code)
        city = try c.decodeIfPresent(String.self, forKey: .city)
        precision = try c.decodeIfPresent(String.self, forKey: .precision)
        confidence = try c.decodeIfPresent(Double.self, forKey: .confidence)
        vehicles = try c.decode(VehicleHeaderRow.self, forKey: .vehicles)
        observedDate = observed_at.flatMap { Self.fractionalDate.date(from: $0) ?? Self.plainDate.date(from: $0) }
    }
    private static let fractionalDate: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let plainDate = ISO8601DateFormatter()

    static func zip(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 1 || (parts.count == 2 && parts[1].count == 4),
              parts[0].count == 5,
              parts.allSatisfy({ $0.allSatisfy { $0 >= "0" && $0 <= "9" } }) else { return nil }
        return String(parts[0])
    }
}

struct CountyVehicleEvidence: Identifiable {
    let vehicle: VehicleHeaderRow
    let observations: [CountyLocationRow]
    var id: UUID { vehicle.id }
}

struct CountyZIPGroup: Identifiable {
    let id: String
    let label: String
    let isZIP: Bool
    let vehicles: [CountyVehicleEvidence]
}

struct MapObservationWindow: Hashable {
    let start: Date?
    let end: Date? // Exclusive; a date-only selection includes the entire last day.
    static let all = Self(start: nil, end: nil)
    var label: String {
        guard let start, let end else { return "All time" }
        let lastDay = end.addingTimeInterval(-1)
        return "\(start.formatted(date: .abbreviated, time: .omitted)) – \(lastDay.formatted(date: .abbreviated, time: .omitted))"
    }
    func includes(_ row: CountyLocationRow) -> Bool {
        if start == nil && end == nil { return true }
        guard let date = row.observedDate else { return false }
        return start.map { date >= $0 } != false && end.map { date < $0 } != false
    }
}

enum GeographicScale: String {
    case state = "State", county = "County", zip = "ZIP", street = "Street / address"
    case building = "Building", parking = "Parking space"
    var needsPreciseEvidence: Bool { self == .street || self == .building || self == .parking }
    static func forSpan(_ longitude: Double) -> Self {
        if longitude > 14 { return .state }
        if longitude > 2 { return .county }
        if longitude > 0.015 { return .zip }
        if longitude > 0.001 { return .street }
        if longitude > 0.0002 { return .building }
        return .parking
    }
}

struct CountyEvidenceSummary {
    let groups: [CountyZIPGroup]
    let vehicleCount: Int
    let zipVehicleCount: Int

    static let zipCounties: [String: String] = {
        // Same public crosswalk already used by the map subsystem. It names one
        // county per ZIP; it is not a ZIP polygon or an exact boundary assertion.
        guard let url = Bundle.main.url(forResource: "zip2fips", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let mapping = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return mapping
    }()

    init(rows: [CountyLocationRow], fips: String, make: String?, crosswalk: [String: String]) {
        var buckets: [String: [CountyLocationRow]] = [:]
        var allVehicles = Set<UUID>(); var zipVehicles = Set<UUID>()
        for row in rows {
            if let make, row.vehicles.make?.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(make) != .orderedSame { continue }
            allVehicles.insert(row.vehicles.id)
            let key: String
            if let zip = CountyLocationRow.zip(row.postal_code), let county = crosswalk[zip] {
                if county == fips { key = zip; zipVehicles.insert(row.vehicles.id) }
                else { key = "conflict" }
            } else if row.postal_code?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
                key = "missing"
            } else { key = "unresolved" }
            buckets[key, default: []].append(row)
        }
        vehicleCount = allVehicles.count; zipVehicleCount = zipVehicles.count
        groups = buckets.map { key, observations in
            let byVehicle = Dictionary(grouping: observations, by: { $0.vehicles.id })
            let vehicles = byVehicle.values.map { evidence -> CountyVehicleEvidence in
                let sorted = evidence.sorted {
                    let a = $0.observedDate ?? .distantPast; let b = $1.observedDate ?? .distantPast
                    return a == b ? $0.id.uuidString < $1.id.uuidString : a > b
                }
                return CountyVehicleEvidence(vehicle: sorted[0].vehicles, observations: sorted)
            }.sorted {
                let a = $0.observations[0].observedDate ?? .distantPast
                let b = $1.observations[0].observedDate ?? .distantPast
                return a == b ? $0.id.uuidString < $1.id.uuidString : a > b
            }
            let label = key == "conflict" ? "ZIP / county conflict"
                : key == "missing" ? "No source ZIP"
                : key == "unresolved" ? "ZIP county unresolved" : "ZIP \(key)"
            return CountyZIPGroup(id: key, label: label, isZIP: key.count == 5, vehicles: vehicles)
        }.sorted {
            if $0.isZIP != $1.isZIP { return $0.isZIP }
            if $0.vehicles.count != $1.vehicles.count { return $0.vehicles.count > $1.vehicles.count }
            return $0.id < $1.id
        }
    }
}

struct CountyEvidenceBatch {
    let rows: [CountyLocationRow]
    let cursor: String?
    let complete: Bool

    // A transport page is not a dataset limit. The caller publishes successful
    // pages, retaining its cursor across failures, and continues until EMPTY.
    static func read(after cursor: String?,
                     fetch: (String?, Int) async throws -> [CountyLocationRow]) async throws -> Self {
        try Task.checkCancellation()
        let page = try await fetch(cursor, 1_000)
        try Task.checkCancellation()
        guard let last = page.last else { return Self(rows: [], cursor: cursor, complete: true) }
        let next = last.id.uuidString.lowercased()
        guard cursor == nil || next > cursor! else { throw URLError(.cannotParseResponse) }
        return Self(rows: page, cursor: next, complete: false)
    }

    static func readAll(after cursor: String?,
                        fetch: (String?, Int) async throws -> [CountyLocationRow],
                        publish: @MainActor (Self) async throws -> Void) async throws {
        var next = cursor
        while true {
            let page = try await read(after: next, fetch: fetch)
            try Task.checkCancellation()
            try await publish(page)
            if page.complete { return }
            next = page.cursor
        }
    }
}

private enum ZIPLocationReader {
    // Nonisolated network/decode work; only page publication returns to the UI.
    static func fetch(fips: String, after: String?, size: Int) async throws -> [CountyLocationRow] {
        var request = SupabaseService.client.from("vehicle_location_observations")
            .select("id,observed_at,source_platform,source_url,postal_code,city,precision,confidence,vehicles!inner(id,year,make,model,trim,primary_image_url,city,state)")
            .eq("county_fips", value: fips).gte("confidence", value: 0.5)
            .is("vehicles.deleted_at", value: nil)
            .or("status.is.null,status.not.in.(deleted,merged,rejected,duplicate)", referencedTable: "vehicles")
        if let after { request = request.gt("id", value: after) }
        return try await request.order("id", ascending: true).limit(size).execute().value
    }
}

final class ZIPAreaLabel: NSObject, MKAnnotation {
    let zip: String
    let coordinate: CLLocationCoordinate2D
    init(zip: String, coordinate: CLLocationCoordinate2D) { self.zip = zip; self.coordinate = coordinate }
}

struct CountyZIPGeometry {
    let outline: [MKOverlay]
    let rings: [[[Double]]]
    let bounds: MKMapRect

    static func county(_ fips: String) throws -> Self {
        guard let url = Bundle.main.url(forResource: "us-counties", withExtension: "geojson") else { throw URLError(.fileDoesNotExist) }
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        guard let feature = (object?["features"] as? [[String: Any]])?.first(where: {
            ($0["id"] as? String) == fips || ($0["properties"] as? [String: Any])?["fips"] as? String == fips
        }), let geometry = feature["geometry"] as? [String: Any] else { throw URLError(.cannotParseResponse) }
        let polygons: [[[[Double]]]]
        if geometry["type"] as? String == "Polygon", let coordinates = geometry["coordinates"] as? [[[Double]]] {
            polygons = [coordinates]
        } else if let coordinates = geometry["coordinates"] as? [[[[Double]]]] { polygons = coordinates }
        else { throw URLError(.cannotParseResponse) }
        let rings = polygons.flatMap { polygon in polygon.enumerated().map { index, ring in
            // ESRI outer rings clockwise, holes counterclockwise.
            let signedArea = zip(ring, ring.dropFirst()).reduce(0.0) { $0 + $1.0[0] * $1.1[1] - $1.1[0] * $1.0[1] }
            return (signedArea > 0) == (index == 0) ? Array(ring.reversed()) : ring
        } }
        let decoded = try MKGeoJSONDecoder().decode(JSONSerialization.data(withJSONObject: feature))
        let outline = decoded.compactMap { $0 as? MKGeoJSONFeature }.flatMap(\.geometry).compactMap { $0 as? MKOverlay }
        for shape in outline { (shape as? MKShape)?.title = "county:\(fips)" }
        let bounds = outline.reduce(MKMapRect.null) { $0.union($1.boundingMapRect) }
        guard !bounds.isNull else { throw URLError(.cannotParseResponse) }
        return Self(outline: outline, rings: rings, bounds: bounds)
    }

    func areas() async throws -> (overlays: [MKOverlay], labels: [ZIPAreaLabel]) {
        let geometry = try JSONSerialization.data(withJSONObject: ["rings": rings, "spatialReference": ["wkid": 4326]], options: .sortedKeys)
        var overlays: [MKOverlay] = []; var labels: [ZIPAreaLabel] = []; var seen = Set<String>()
        // Fixed 2020 vintage, bounded to the actual county polygon; no national download.
        var offset = 0
        while true {
            try Task.checkCancellation()
            var url = URLComponents(string: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/84/query")!
            let params = ["where": "1=1", "geometry": String(decoding: geometry, as: UTF8.self),
                          "geometryType": "esriGeometryPolygon", "inSR": "4326", "outSR": "4326",
                          "spatialRel": "esriSpatialRelIntersects", "outFields": "GEOID,INTPTLAT,INTPTLON",
                          "f": "geojson", "maxAllowableOffset": "0.0005", "geometryPrecision": "5",
                          "resultRecordCount": "500", "resultOffset": String(offset), "orderByFields": "GEOID"]
            url.queryItems = params.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
            var request = URLRequest(url: url.url!, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 20)
            // Large coastal county rings can exceed normal URL limits. Query POST
            // reads the same immutable geography; it carries no user location.
            if request.url!.absoluteString.count > 7000 {
                request.url = URL(string: url.string!.components(separatedBy: "?")[0])!
                request.httpMethod = "POST"; request.httpBody = url.percentEncodedQuery?.data(using: .utf8)
                request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            }
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let features = json["features"] as? [[String: Any]] else { throw URLError(.badServerResponse) }
            if features.isEmpty { return (overlays, labels) }
            let decoded = try await Task.detached(priority: .userInitiated) { try MKGeoJSONDecoder().decode(data) }.value
            for case let feature as MKGeoJSONFeature in decoded {
                guard let properties = feature.properties,
                      let props = try JSONSerialization.jsonObject(with: properties) as? [String: Any],
                      let code = props["GEOID"] as? String, CountyLocationRow.zip(code) == code,
                      seen.insert(code).inserted else { throw URLError(.cannotParseResponse) }
                let shapes = feature.geometry.compactMap { $0 as? MKOverlay }
                guard !shapes.isEmpty, shapes.allSatisfy({ $0 is MKPolygon || $0 is MKMultiPolygon }) else {
                    throw URLError(.cannotParseResponse)
                }
                for shape in shapes {
                    (shape as? MKShape)?.title = code; overlays.append(shape)
                }
                if let rawLat = props["INTPTLAT"] as? String, let lat = Double(rawLat),
                   let rawLon = props["INTPTLON"] as? String, let lon = Double(rawLon),
                   CLLocationCoordinate2DIsValid(CLLocationCoordinate2D(latitude: lat, longitude: lon)) {
                    labels.append(ZIPAreaLabel(zip: code, coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon)))
                }
            }
            offset += features.count
        }
    }
}

// Completed region reads are reused during this map session. Never cache a partial
// read as complete; a failed later page retains its last successful cursor.
actor ZIPMapReadCache {
    static let shared = ZIPMapReadCache()
    private var rows: [String: (Date, [CountyLocationRow])] = [:]
    private var geometry: [String: (CountyZIPGeometry, [MKOverlay], [ZIPAreaLabel])] = [:]
    func getGeometry(_ fips: String) -> (CountyZIPGeometry, [MKOverlay], [ZIPAreaLabel])? { geometry[fips] }
    func putGeometry(_ fips: String, _ boundary: CountyZIPGeometry, _ areas: [MKOverlay], _ labels: [ZIPAreaLabel]) {
        if geometry.count >= 8, let key = geometry.keys.sorted().first { geometry.removeValue(forKey: key) }
        geometry[fips] = (boundary, areas, labels)
    }
    func get(_ fips: String) -> [CountyLocationRow]? {
        guard let entry = rows[fips], Date().timeIntervalSince(entry.0) < 600 else { return nil }
        return entry.1
    }
    func put(_ fips: String, _ value: [CountyLocationRow]) {
        if rows.count >= 8, let oldest = rows.min(by: { $0.value.0 < $1.value.0 })?.key { rows.removeValue(forKey: oldest) }
        rows[fips] = (Date(), value)
    }
}

struct CountyZIPDrill: View {
    @State private var county: CountySelection?
    @State private var observations: [CountyLocationRow] = []
    @State private var cursor: String?
    @State private var complete = false
    @State private var loading = false
    @State private var failed = false
    @Binding var query: String
    @State private var searchIssue: String?
    @State private var areas: [MKOverlay] = []
    @State private var areaLabels: [ZIPAreaLabel] = []
    @State private var geometryLoading = false
    @State private var geometryFailed = false
    @State private var selectedZIP: String?
    @State private var showInfo = false
    @State private var showGaps = false
    @State private var showDates = false
    @State private var showReport = false
    @State private var showMakePicker = false
    @State private var make: String?
    @State private var period = MapObservationWindow.all
    @State private var scale = GeographicScale.state
    @State private var summary = CountyEvidenceSummary(rows: [], fips: "", make: nil, crosswalk: [:])
    @State private var counts: [String: Int] = [:]
    @State private var breaks: [Int] = []
    @State private var latest: Date?
    @State private var earliest: Date?
    @State private var focus: MKMapRect?
    @State private var requestedZIP: String?
    @State private var projectionBusy = false
    @State private var availableMakes: [ZIPActivityFold.Count] = []

    init(query: Binding<String>) {
        _query = query
        #if DEBUG
        if let fips = ProcessInfo.processInfo.environment["NUKE_DEBUG_COUNTY"] {
            _county = State(initialValue: CountySelection(fips: fips))
        }
        #endif
    }

    var body: some View {
        let selectedGroup = summary.groups.first { $0.id == selectedZIP }
        ZStack(alignment: .topLeading) {
            CountyChoropleth(counts: scale.needsPreciseEvidence ? [:] : counts, breaks: breaks,
                             geometry: areas, focus: focus, highlighted: selectedZIP,
                             areaLabels: scale.needsPreciseEvidence ? [] : areaLabels,
                             drawsAreas: !scale.needsPreciseEvidence,
                             onScaleChange: { if scale != $0 { scale = $0 } },
                             onCountyFocus: { fips in selectCounty(fips) }) { selectedZIP = $0 }
                .ignoresSafeArea(edges: .bottom)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Button { showMakePicker = true } label: {
                        Label(make ?? "All makes", systemImage: "line.3.horizontal.decrease")
                    }
                    Button { showDates = true } label: {
                        Label(period == .all ? "All time" : "Date range", systemImage: "calendar")
                    }
                    Button { showInfo = true } label: { Image(systemName: "info.circle") }
                        .accessibilityLabel("Map sources and coverage")
                }
                .font(.subheadline.weight(.medium))
                if county == nil {
                    Text("Zoom into an area or search a ZIP").font(.caption).foregroundStyle(.secondary)
                } else if loading || geometryLoading || projectionBusy {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.mini)
                        Text(loading ? "\(observations.count.formatted()) records · loading all matching records"
                             : geometryLoading ? "Loading ZIP boundaries" : "Updating date window")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Text("\(summary.zipVehicleCount.formatted()) vehicles with ZIP evidence · historical")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if period != .all { Text(period.label).font(.caption2).foregroundStyle(.secondary) }
                if let searchIssue { Text(searchIssue).font(.caption).foregroundStyle(.secondary) }
            }
            .padding(10).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 12).padding(.top, 52)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(alignment: .leading, spacing: 8) {
                if scale.needsPreciseEvidence {
                    Text("\(scale.rawValue) · current presence unknown").font(.caption).foregroundStyle(.secondary)
                }
                if let zip = selectedZIP {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("ZIP \(zip)").font(.headline)
                            Text(selectedGroup.map { "\($0.vehicles.count.formatted()) vehicles · explore sources and vehicle mix" }
                                 ?? (complete ? "No matching location evidence" : "Reading this area's evidence"))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if selectedGroup != nil {
                            Button("Area activity") { showReport = true }
                                .buttonStyle(.bordered).accessibilityLabel("Explore ZIP \(zip) activity")
                        }
                        Button { selectedZIP = nil } label: { Image(systemName: "xmark.circle.fill") }
                            .tint(.secondary).accessibilityLabel("Clear ZIP selection")
                    }
                } else if county != nil {
                    HStack {
                        Text("Tap a ZIP to explore its activity").font(.subheadline)
                        Spacer()
                        Button("Coverage") { showGaps = true }.font(.caption)
                    }
                }
                if failed || geometryFailed {
                    HStack {
                        Text(geometryFailed ? "ZIP boundaries couldn't load." : "Record loading stopped; your map is retained.")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry") { Task {
                            guard let county else { return }
                            if geometryFailed { await loadGeometry(county) }
                            if failed { await loadAll(county) }
                        } }.disabled(loading || geometryLoading)
                    }
                }
            }
            .padding(.horizontal, 14).padding(.vertical, county == nil ? 0 : 10)
            .background(.ultraThinMaterial)
        }
        .onSubmit(of: .search) { searchZIP() }
        .onChange(of: query) { _, value in
            if CountyLocationRow.zip(value) != nil { searchZIP() }
        }
        .sheet(isPresented: $showMakePicker) { MakePickerSheet(selected: $make, makes: availableMakes) }
        .sheet(isPresented: $showDates) { MapDateWindowPicker(window: $period, earliest: earliest, latest: latest) }
        .sheet(isPresented: $showReport) {
            if let group = selectedGroup {
                NavigationStack { ZIPActivityView(group: group, window: period, complete: complete) }
            }
        }
        .sheet(isPresented: $showInfo) {
            NavigationStack {
                List {
                    Text("\(observations.count.formatted()) location observations read; \(summary.vehicleCount.formatted()) distinct vehicles in the selected date and make cohort. \(complete ? "All matching pages were read." : "The read is still incomplete.")")
                    if let latest { Text("Latest recorded location: \(latest.formatted(date: .abbreviated, time: .omitted)).") }
                    Text("Color shows distinct vehicles with source ZIP evidence, not completed sales, current availability or the number of bids. The date window uses the location observation's recorded clock; records without that clock remain available in All time.")
                Text("County keys partition the indexed database reads as you move around the map. The active partition is \(county?.fips ?? "not selected"). This is not a national census of every vehicle.")
                Text("Completed region reads are reused for up to 10 minutes during this map session. Source observation dates, rather than the cache age, describe when the location was recorded.")
                    Text("ZIP areas are Census 2020 ZIP Code Tabulation Areas. Some postal ZIPs have no area, and ZIPs can cross county boundaries. County conflicts and missing source ZIPs remain available under Coverage.")
                    Text("Street, building and parking-space scales require precise, dated presence evidence. Historical ZIP observations cannot answer whether a car is still there.")
                    Link("Census ZIP area definitions", destination: URL(string: "https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html")!)
                }
                .navigationTitle("Sources and coverage").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showInfo = false } } }
            }
        }
        .sheet(isPresented: $showGaps) {
            NavigationStack {
                List {
                    Text("These vehicles have missing, conflicting or unmapped source ZIP evidence. Groups may overlap.")
                        .font(.footnote).foregroundStyle(.secondary)
                    ForEach(summary.groups.filter { group in
                        !group.isZIP || (!geometryLoading && !geometryFailed && !areas.contains { ($0 as? MKShape)?.title == group.id })
                    }) { group in
                        NavigationLink { CountyZIPVehicles(group: group) } label: {
                            LabeledContent(group.label, value: "\(group.vehicles.count.formatted()) vehicles")
                        }
                    }
                }
                .navigationTitle("Location coverage").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showGaps = false } } }
            }
        }
        .task(id: county?.fips) {
            guard let county else { return }
            loading = false; geometryLoading = false
            observations = []; cursor = nil; complete = false; failed = false
            selectedZIP = nil; latest = nil; earliest = nil
            async let records: Void = loadAll(county)
            async let boundaries: Void = loadGeometry(county)
            _ = await (records, boundaries)
            #if DEBUG
            if ProcessInfo.processInfo.environment["NUKE_DEBUG_MAP_REPORT"] == "1" {
                await project()
                if selectedZIP != nil { showReport = true }
            }
            #endif
        }
        .task(id: ProjectionKey(fips: county?.fips, count: observations.count, make: make, window: period)) {
            await project()
        }
    }

    private struct ProjectionKey: Hashable {
        let fips: String?; let count: Int; let make: String?; let window: MapObservationWindow
    }

    private func selectCounty(_ fips: String) {
        guard county?.fips != fips else { return }
        county = CountySelection(fips: fips)
    }

    private func searchZIP() {
        guard let zip = CountyLocationRow.zip(query) else { searchIssue = nil; return }
        guard let fips = CountyEvidenceSummary.zipCounties[zip] else {
            searchIssue = "No geographic crosswalk recorded for ZIP \(zip)"; return
        }
        searchIssue = nil
        requestedZIP = zip
        if county?.fips == fips, areas.contains(where: { ($0 as? MKShape)?.title == zip }) { selectedZIP = zip; requestedZIP = nil }
        else { selectCounty(fips) }
    }

    private func project() async {
        let rows = observations; let fips = county?.fips ?? ""; let selectedMake = make; let window = period
        projectionBusy = true
        let task = Task.detached(priority: .userInitiated) {
            let start = Date()
            let filtered = rows.filter { window.includes($0) }
            let result = CountyEvidenceSummary(rows: filtered, fips: fips,
                                               make: selectedMake, crosswalk: CountyEvidenceSummary.zipCounties)
            let makes = ZIPActivityFold.makeCounts(filtered)
            NSLog("NukeCapture ZIP fold: %d records, %.3f seconds", rows.count, Date().timeIntervalSince(start))
            return (result, makes)
        }
        let result = await withTaskCancellationHandler(operation: { await task.value }, onCancel: { task.cancel() })
        guard !Task.isCancelled else { return }
        summary = result.0; availableMakes = result.1
        counts = Dictionary(uniqueKeysWithValues: result.0.groups.filter(\.isZIP).map { ($0.id, $0.vehicles.count) })
        breaks = quantileBreaks(Array(counts.values), bins: 7)
        projectionBusy = false
    }

    private func loadGeometry(_ county: CountySelection) async {
        geometryLoading = true; geometryFailed = false
        defer { if self.county?.fips == county.fips { geometryLoading = false } }
        do {
            let fips = county.fips
            let cached = await ZIPMapReadCache.shared.getGeometry(fips)
            let boundary: CountyZIPGeometry
            if let cached { boundary = cached.0 }
            else { boundary = try await Task.detached(priority: .userInitiated) { try CountyZIPGeometry.county(fips) }.value }
            try Task.checkCancellation()
            #if DEBUG
            if focus == nil, ProcessInfo.processInfo.environment["NUKE_DEBUG_COUNTY"] == fips { focus = boundary.bounds }
            #endif
            let result: (overlays: [MKOverlay], labels: [ZIPAreaLabel])
            if let cached { result = (cached.1, cached.2) }
            else {
                result = try await boundary.areas()
                await ZIPMapReadCache.shared.putGeometry(fips, boundary, result.overlays, result.labels)
            }
            try Task.checkCancellation()
            guard self.county?.fips == fips else { return }
            areas = result.overlays; areaLabels = result.labels
            if let zip = requestedZIP, areas.contains(where: { ($0 as? MKShape)?.title == zip }) { selectedZIP = zip; requestedZIP = nil }
            #if DEBUG
            if let zip = ProcessInfo.processInfo.environment["NUKE_DEBUG_ZIP"],
               areas.contains(where: { ($0 as? MKShape)?.title == zip }) { selectedZIP = zip }
            #endif
            NSLog("NukeCapture county %@: %d ZIP area shapes loaded", fips, areas.count)
        } catch {
            guard !Task.isCancelled, self.county?.fips == county.fips else { return }
            geometryFailed = true
        }
    }

    private func loadAll(_ county: CountySelection) async {
        guard !loading, !complete else { return }
        loading = true; failed = false
        defer { if self.county?.fips == county.fips { loading = false } }
        if cursor == nil, let cached = await ZIPMapReadCache.shared.get(county.fips) {
            guard !Task.isCancelled, self.county?.fips == county.fips else { return }
            observations = cached; complete = true
            latest = cached.compactMap(\.observedDate).max(); earliest = cached.compactMap(\.observedDate).min()
            return
        }
        do {
            let start = Date()
            // Publish each successful transport page and continue automatically
            // until an empty page. Interaction never waits for the complete read.
            try await CountyEvidenceBatch.readAll(after: cursor, fetch: { after, size in
                try await ZIPLocationReader.fetch(fips: county.fips, after: after, size: size)
            }, publish: { batch in
                try Task.checkCancellation()
                guard self.county?.fips == county.fips else { throw CancellationError() }
                observations.append(contentsOf: batch.rows); cursor = batch.cursor; complete = batch.complete
                let dates = batch.rows.compactMap(\.observedDate)
                if let date = dates.max(), latest == nil || date > latest! { latest = date }
                if let date = dates.min(), earliest == nil || date < earliest! { earliest = date }
                NSLog("NukeCapture county %@: %d observations, complete=%d, read=%.3f seconds", county.fips,
                      observations.count, complete ? 1 : 0, Date().timeIntervalSince(start))
            })
            await ZIPMapReadCache.shared.put(county.fips, observations)
        } catch {
            guard !Task.isCancelled, self.county?.fips == county.fips else { return }
            failed = true
        }
    }
}

struct MapDateWindowPicker: View {
    @Binding var window: MapObservationWindow
    let earliest: Date?
    let latest: Date?
    @Environment(\.dismiss) private var dismiss
    @State private var start = Date()
    @State private var end = Date()
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button("All time") { window = .all; dismiss() }
                    DatePicker("From", selection: $start, displayedComponents: .date)
                    DatePicker("Through", selection: $end, in: start..., displayedComponents: .date)
                    Button("Apply date range") {
                        let calendar = Calendar.current
                        window = MapObservationWindow(start: calendar.startOfDay(for: start),
                                                      end: calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: max(start, end))))
                        dismiss()
                    }.disabled(end < start)
                } header: { Text("Any time interval") }
                if let earliest, let latest {
                    Section("Recorded location dates") {
                        Text("\(earliest.formatted(date: .abbreviated, time: .omitted)) – \(latest.formatted(date: .abbreviated, time: .omitted))")
                        Text("The map filters recorded location observations. These are not sale or bid timestamps.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Time window").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                start = Calendar.current.startOfDay(for: window.start ?? earliest ?? Date())
                end = Calendar.current.startOfDay(for: window.end?.addingTimeInterval(-1) ?? latest ?? Date())
            }
            .onChange(of: start) { _, value in if end < value { end = value } }
        }
    }
}

// Listing identity is the source episode, not the vehicle. A vehicle can have
// several auctions in different places. Attribute only an exact source URL join.
struct ZIPListingRow: Decodable, Identifiable {
    let id: UUID
    let vehicle_id: UUID
    let bat_listing_url: String?
    let seller_username: String?
    let seller_external_identity_id: UUID?

    static func sourceKey(_ raw: String?) -> String? {
        guard let raw, let url = URL(string: raw),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host?.lowercased(), ["bringatrailer.com", "www.bringatrailer.com"].contains(host),
              url.path.hasPrefix("/listing/") else { return nil }
        return "bringatrailer.com/" + url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}

struct ZIPBusinessRow: Decodable, Identifiable {
    let id: UUID
    let vehicle_id: UUID
    let relationship_type: String?
    let organizations: Business?
    struct Business: Decodable, Identifiable {
        let id: UUID
        let business_name: String?
        let business_type: String?
        let city: String?
        let state: String?
        let zip_code: String?
        let source_url: String?
    }
    static func publicBusinesses(_ rows: [Self], zip: String) -> [Business] {
        let platformIDs = Set(rows.filter { $0.relationship_type == "auction_platform" }.compactMap { $0.organizations?.id })
        let candidates = rows.compactMap(\.organizations).filter {
            !platformIDs.contains($0.id) && !["auction_platform", "marketplace", "platform"].contains($0.business_type?.lowercased() ?? "")
        }
        return Dictionary(grouping: candidates, by: \.id).values.compactMap(\.first).sorted {
            let a = CountyLocationRow.zip($0.zip_code) == zip; let b = CountyLocationRow.zip($1.zip_code) == zip
            return a != b ? a : ($0.business_name ?? "") < ($1.business_name ?? "")
        }
    }
}

struct ZIPActivityFold {
    struct Count: Identifiable {
        let id: String
        let label: String
        let count: Int
    }
    struct Seller: Identifiable {
        let id: String
        let name: String
        let listings: [ZIPListingRow]
    }
    let makes: [Count]
    let sources: [Count]
    let sellers: [Seller]
    let linkedVehicleCount: Int
    let listingCount: Int
    let ambiguousSellerCount: Int

    static func makeCounts(_ rows: [CountyLocationRow]) -> [Count] {
        var vehicles: [String: Set<UUID>] = [:]; var names: [String: String] = [:]
        for row in rows {
            guard let make = row.vehicles.make?.trimmingCharacters(in: .whitespacesAndNewlines), !make.isEmpty else { continue }
            let key = make.lowercased()
            vehicles[key, default: []].insert(row.vehicles.id)
            if names[key] == nil { names[key] = make }
        }
        return vehicles.map { Count(id: $0.key, label: names[$0.key]!, count: $0.value.count) }
            .sorted { $0.count == $1.count ? $0.id < $1.id : $0.count > $1.count }
    }

    init(group: CountyZIPGroup, listings: [ZIPListingRow]) {
        var makeVehicles: [String: Set<UUID>] = [:]
        var sourceVehicles: [String: Set<UUID>] = [:]
        var sourceKeys: [UUID: Set<String>] = [:]
        for vehicle in group.vehicles {
            let make = vehicle.vehicle.make?.trimmingCharacters(in: .whitespacesAndNewlines)
            makeVehicles[make?.isEmpty == false ? make! : "Make unrecorded", default: []].insert(vehicle.id)
            for row in vehicle.observations {
                let source = row.source_platform?.trimmingCharacters(in: .whitespacesAndNewlines)
                let label = source?.isEmpty == false ? source! : URL(string: row.source_url ?? "")?.host ?? "Source unrecorded"
                sourceVehicles[label, default: []].insert(vehicle.id)
                if let key = ZIPListingRow.sourceKey(row.source_url) { sourceKeys[vehicle.id, default: []].insert(key) }
            }
        }
        func counts(_ values: [String: Set<UUID>]) -> [Count] {
            values.map { Count(id: $0.key, label: $0.key, count: $0.value.count) }.sorted {
                $0.count == $1.count ? $0.id < $1.id : $0.count > $1.count
            }
        }
        makes = counts(makeVehicles); sources = counts(sourceVehicles)
        let matched = listings.filter { row in
            guard let key = ZIPListingRow.sourceKey(row.bat_listing_url) else { return false }
            return sourceKeys[row.vehicle_id]?.contains(key) == true
        }
        linkedVehicleCount = Set(matched.map(\.vehicle_id)).count
        let episodes = Dictionary(grouping: matched, by: { ZIPListingRow.sourceKey($0.bat_listing_url)! })
        listingCount = episodes.count
        var identitiesByHandle: [String: Set<UUID>] = [:]
        for row in matched {
            if let handle = row.seller_username?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
               !handle.isEmpty, let identity = row.seller_external_identity_id {
                identitiesByHandle[handle, default: []].insert(identity)
            }
        }
        var bySeller: [String: [ZIPListingRow]] = [:]
        var names: [String: String] = [:]; var ambiguous = 0
        for rows in episodes.values {
            let handles = Set(rows.compactMap { $0.seller_username?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }.map { $0.lowercased() })
            let identities = Set(rows.compactMap(\.seller_external_identity_id))
            guard handles.count == 1, identities.count <= 1, Set(rows.map(\.vehicle_id)).count == 1,
                  let handle = handles.first else { ambiguous += 1; continue }
            let knownIdentities = identitiesByHandle[handle] ?? []
            guard !identities.isEmpty || knownIdentities.count <= 1 else { ambiguous += 1; continue }
            let identity = identities.first ?? knownIdentities.first
            let sellerKey = identity.map { "bat:\($0.uuidString.lowercased())" } ?? "bat:\(handle)"
            // Stable representative of the episode; conflicting outcomes are not
            // silently upgraded into a completed sale or a revenue measurement.
            let row = rows.sorted { $0.id.uuidString < $1.id.uuidString }[0]
            bySeller[sellerKey, default: []].append(row)
            names[sellerKey] = rows.compactMap(\.seller_username).sorted().first ?? handle
        }
        ambiguousSellerCount = ambiguous
        sellers = bySeller.map { Seller(id: $0.key, name: names[$0.key]!, listings: $0.value.sorted { $0.id.uuidString < $1.id.uuidString }) }
            .sorted { $0.listings.count == $1.listings.count ? $0.id < $1.id : $0.listings.count > $1.listings.count }
    }
}

struct ZIPActivityView: View {
    let group: CountyZIPGroup
    let window: MapObservationWindow
    let complete: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var fold: ZIPActivityFold?
    @State private var listings: [ZIPListingRow] = []
    @State private var businesses: [ZIPBusinessRow] = []
    @State private var loading = true
    @State private var failed = false
    #if DEBUG
    @State private var debugVehicleId: UUID?
    #endif

    var body: some View {
        List {
            Section {
                Text("\(group.vehicles.count.formatted()) vehicles with source location evidence")
                    .font(.headline)
                Text(window.label).font(.subheadline).foregroundStyle(.secondary)
                if !complete { Text("The area is still loading; these counts are provisional.").font(.caption).foregroundStyle(.secondary) }
            }
            if let fold {
                Section("Bring a Trailer sellers") {
                    if fold.sellers.isEmpty {
                        Text(loading ? "Reading seller relationships…" : "No source-matched sellers recorded for this cohort.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(fold.sellers) { seller in
                        DisclosureGroup {
                            ForEach(seller.listings) { listing in
                                if let evidence = group.vehicles.first(where: { $0.id == listing.vehicle_id }) {
                                    NavigationLink {
                                        VehicleDetailView(vehicleId: evidence.id.uuidString.lowercased(), embedInNavigationStack: false,
                                                          mapContext: MapVehicleContext(group: group, evidence: evidence, seller: seller.name))
                                    } label: { Text(evidence.vehicle.title.isEmpty ? "Vehicle record" : evidence.vehicle.title) }
                                }
                            }
                        } label: {
                            LabeledContent(seller.name, value: "\(seller.listings.count) source listings")
                        }
                    }
                    Text("Source-matched BaT records for \(fold.linkedVehicleCount) of \(group.vehicles.count) vehicles. Ranked by represented listings.")
                        .font(.caption).foregroundStyle(.secondary)
                    if fold.ambiguousSellerCount > 0 {
                        Text("\(fold.ambiguousSellerCount) source episodes have missing or conflicting seller identity.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section("Vehicle mix") {
                    Chart(Array(fold.makes.prefix(10))) { item in
                        BarMark(x: .value("Vehicles", item.count), y: .value("Make", item.label))
                    }
                    .frame(height: CGFloat(min(fold.makes.count, 10)) * 28 + 24)
                    ForEach(fold.makes) { item in
                        LabeledContent(item.label, value: "\(item.count.formatted()) vehicles")
                    }
                }
                Section("Data sources") {
                    ForEach(fold.sources) { item in
                        LabeledContent(item.label, value: "\(item.count.formatted()) vehicles")
                    }
                    Text("A vehicle can have evidence from several sources.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("Linked businesses") {
                let visible = publicBusinessLinks
                if visible.isEmpty {
                    Text(loading ? "Reading business relationships…" : "No public businesses are linked to these vehicles.")
                        .foregroundStyle(.secondary)
                }
                ForEach(visible) { business in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(business.business_name ?? "Public business").font(.subheadline.weight(.semibold))
                        if let type = business.business_type { Text(type.replacingOccurrences(of: "_", with: " ")).font(.caption) }
                        Text(CountyLocationRow.zip(business.zip_code) == group.id ? "Recorded address in this ZIP"
                             : business.zip_code == nil ? "Business ZIP unrecorded" : "Business address is in another ZIP")
                            .font(.caption).foregroundStyle(.secondary)
                        Text("\(Set(businesses.filter { $0.organizations?.id == business.id }.map(\.vehicle_id)).count) linked vehicles in this cohort")
                            .font(.caption).foregroundStyle(.secondary)
                        if let raw = business.source_url, let url = URL(string: raw),
                           ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil {
                            Link("Business source", destination: url)
                        }
                    }
                }
                Text("Business addresses are recorded separately from vehicle locations. These links may describe historical work.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if loading { Section { HStack { ProgressView(); Text("Reading seller and business evidence") } } }
            if failed { Section { Button("Seller / business records couldn't load · Retry") { Task { await load() } } } }
            Section {
                NavigationLink { CountyZIPVehicles(group: group) } label: { Label("Inspect vehicle evidence", systemImage: "doc.text.magnifyingglass") }
            }
        }
        .navigationTitle("ZIP \(group.id) activity").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        .task(id: group.vehicles.flatMap { $0.observations.map(\.id) }) { await load() }
        #if DEBUG
        .navigationDestination(item: $debugVehicleId) { id in
            if let evidence = group.vehicles.first(where: { $0.id == id }) {
                VehicleDetailView(vehicleId: evidence.id.uuidString.lowercased(), embedInNavigationStack: false,
                              mapContext: MapVehicleContext(group: group, evidence: evidence,
                                                            seller: fold?.sellers.first?.name))
            }
        }
        #endif
    }

    private var publicBusinessLinks: [ZIPBusinessRow.Business] {
        ZIPBusinessRow.publicBusinesses(businesses, zip: group.id)
    }

    private func load() async {
        guard !Task.isCancelled else { return }
        loading = true; failed = false
        let previousListings = listings
        let initial = await Task.detached { ZIPActivityFold(group: group, listings: previousListings) }.value
        guard !Task.isCancelled else { return }
        fold = initial
        do {
            async let listingRead: [ZIPListingRow] = readListings(table: "bat_listings",
                selection: "id,vehicle_id,bat_listing_url,seller_username,seller_external_identity_id")
            async let auctionRead: [ZIPListingRow] = readListings(table: "auction_events",
                selection: "id,vehicle_id,bat_listing_url:source_url,seller_username:seller_name")
            async let businessRead: [ZIPBusinessRow] = readBusinesses()
            let result = try await (listingRead, auctionRead, businessRead)
            let sourceListings = result.0 + result.1
            let calculated = await Task.detached { ZIPActivityFold(group: group, listings: sourceListings) }.value
            try Task.checkCancellation()
            listings = sourceListings; businesses = result.2; fold = calculated
            NSLog("NukeCapture ZIP %@: %d source listings, %d seller groups, %d public business links",
                  group.id, calculated.listingCount, calculated.sellers.count, publicBusinessLinks.count)
            #if DEBUG
            if ProcessInfo.processInfo.environment["NUKE_DEBUG_MAP_PROFILE"] == "1", debugVehicleId == nil,
               let listing = calculated.sellers.first?.listings.first {
                debugVehicleId = listing.vehicle_id
            }
            #endif
        } catch {
            guard !Task.isCancelled else { return }
            failed = true
        }
        loading = false
    }

    private func readListings(table: String, selection: String) async throws -> [ZIPListingRow] {
        var result: [ZIPListingRow] = []
        let ids = group.vehicles.map { $0.id.uuidString.lowercased() }.sorted()
        for offset in stride(from: 0, to: ids.count, by: 80) {
            var cursor: String?
            while true {
                try Task.checkCancellation()
                var request = SupabaseService.client.from(table)
                    .select(selection)
                    .in("vehicle_id", values: Array(ids[offset..<min(offset + 80, ids.count)]))
                if let cursor { request = request.gt("id", value: cursor) }
                let page: [ZIPListingRow] = try await request.order("id", ascending: true).limit(500).execute().value
                guard let last = page.last else { break }
                let next = last.id.uuidString.lowercased()
                guard cursor == nil || next > cursor! else { throw URLError(.cannotParseResponse) }
                result.append(contentsOf: page); cursor = next
            }
        }
        return result
    }

    private func readBusinesses() async throws -> [ZIPBusinessRow] {
        var result: [ZIPBusinessRow] = []
        let ids = group.vehicles.map { $0.id.uuidString.lowercased() }.sorted()
        for offset in stride(from: 0, to: ids.count, by: 80) {
            var cursor: String?
            while true {
                try Task.checkCancellation()
                var request = SupabaseService.client.from("organization_vehicles")
                    .select("id,vehicle_id,relationship_type,organizations(id,business_name,business_type,city,state,zip_code,source_url)")
                    .in("vehicle_id", values: Array(ids[offset..<min(offset + 80, ids.count)]))
                    .eq("organizations.is_public", value: true)
                if let cursor { request = request.gt("id", value: cursor) }
                let page: [ZIPBusinessRow] = try await request.order("id", ascending: true).limit(500).execute().value
                guard let last = page.last else { break }
                let next = last.id.uuidString.lowercased()
                guard cursor == nil || next > cursor! else { throw URLError(.cannotParseResponse) }
                result.append(contentsOf: page); cursor = next
            }
        }
        return result
    }
}

struct MapVehicleContext {
    let vehicleTitle: String
    let cohortVehicleCount: Int
    let make: String?
    let makeVehicleCount: Int
    let zip: String
    let observationCount: Int
    let sources: [String]
    let firstDate: Date?
    let latestDate: Date?
    let seller: String?
    init(group: CountyZIPGroup, evidence: CountyVehicleEvidence, seller: String? = nil) {
        vehicleTitle = evidence.vehicle.title
        cohortVehicleCount = group.vehicles.count
        make = evidence.vehicle.make?.trimmingCharacters(in: .whitespacesAndNewlines)
        makeVehicleCount = group.vehicles.filter {
            guard let name = evidence.vehicle.make?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return false }
            return $0.vehicle.make?.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(name) == .orderedSame
        }.count
        zip = group.label
        observationCount = evidence.observations.count
        sources = Set(evidence.observations.compactMap(\.source_platform)).sorted()
        firstDate = evidence.observations.compactMap(\.observedDate).min()
        latestDate = evidence.observations.compactMap(\.observedDate).max()
        self.seller = seller
    }
}

private struct CountyVehicleThumbnail: View {
    let vehicle: VehicleHeaderRow
    let size: CGFloat
    var body: some View {
        Color(uiColor: .secondarySystemFill)
            .frame(width: size, height: size)
            .overlay {
                CachedAsyncImage(url: NukeImage.thumb(vehicle.primary_image_url, width: Int(size * 3))) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "car.side").foregroundStyle(.secondary)
                }
            }.clipped()
    }
}

struct CountyZIPVehicles: View {
    let group: CountyZIPGroup
    var body: some View {
        List {
            Section {
                Text("\(group.vehicles.count.formatted()) vehicles with historical location evidence")
                    .font(.subheadline).foregroundStyle(.secondary)
                if !group.isZIP {
                    Text("These observations cannot establish a ZIP within the selected county.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            ForEach(group.vehicles) { evidence in
                Section {
                    NavigationLink {
                        VehicleDetailView(vehicleId: evidence.id.uuidString.lowercased(), embedInNavigationStack: false,
                                          mapContext: MapVehicleContext(group: group, evidence: evidence))
                    } label: {
                        HStack(spacing: 12) {
                            CountyVehicleThumbnail(vehicle: evidence.vehicle, size: 72)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(evidence.vehicle.title.isEmpty ? "Vehicle record" : evidence.vehicle.title)
                                    .font(.subheadline.weight(.semibold))
                                if let date = evidence.observations.first?.observedDate {
                                    Text("Location observation: \(date.formatted(date: .abbreviated, time: .omitted))")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    DisclosureGroup("Location evidence · \(evidence.observations.count)") {
                        ForEach(evidence.observations) { row in
                            VStack(alignment: .leading, spacing: 5) {
                                Text([row.source_platform, row.city, row.postal_code].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.subheadline)
                                if let date = row.observedDate {
                                    Text("Observation date: \(date.formatted(date: .abbreviated, time: .shortened))")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                if let precision = row.precision {
                                    Text("Location precision: \(precision)").font(.caption).foregroundStyle(.secondary)
                                }
                                if let raw = row.source_url, let url = URL(string: raw),
                                   ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil {
                                    Link("Open location source", destination: url).font(.subheadline)
                                }
                            }.padding(.vertical, 4)
                        }
                    }
                }
            }
        }
        .navigationTitle(group.label)
        .navigationBarTitleDisplayMode(.inline)
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
    var geometry: [MKOverlay]? = nil
    var focus: MKMapRect? = nil
    var highlighted: String? = nil
    var areaLabels: [ZIPAreaLabel] = []
    var drawsAreas = true
    var onScaleChange: ((GeographicScale) -> Void)? = nil
    var onCountyFocus: ((String) -> Void)? = nil
    let onTap: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.mapType = .mutedStandard
        map.pointOfInterestFilter = .excludingAll
        map.showsCompass = false
        if let focus {
            map.setVisibleMapRect(focus, edgePadding: UIEdgeInsets(top: 80, left: 20, bottom: 120, right: 20), animated: false)
        } else {
            map.region = MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 39.5, longitude: -98.35),
                span: MKCoordinateSpan(latitudeDelta: 34, longitudeDelta: 44))
        }
        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.handleTap(_:)))
        map.addGestureRecognizer(tap)
        context.coordinator.attach(map)   // parse + add overlays off-main
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.applyGeometry(map)
        context.coordinator.applyCountsIfReady(map)
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: CountyChoropleth
        private var overlays: [MKOverlay] = []
        private var appliedCounts: [String: Int] = [:]
        private var appliedBreaks: [Int] = []
        private var appliedHighlight: String?
        private var appliedDrawsAreas = true
        private var suppliedIDs: [ObjectIdentifier] = []
        private var labelIDs: [String] = []
        private var countyHitAreas: [MKOverlay] = []
        private var appliedFocus: MKMapRect?
        init(_ parent: CountyChoropleth) { self.parent = parent }

        // Parse the bundled polygons once, off the main thread, then add them.
        func attach(_ map: MKMapView) {
            applyGeometry(map)
            DispatchQueue.global(qos: .userInitiated).async { [weak self, weak map] in
                let parsed = Self.parseOverlays()
                DispatchQueue.main.async {
                    guard let self, let map else { return }
                    self.countyHitAreas = parsed
                    if self.parent.geometry == nil {
                        self.overlays = parsed
                        map.addOverlays(parsed)
                    }
                    self.applyCountsIfReady(map)
                    self.reportRegion(map)
                }
            }
        }

        func applyGeometry(_ map: MKMapView) {
            if let focus = parent.focus,
               appliedFocus?.origin.x != focus.origin.x || appliedFocus?.origin.y != focus.origin.y ||
                appliedFocus?.size.width != focus.size.width || appliedFocus?.size.height != focus.size.height {
                appliedFocus = focus
                map.setVisibleMapRect(focus, edgePadding: UIEdgeInsets(top: 130, left: 20, bottom: 130, right: 20), animated: false)
            }
            guard let geometry = parent.geometry else { return }
            let ids = geometry.map { ObjectIdentifier($0 as AnyObject) }
            if ids != suppliedIDs {
                map.removeOverlays(overlays); overlays = geometry; suppliedIDs = ids
                map.addOverlays(geometry)
            }
            let labels = parent.areaLabels.filter { parent.counts[$0.zip, default: 0] > 0 }
            let keys = labels.map { "\($0.zip):\(parent.counts[$0.zip, default: 0])" }
            if keys != labelIDs {
                map.removeAnnotations(map.annotations); labelIDs = keys
                map.addAnnotations(labels)
            }
        }

        // When the counts arrive after the overlays, re-render with the real fills.
        func applyCountsIfReady(_ map: MKMapView) {
            guard !overlays.isEmpty,
                  parent.counts != appliedCounts || parent.breaks != appliedBreaks || parent.highlighted != appliedHighlight || parent.drawsAreas != appliedDrawsAreas else { return }
            if let selected = parent.highlighted, selected != appliedHighlight,
               let area = overlays.first(where: { ($0 as? MKShape)?.title == selected }) {
                map.setVisibleMapRect(area.boundingMapRect, edgePadding: UIEdgeInsets(top: 90, left: 25, bottom: 120, right: 25), animated: true)
            }
            appliedCounts = parent.counts; appliedBreaks = parent.breaks
            appliedHighlight = parent.highlighted
            appliedDrawsAreas = parent.drawsAreas
            for o in overlays where map.renderer(for: o) != nil {
                recolor(map.renderer(for: o)!, o)
            }
        }

        private func recolor(_ renderer: MKOverlayRenderer, _ overlay: MKOverlay) {
            let fips = (overlay as? MKShape)?.title ?? ""
            let color = parent.counts[fips].map { rampUIColor(t: self.tForCount($0)) } ?? .clear
            if let r = renderer as? MKOverlayPathRenderer {
                r.fillColor = color
                r.strokeColor = !parent.drawsAreas && !fips.hasPrefix("county:") ? .clear
                    : fips.hasPrefix("county:") || fips == parent.highlighted ? .label : UIColor.separator.withAlphaComponent(0.55)
                r.lineWidth = fips.hasPrefix("county:") || fips == parent.highlighted ? 2 : 0.5
                r.setNeedsDisplay()
            }
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
            if let mp = overlay as? MKMultiPolygon {
                let r = MKMultiPolygonRenderer(multiPolygon: mp)
                recolor(r, overlay)
                return r
            }
            let r = MKPolygonRenderer(polygon: overlay as! MKPolygon)
            recolor(r, overlay)
            return r
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard let area = annotation as? ZIPAreaLabel else { return nil }
            let view = MKAnnotationView(annotation: area, reuseIdentifier: nil)
            let label = UILabel()
            label.text = "\(area.zip) · \(parent.counts[area.zip, default: 0])"
            label.font = .monospacedSystemFont(ofSize: 11, weight: .semibold)
            label.textColor = .label; label.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.85)
            label.sizeToFit(); view.frame.size = CGSize(width: label.bounds.width + 8, height: 22)
            label.frame = view.bounds; label.textAlignment = .center; view.addSubview(label)
            view.displayPriority = .defaultLow
            view.accessibilityLabel = "ZIP \(area.zip), \(parent.counts[area.zip, default: 0]) vehicles with location evidence"
            return view
        }

        func mapView(_ mapView: MKMapView, didSelect annotation: MKAnnotation) {
            if let area = annotation as? ZIPAreaLabel { parent.onTap(area.zip) }
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            reportRegion(mapView)
        }

        private func reportRegion(_ mapView: MKMapView) {
            let scale = GeographicScale.forSpan(mapView.region.span.longitudeDelta)
            let center = MKMapPoint(mapView.region.center)
            let fips = mapView.region.span.longitudeDelta < 4 && parent.highlighted == nil
                ? countyHitAreas.first(where: { Self.contains($0, center) }).flatMap { ($0 as? MKShape)?.title } : nil
            DispatchQueue.main.async { [weak self] in
                self?.parent.onScaleChange?(scale)
                if let fips { self?.parent.onCountyFocus?(fips) }
            }
        }

        // Tap → the county containing the point (bbox pre-filter, then path hit-test).
        @objc func handleTap(_ gr: UITapGestureRecognizer) {
            guard let map = gr.view as? MKMapView else { return }
            let mapPoint = MKMapPoint(map.convert(gr.location(in: map), toCoordinateFrom: map))
            for o in overlays where o.boundingMapRect.contains(mapPoint) {
                if !parent.drawsAreas { continue }
                if (o as? MKShape)?.title?.hasPrefix("county:") == true { continue }
                if let poly = o as? MKPolygon, Self.contains(poly, mapPoint) {
                    parent.onTap(poly.title ?? ""); return
                }
                if let mpoly = o as? MKMultiPolygon {
                    for poly in mpoly.polygons where Self.contains(poly, mapPoint) {
                        parent.onTap(mpoly.title ?? ""); return
                    }
                }
            }
            // A county is only a read partition; selecting it opens ZIP evidence
            // on this same canvas, without an intermediate county page.
            if let county = countyHitAreas.first(where: { Self.contains($0, mapPoint) }),
               let fips = (county as? MKShape)?.title {
                map.setVisibleMapRect(county.boundingMapRect, edgePadding: UIEdgeInsets(top: 130, left: 20, bottom: 130, right: 20), animated: true)
                parent.onCountyFocus?(fips)
            }
        }

        private static func contains(_ overlay: MKOverlay, _ point: MKMapPoint) -> Bool {
            guard overlay.boundingMapRect.contains(point) else { return false }
            if let polygon = overlay as? MKPolygon { return contains(polygon, point) }
            if let polygons = overlay as? MKMultiPolygon { return polygons.polygons.contains { contains($0, point) } }
            return false
        }

        private static func contains(_ poly: MKPolygon, _ mp: MKMapPoint) -> Bool {
            let r = MKPolygonRenderer(polygon: poly)
            r.createPath()
            return r.path?.contains(r.point(for: mp), using: .evenOdd) ?? false
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
// Facets from the region's already-read evidence. Opening this control performs
// no extra database query and does not replace the selected geographic/time lens.
struct MakePickerSheet: View {
    @Binding var selected: String?
    @Environment(\.dismiss) private var dismiss
    let makes: [ZIPActivityFold.Count]
    @State private var query = ""

    private var filtered: [ZIPActivityFold.Count] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? makes : makes.filter { $0.label.lowercased().contains(q) }
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
                        selected = m.label; dismiss()
                    } label: {
                        HStack {
                            Text(m.label).foregroundStyle(.primary)
                            Spacer()
                            Text(m.count.formatted())
                                .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                            if selected?.caseInsensitiveCompare(m.label) == .orderedSame { Image(systemName: "checkmark").foregroundStyle(.tint) }
                        }
                    }
                }
            }
            .searchable(text: $query, prompt: "Make")
            .navigationTitle("Makes in this area")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
