// MapTab.swift — the world: real organization pins from production.
//
// Same query as nuke_frontend/src/components/map/PublicMap.tsx — the
// organizations table, rows with GPS only, read with the anon key (the table
// is public-read by design; the web map ships the identical call in every
// browser). Pin tap → stock sheet: name, type. Real rows only — if the fetch
// fails the map is empty and the failure is a visible row, never fake pins.

import MapKit
import SwiftUI

/// One organizations row, exactly the columns the web map selects.
struct OrgPin: Decodable, Identifiable, Hashable {
    let id: UUID
    let name: String?
    let latitude: Double
    let longitude: Double
    let business_type: String?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

struct MapTab: View {
    @State private var pins: [OrgPin] = []
    @State private var selectedID: UUID?
    @State private var loadError: String?

    private var selectedPin: OrgPin? {
        selectedID.flatMap { id in pins.first { $0.id == id } }
    }

    var body: some View {
        NavigationStack {
            Map(selection: $selectedID) {
                ForEach(pins) { pin in
                    Marker(pin.name ?? "—", coordinate: pin.coordinate)
                        .tag(pin.id)
                }
            }
            .navigationTitle("Map")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if let loadError {
                        Text(loadError)
                            .font(.caption2)
                            .foregroundStyle(.red)
                    } else {
                        Text("\(pins.count)")
                            .font(.caption.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .sheet(item: Binding(
                get: { selectedPin },
                set: { if $0 == nil { selectedID = nil } }
            )) { pin in
                OrgSheet(pin: pin)
                    .presentationDetents([.fraction(0.25), .medium])
            }
            .task { await load() }
        }
    }

    private func load() async {
        guard pins.isEmpty else { return }
        do {
            // SELECT id,name,latitude,longitude,business_type
            // FROM organizations WHERE latitude IS NOT NULL LIMIT 5000
            // — byte-for-byte the PublicMap.tsx query (minus web-only cols).
            pins = try await SupabaseService.client
                .from("organizations")
                .select("id,name,latitude,longitude,business_type")
                .not("latitude", operator: .is, value: "null")
                .limit(5000)
                .execute()
                .value
            loadError = nil
        } catch {
            loadError = "Load failed"
            NSLog("NukeCapture map: org load failed: %@", String(describing: error))
        }
    }
}

/// Stock pin sheet: the row's facts, nothing invented.
private struct OrgSheet: View {
    let pin: OrgPin

    var body: some View {
        NavigationStack {
            List {
                LabeledContent("Name") {
                    Text(pin.name ?? "—")
                }
                LabeledContent("Type") {
                    Text(pin.business_type ?? "—")
                }
            }
            .navigationTitle(pin.name ?? "—")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
