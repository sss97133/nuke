// FacilityView.swift — a shop's space and equipment over facility_read.
//
// Assets grouped by kind with capacity; a 60-day strip per asset with its confirmed busy windows
// ("Busy" for everyone, the job only for parties); licenses as type and expiry (never numbers);
// members by public handle. Owners and members get "Declare an asset" from viewer.actions. Opened
// from a job, it offers "Book a bay" for that job.

import SwiftUI

struct FacilityView: View {
    let organizationId: String
    var nameHint: String? = nil
    /// The job a booking would be for, when opened from a job page.
    var bookingFor: String? = nil
    var onBooked: ((FacilityReservation) -> Void)? = nil

    @State private var read: JobLoad<FacilityRead> = .loading

    var body: some View {
        FacilityContent(read: read, nameHint: nameHint, bookingFor: bookingFor,
                        onChanged: { Task { await load() } }, onBooked: onBooked)
            .task(id: organizationId) { await load() }
            .refreshable { await load() }
    }

    private func load() async { read = await FacilityReaders.read(organizationId: organizationId) }
}

struct FacilityContent: View {
    let read: JobLoad<FacilityRead>
    var nameHint: String? = nil
    var bookingFor: String? = nil
    var now: Date = Date()
    var onChanged: (() -> Void)? = nil
    var onBooked: ((FacilityReservation) -> Void)? = nil

    @State private var declaring = false
    @State private var booking = false

    var body: some View {
        List {
            switch read {
            case .loading:
                Section {
                    HStack(spacing: 8) { ProgressView(); Text("Loading shop…").font(.footnote).foregroundStyle(.secondary) }
                }
            case .refused(let refusal):
                Section { JobRefusalRow(refusal: refusal) }
            case .loaded(let f):
                assetsSection(f)
                licensesSection(f)
                membersSection(f)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var title: String {
        if case .loaded(let f) = read, let n = f.organizationName { return n }
        return nameHint ?? "Shop"
    }

    // MARK: Assets

    @ViewBuilder private func assetsSection(_ f: FacilityRead) -> some View {
        Section {
            if f.groups.isEmpty {
                Text("This shop hasn't listed any space or equipment yet.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(f.groups) { g in
                RootedValueView(label: FacilityCopy.kindPlural(g.kind), value: "\(g.assets.count) · holds \(g.capacityTotal)",
                                status: .attributed, decay: "listed by the shop")
                ForEach(g.assets) { a in assetRow(a, viewerIsParty: f.viewer?.party == true) }
            }
            if let bookingFor, !f.assets.isEmpty {
                Button { booking = true } label: { Label("Book a bay for this job", systemImage: "calendar.badge.plus") }
                    .sheet(isPresented: $booking) {
                        BookFacilitySheet(workOrderId: bookingFor, choices: FacilityChoice.from(f), onBooked: { r in onBooked?(r); onChanged?() })
                    }
            }
            if let a = f.declareAction {
                Button { declaring = true } label: { Label("Declare an asset", systemImage: "plus.square.on.square") }
                    .sheet(isPresented: $declaring) {
                        DeclareAssetSheet(action: a, shopName: f.organizationName ?? "your shop") { onChanged?() }
                    }
            }
        } header: {
            Text("Space and equipment")
        } footer: {
            Text("Only what the shop itself lists. Nuke never guesses equipment from photos. Busy times are confirmed bookings for the next 60 days.")
        }
    }

    @ViewBuilder private func assetRow(_ a: FacilityRead.Asset, viewerIsParty: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(a.label).font(.subheadline.weight(.medium))
                Spacer()
                Text("\(FacilityCopy.kind(a.kind)) · \(FacilityCopy.capacity(a.capacity))").font(.caption).foregroundStyle(.secondary)
            }
            DayStrip(busyDays: FacilityCopy.busyDays(a.busy, start: now), start: now)
            if a.busy.isEmpty {
                Text("No confirmed bookings in the next 60 days.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(a.busy) { b in
                if let wo = b.workOrderId {
                    NavigationLink { JobView(workOrderId: wo) } label: {
                        Text("Booked for a job you're on · \(FacilityCopy.window(b.from, b.until) ?? "time not readable")").font(.caption)
                    }
                } else {
                    Text("Busy · \(FacilityCopy.window(b.from, b.until) ?? "time not readable")").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: Licenses and members

    @ViewBuilder private func licensesSection(_ f: FacilityRead) -> some View {
        Section("Licenses") {
            if f.licenses.isEmpty {
                Text("No licenses on record.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(f.licenses) { l in
                VStack(alignment: .leading, spacing: 2) {
                    Text(FacilityCopy.license(l)).font(.footnote)
                    Text(FacilityCopy.licenseDetail(l)).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder private func membersSection(_ f: FacilityRead) -> some View {
        Section {
            if f.members.isEmpty && f.membersUnnamed == 0 {
                Text("No members on record.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(f.members) { m in
                RootedValueView(label: m.person.text, value: FacilityCopy.relation(m.relation), status: .attributed)
            }
            if f.membersUnnamed > 0 {
                Text(f.membersUnnamed == 1 ? "1 more person without a public profile" : "\(f.membersUnnamed) more people without a public profile")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("People")
        }
    }
}

/// Next 60 days as small cells; a filled cell has at least one confirmed booking.
struct DayStrip: View {
    let busyDays: Set<Int>
    let start: Date
    var days = 60

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(0..<days, id: \.self) { i in
                    VStack(spacing: 2) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(busyDays.contains(i) ? Color.orange : Color.secondary.opacity(0.15))
                            .frame(width: 9, height: 18)
                        Text(label(i)).font(.system(size: 7, design: .monospaced)).foregroundStyle(.tertiary).frame(width: 9)
                    }
                }
            }
        }
        .accessibilityLabel(busyDays.isEmpty ? "No busy days in the next 60 days" : "\(busyDays.count) busy days in the next 60 days")
    }

    private func label(_ i: Int) -> String {
        guard let d = Calendar.current.date(byAdding: .day, value: i, to: start) else { return "" }
        let n = Calendar.current.component(.day, from: d)
        return n == 1 || i == 0 ? "\(n)" : (i % 7 == 0 ? "·" : "")
    }
}
