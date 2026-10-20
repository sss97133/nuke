// GarageVehicleView.swift — one garage vehicle, ready for work: what the record says it is to you,
// whether strangers can see it (vehicle_row_read), its jobs and "Post a job" (VehicleWorkSection over
// vehicle_work_orders_read), and the full vehicle profile.
//
// The Work card offers "Post a job" for an owned vehicle until its reader states vehicle_access,
// then follows the server; a contribution gets "Order an inspection instead".

import SwiftUI

struct GarageVehicleView: View {
    let vehicle: GarageVehicle

    @State private var row: JobLoad<GarageVehicleRow> = .loading

    private var title: String {
        if case .loaded(let r) = row, !r.title.isEmpty { return r.title }
        return vehicle.title.isEmpty ? "Vehicle" : vehicle.title
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                VehicleWorkSection(vehicleId: vehicle.vehicle_id, ownerContext: GarageRelation.isOwned(vehicle), vehicleTitle: title)
                NavigationLink {
                    VehicleDetailView(vehicleId: vehicle.vehicle_id, embedInNavigationStack: false)
                } label: {
                    Label("Open the vehicle profile", systemImage: "car")
                        .font(.footnote.weight(.medium))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .nukeCard()
            }
            .padding(.top, 12)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: vehicle.vehicle_id) { row = await GarageReaders.vehicleRow(vehicleId: vehicle.vehicle_id) }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            Text(GarageRelation.line(vehicle)).font(.footnote).foregroundStyle(.secondary)
            if let detail = vehicle.relationshipDetail {
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            if let period = vehicle.relationshipPeriod {
                Text(period).font(.caption).foregroundStyle(.secondary)
            }
            switch row {
            case .loading:
                ProgressView().controlSize(.small).padding(.top, 4)
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal).padding(.top, 4)
            case .loaded(let r):
                Label(GarageCopy.visibility(r), systemImage: r.isPublic ? "globe" : "lock")
                    .font(.caption).foregroundStyle(.secondary).padding(.top, 4)
                if let removal = GarageCopy.removal(r) {
                    Label(removal, systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.orange)
                }
                if let merged = r.merged_into_vehicle_id {
                    NavigationLink {
                        VehicleDetailView(vehicleId: merged, embedInNavigationStack: false)
                    } label: {
                        Label("Open the record it was merged into", systemImage: "arrow.triangle.merge")
                            .font(.caption.weight(.medium))
                    }
                }
            }
        }
        .nukeCard()
    }
}
