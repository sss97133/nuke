// JobFacilitySection.swift — the job page's shop space over work_order_facility_reservations_read.
//
// Parties, the requester and the shop see every booking request with its state, terms and who
// asked; everyone else sees confirmed busy windows only. "Book a bay" appears only when the reader's
// viewer.actions offers reserve_facility (its facilities are the shops to choose from); "Cancel the
// request" only from the request's own cancel_facility_reservation action.

import SwiftUI

struct JobFacilitySection: View {
    let workOrderId: String
    let facility: JobLoad<JobFacility>
    var onChanged: (() -> Void)? = nil

    @State private var booking = false
    @State private var cancelling: JobReservations.Item?
    @State private var cancelFailure: String?

    var body: some View {
        switch facility {
        case .loaded(let f) where !f.isEmpty:
            Section {
                ForEach(f.requirements) { r in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Shop space").font(.caption).foregroundStyle(.secondary)
                        Text(r.description ?? "Shop space for this job").font(.subheadline)
                    }
                }
                ForEach(f.reservations?.items ?? []) { item in row(item, f.reservations) }
                if (f.reservations?.items ?? []).isEmpty {
                    Text("Not booked yet.").font(.footnote).foregroundStyle(.secondary)
                }
                if let action = f.reserveAction {
                    if f.choices.isEmpty {
                        Text("The shops on this job haven't listed any space yet.").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Button { booking = true } label: { Label("Book a bay", systemImage: "calendar.badge.plus") }
                            .sheet(isPresented: $booking) {
                                BookFacilitySheet(workOrderId: action.args["p_work_order_id"]?.stringValue ?? workOrderId,
                                                  choices: f.choices) { _ in onChanged?() }
                            }
                    }
                }
                ForEach(shops(f), id: \.id) { shop in
                    NavigationLink {
                        FacilityView(organizationId: shop.id, nameHint: shop.name, bookingFor: f.reserveAction == nil ? nil : workOrderId,
                                     onBooked: { _ in onChanged?() })
                    } label: {
                        Label("See \(shop.name ?? "the shop")'s space and calendar", systemImage: "building.2")
                    }
                }
                if let cancelFailure { Text(cancelFailure).font(.caption).foregroundStyle(.red) }
            } header: {
                Text("Shop space")
                    .confirmationDialog("Cancel this booking request?", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }),
                                        titleVisibility: .visible, presenting: cancelling) { item in
                        Button("Cancel the request", role: .destructive) { Task { await cancel(item, f.reservations) } }
                    } message: { _ in
                        Text("The space is released and the shop can't confirm it.")
                    }
            } footer: {
                Text(f.reservations?.party == true || (f.reservations?.items.contains(where: \.party) ?? false)
                     ? "A booking holds space only once the shop confirms it. Nuke doesn't take payment for it."
                     : "Only confirmed bookings are shown here. Requests and fees are visible to the people on the job.")
            }
        case .refused(let refusal):
            Section("Shop space") { JobRefusalRow(refusal: refusal) }
        default:
            EmptyView()
        }
    }

    @ViewBuilder private func row(_ item: JobReservations.Item, _ r: JobReservations?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(FacilityCopy.reservation(item), systemImage: FacilityCopy.reservationSymbol(item.state))
                .font(.footnote)
                .foregroundStyle(item.state == "confirmed" ? .green : (item.state == "requested" ? .primary : .secondary))
            if let detail = FacilityCopy.reservationDetail(item) {
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            if r?.cancelAction(for: item.reservationId) != nil {
                Button(item.state == "confirmed" ? "Cancel the booking" : "Cancel the request", role: .destructive) { cancelling = item }
                    .font(.caption).buttonStyle(.borderless)
            }
        }
    }

    private func shops(_ f: JobFacility) -> [(id: String, name: String?)] {
        var out: [(id: String, name: String?)] = []
        for s in f.reserveAction?.facilities ?? [] where !out.contains(where: { $0.id == s.id }) { out.append(s) }
        for i in f.reservations?.items ?? [] {
            if let id = i.shopId, !out.contains(where: { $0.id == id }) { out.append((id, i.shopName)) }
        }
        return out
    }

    private func cancel(_ item: JobReservations.Item, _ r: JobReservations?) async {
        guard let action = r?.cancelAction(for: item.reservationId), let id = action.args["p_reservation_id"]?.stringValue else { return }
        struct P: Encodable, Sendable { let p_reservation_id: String }
        switch await FacilityWriters.write(action.rpc ?? "cancel_facility_reservation", P(p_reservation_id: id)) {
        case .failure(let f): cancelFailure = f.text
        case .success: cancelFailure = nil; onChanged?()
        }
    }
}
