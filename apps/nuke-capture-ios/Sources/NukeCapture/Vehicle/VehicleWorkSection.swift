// VehicleWorkSection.swift — the Work card on a vehicle page.
//
// Jobs on this vehicle from vehicle_work_orders_read (open for public vehicles; a private vehicle
// shows only jobs where the viewer has a part), each a mini stage rail that opens JobView, and a
// Statement link (work_order_statement_read). Sits after the asset window in VehicleDetailView;
// a private vehicle with nothing visible renders no card.

import SwiftUI

struct VehicleWorkSection: View {
    let vehicleId: String

    @Environment(\.vehicleListingContext) private var listingContext
    @State private var jobs: JobLoad<MyWorkOrders> = .loading

    var body: some View {
        VehicleWorkCard(vehicleId: vehicleId, jobs: jobs, planEntry: listingContext)
            .task(id: vehicleId) { jobs = await JobReaders.vehicleWorkOrders(vehicleId: vehicleId) }
    }
}

/// The card's render, separated from the read so fixture snapshots drive it directly.
struct VehicleWorkCard: View {
    let vehicleId: String
    let jobs: JobLoad<MyWorkOrders>
    /// Opened from a listing: offer "Plan the work" (listing_work_plan_read) whatever the job list holds.
    var planEntry = false

    var body: some View {
        switch jobs {
        case .loading:
            if planEntry { card { planLink } } else { EmptyView() }
        case .refused(let refusal) where refusal.kind == .unavailable:
            if planEntry { card { planLink } } else { EmptyView() }
        case .refused(let refusal):
            card { JobRefusalRow(refusal: refusal) }
        case .loaded(let page):
            card {
                if planEntry { planLink.padding(.bottom, 6) }
                if page.rows.isEmpty {
                    Text("No jobs on this vehicle yet.").font(.footnote).foregroundStyle(.secondary)
                        .padding(.vertical, 5)
                }
                ForEach(page.rows) { row in
                    NavigationLink {
                        JobView(workOrderId: row.workOrderId, titleHint: row.headline,
                                vehicleHint: row.vehicleLabel?.text ?? page.vehicleLabel?.text)
                    } label: {
                        HStack {
                            JobRowView(row: row, showVehicle: false)
                            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
                if !page.rows.isEmpty {
                    Text(page.coverage?.sentence ?? "Total not available")
                        .font(.caption2).foregroundStyle(.secondary)
                        .padding(.top, 6)
                    NavigationLink {
                        VehicleStatementView(vehicleId: vehicleId)
                    } label: {
                        Label("Statement", systemImage: "doc.plaintext")
                            .font(.footnote.weight(.medium))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.top, 10)
                }
            }
        }
    }

    private var planLink: some View {
        NavigationLink {
            WorkPlanEstimateView(vehicleId: vehicleId)
        } label: {
            Label("Plan the work", systemImage: "list.bullet.clipboard")
                .font(.footnote.weight(.medium))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("WORK")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)
            content()
        }
        .nukeCard()
    }
}
