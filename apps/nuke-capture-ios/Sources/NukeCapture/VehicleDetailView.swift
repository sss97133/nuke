// VehicleDetailView.swift — the drill target from a photo's "View vehicle" row.
//
// MINIMAL by design: a hero image + "YEAR MAKE MODEL TRIM" title. This is the
// landing a photo points at, NOT a full profile (the web profile is the rich
// surface). Read-only, anon-safe — the same select shape the web uses:
//   vehicles.select(id,year,make,model,trim,primary_image_url).eq(id).limit(1)
//
// Presented from PhotoFullScreenView (a fullScreenCover, so it carries its own
// NavigationStack for the title bar + dismiss).

import SwiftUI

/// One vehicles row — exact columns, read-only.
struct VehicleHeaderRow: Decodable, Identifiable {
    let id: UUID
    let year: Int?
    let make: String?
    let model: String?
    let trim: String?
    let primary_image_url: String?

    /// "YEAR MAKE MODEL TRIM" — only the parts that exist, never a lone "—".
    var title: String {
        var parts: [String] = []
        if let year { parts.append(String(year)) }   // String(): avoid "2,017" locale formatting
        if let make, !make.isEmpty { parts.append(make) }
        if let model, !model.isEmpty { parts.append(model) }
        if let trim, !trim.isEmpty { parts.append(trim) }
        return parts.joined(separator: " ").uppercased()
    }
}

struct VehicleDetailView: View {
    let vehicleId: String
    @Environment(\.dismiss) private var dismiss

    @State private var vehicle: VehicleHeaderRow?
    @State private var loadError: String?
    @State private var loaded = false

    init(vehicleId: String) {
        self.vehicleId = vehicleId
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Hero
                    if let urlStr = vehicle?.primary_image_url, let url = URL(string: urlStr) {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Color(.secondarySystemFill)
                                .overlay { ProgressView() }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 240)
                        .clipped()
                    } else if loaded && loadError == nil {
                        // Loaded, no image — a flat plate, never a broken frame.
                        Color(.secondarySystemFill)
                            .frame(maxWidth: .infinity)
                            .frame(height: 160)
                            .overlay {
                                Image(systemName: "car.side")
                                    .font(.largeTitle)
                                    .foregroundStyle(.secondary)
                            }
                    }

                    // Title + state
                    Group {
                        if let v = vehicle {
                            Text(v.title.isEmpty ? "VEHICLE" : v.title)
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(.primary)
                        } else if let loadError {
                            Text(loadError)
                                .font(.footnote)
                                .foregroundStyle(.red)
                        } else {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Loading…")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 16)

                    Spacer(minLength: 0)
                }
            }
            .navigationTitle("Vehicle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task(id: vehicleId) { await load() }
    }

    private func load() async {
        do {
            let rows: [VehicleHeaderRow] = try await SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,trim,primary_image_url")
                .eq("id", value: vehicleId)
                .limit(1)
                .execute()
                .value
            vehicle = rows.first
            loadError = rows.first == nil ? "Vehicle not found" : nil
        } catch {
            loadError = "Load failed"
            NSLog("NukeCapture vehicle detail load failed: %@", String(describing: error))
        }
        loaded = true
    }
}
