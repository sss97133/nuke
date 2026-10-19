// ClientFaceSection.swift — the customer side of your own profile: post a job for one of your
// vehicles (get_user_garage). Shown on your own profile only; the server decides eligibility.

import SwiftUI

struct ClientFaceSection: View {
    let isOwn: Bool

    @State private var garage: [SupabaseService.RelinkTarget] = []
    @State private var loaded = false

    var body: some View {
        if isOwn {
            Section {
                if loaded && garage.isEmpty {
                    Text("Add a vehicle to your garage to post a job for it.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(garage) { v in
                    NavigationLink { PostJobView(vehicleId: v.vehicle_id, vehicleTitle: Self.title(v)) } label: {
                        Label("Post a job for the \(Self.title(v))", systemImage: "square.and.pencil")
                    }
                }
            } header: {
                Text("Get work done")
            } footer: {
                Text("Describe the work; technicians near you can offer. Nothing is booked or paid until you accept.")
            }
            .task { if !loaded { garage = await SupabaseService.fetchGarage(); loaded = true } }
        }
    }

    static func title(_ v: SupabaseService.RelinkTarget) -> String {
        [v.year.map(String.init), v.make, v.model].compactMap { $0 }.joined(separator: " ").nilIfEmpty ?? "vehicle"
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
