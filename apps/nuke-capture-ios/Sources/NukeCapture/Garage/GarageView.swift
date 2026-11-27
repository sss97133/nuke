// GarageView.swift — account vehicles, searchable by year, make or model, as cards in the order of their recorded activity. The phone's
// copy of the web garage (PR #3612): one list, newest dated activity first, year headings, undated cars last;
// the relationship is the first item on the card's lane, not a section.
// Relationship and work controls remain under Garage details (the card's menu).
//
// Reads: get_user_garage + get_my_garage_owner_corrections (GarageReaders.ownGarage, shared with ProfileView),
// get_vehicle_contribution_days_batch (every card's day squares, one window and scale for the garage) and
// my_unorganized_photo_count. Each card reads its own header and reel (GarageCard). Each car opens VehicleDetailView.
//
// The top of the list is "Today in your garage" (GarageActivityViews), then one compact group of utility rows
// (photos with no vehicle, Organize photos, Identity pending) so they stay reachable above a long run of cards.

import SwiftUI

/// Where a tap came from: a card (garage.vehicle.profile.<id>) or the activity feed (garage.activity.profile.<id>).
struct GarageRoute: Hashable, Identifiable {
    let id: String
    let fromCard: Bool
}

struct GarageView: View {
    let userId: String

    @State private var garage: OwnGarage?
    @State private var readAt: Date?
    @State private var cachedAt: Date?
    @State private var failure: JobRefusal?
    @State private var photos: JobLoad<UnorganizedPhotos> = .loading
    @State private var timelines: JobLoad<[String: GarageTimeline]> = .loading
    @State private var axis = GarageAxis.make([])
    @State private var query = ""
    @State private var manageVehicle: GarageVehicle?
    @State private var logBookVehicle: GarageVehicle?
    @State private var agentVehicle: GarageVehicle?
    @State private var requests = ReadRequestGuard()
    @State private var openRoute: GarageRoute?
    @StateObject private var activity = GarageActivityStore()
    @Environment(\.scenePhase) private var scenePhase

    private var isSearching: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var timelineMap: [String: GarageTimeline] {
        if case .loaded(let map) = timelines { return map }
        return [:]
    }

    private var timelineFailed: Bool {
        if case .refused = timelines { return true }
        return false
    }

    var body: some View {
        List {
            if !isSearching {
                GarageActivitySections(store: activity, retry: { refreshActivity() },
                                       open: { openRoute = GarageRoute(id: $0, fromCard: false) })
                utilitySection
            }
            if let garage {
                let matches = GarageSections.matching(garage.vehicles, query: query)
                if isSearching && matches.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else if garage.vehicles.isEmpty {
                    Section { Text(GarageCopy.noneOwned).font(.footnote).foregroundStyle(.secondary) }
                } else {
                    let map = timelineMap
                    ForEach(GarageOrder.grouped(matches, timelines: map)) { group in
                        Section {
                            ForEach(group.vehicles) { v in card(v, timeline: map[v.vehicle_id.lowercased()]) }
                        } header: {
                            Text("\(group.label) · \(group.vehicles.count)")
                        }
                    }
                }
                Section {} footer: {
                    if isSearching { Text("\(matches.count) matches in the \(garage.vehicles.count) vehicle records loaded for your account.") }
                    Text(GarageSections(garage.vehicles).coverage(readAt: readAt, cachedAt: cachedAt))
                }
            } else if let failure {
                Section {
                    JobRefusalRow(refusal: failure)
                    Button("Retry") { Task { await loadGarage() } }
                }
            } else {
                Section { ProgressView().frame(maxWidth: .infinity) }
            }
        }
        .navigationTitle("Garage")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Year, make or model")
        .refreshable { await load() }
        .task(id: userId) { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { refreshActivity() }
        }
        .navigationDestination(item: $openRoute) { route in
            VehicleDetailView(vehicleId: route.id, embedInNavigationStack: false)
                .accessibilityIdentifier(route.fromCard ? "garage.vehicle.profile.\(route.id)" : "garage.activity.profile.\(route.id)")
        }
        .sheet(item: $manageVehicle) { vehicle in
            NavigationStack {
                GarageVehicleView(vehicle: vehicle)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { manageVehicle = nil } } }
            }
        }
        .sheet(item: $logBookVehicle) { vehicle in GarageLogBookView(vehicle: vehicle) }
        .sheet(item: $agentVehicle) { vehicle in
            AgentChatView(vehicleId: vehicle.vehicle_id, backend: .vehicleAgent,
                          prompt: "Ask about \(vehicle.title.isEmpty ? "this vehicle" : vehicle.title)")
        }
    }

    private func card(_ v: GarageVehicle, timeline: GarageTimeline?) -> some View {
        GarageCard(vehicle: v, timeline: timeline, timelineFailed: timelineFailed, axis: axis,
                   onOpen: { openRoute = GarageRoute(id: v.vehicle_id, fromCard: true) })
            .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("garage.vehicle.\(v.vehicle_id)")
            .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: NukeRadius.card))
            .contextMenu {
                Button { agentVehicle = v } label: { Label("Ask this car's agent", systemImage: "bubble.left.and.text.bubble.right") }
                Button { logBookVehicle = v } label: { Label("Log book", systemImage: "book.closed") }
                Button { manageVehicle = v } label: { Label("Garage details", systemImage: "slider.horizontal.3") }
                if let vin = v.vin, !vin.isEmpty {
                    Button { UIPasteboard.general.string = vin } label: { Label("Copy VIN", systemImage: "doc.on.doc") }
                }
                Button { openRoute = GarageRoute(id: v.vehicle_id, fromCard: true) } label: { Label("Open the profile", systemImage: "car.side") }
            }
    }

    /// Photos waiting for a vehicle and account-stated vehicles still waiting for identity: small rows above the
    /// cards, so a garage of any size keeps them one glance away. Identity pending stays folded until opened.
    private var utilitySection: some View {
        Section {
            UnorganizedPhotosRow(load: photos)
            NavigationLink { SessionConfirmView() } label: {
                Label("Organize photos", systemImage: "checklist")
            }
            .accessibilityIdentifier("garage.organize")
            if let unresolved = garage?.unresolved, !unresolved.isEmpty {
                DisclosureGroup {
                    ForEach(unresolved) { source in
                        NavigationLink {
                            GarageUnresolvedSourceView(userId: userId, sourceId: source.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(source.label).font(.subheadline)
                                Text("Account statement · vehicle not linked")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityIdentifier("garage.unresolved.\(source.id)")
                    }
                } label: {
                    Label("Identity pending · \(unresolved.count)", systemImage: "questionmark.circle")
                        .accessibilityIdentifier("garage.identityPending")
                }
            }
        } footer: {
            Text(GarageCopy.organizeScope)
        }
    }

    private func load() async {
        async let counted = GarageReaders.unorganizedPhotos()
        // The cars saved from the last good read go up at once, with their saved time in the footer; the live
        // read below replaces them (garage, cars, then the day squares and activity take several round trips).
        if garage == nil { showSaved() }
        await loadGarage()
        if let vehicles = garage?.vehicles {
            async let read = GarageTimelineReader.read(ids: vehicles.map(\.vehicle_id))
            await activity.refresh(vehicles: vehicles)
            apply(await read)
        }
        photos = await counted
    }

    /// A failed re-read keeps the squares already drawn; the axis is the whole garage's, never the search's.
    private func apply(_ read: JobLoad<[String: GarageTimeline]>) {
        if case .refused = read, case .loaded = timelines { return }
        timelines = read
        if case .loaded(let map) = read { axis = GarageAxis.make(Array(map.values)) }
    }

    private func refreshActivity() {
        guard let vehicles = garage?.vehicles else { return }
        Task { await activity.refresh(vehicles: vehicles) }
    }

    private func loadGarage() async {
        let request = requests.begin()
        do {
            let own = try await GarageReaders.ownGarage(userId: userId)
            guard !Task.isCancelled, requests.isCurrent(request) else { return }
            garage = own
            readAt = Date()
            cachedAt = nil
            failure = nil
            LocalStore.shared.cacheGarage(userId: userId, vehicles: own.vehicles)
        } catch {
            guard !Task.isCancelled, requests.isCurrent(request) else { return }
            NSLog("NukeCapture garage screen load failed: %@", String(describing: error))
            if garage == nil { showSaved() }
            if garage == nil {
                failure = JobReaders.refusal(GarageReaders.garageName, error)
            }
        }
    }

    /// The garage as the last good read saved it (owner corrections already applied), marked as saved.
    private func showSaved() {
        guard let cached = LocalStore.shared.cachedGarage(userId: userId), !cached.vehicles.isEmpty else { return }
        let unresolved = (try? LocalStore.shared.cachedUnresolvedGarageSources(userId: userId)) ?? []
        garage = OwnGarage(vehicles: GarageVehicle.applying([], to: cached.vehicles.map(\.projection)), unresolved: unresolved)
        cachedAt = cached.cachedAt
        failure = nil
    }
}

/// The account's recorded source excerpt, re-read on open so changed sources are not shown from cache.
struct GarageUnresolvedSourceView: View {
    let userId: String
    let sourceId: String
    @State private var state: JobLoad<GarageUnresolvedSource?> = .loading
    @State private var requests = ReadRequestGuard()
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        List {
            if !session.isSignedIn || SupabaseService.currentUserId != userId.lowercased() {
                Section { Text("Your account changed. Return to Garage to continue.") }
            } else {
                switch state {
                case .loading:
                    ProgressView("Reading statement…")
                case .refused(let refusal):
                    Section {
                        JobRefusalRow(refusal: refusal)
                        Button("Retry") { Task { await load() } }
                    }
                case .loaded(let source):
                    if let source {
                        Section("Account statement") {
                            Text(source.label).font(.headline)
                            if !source.statedRoles.isEmpty {
                                Text("Stated relationship: " + source.statedRoles.map(GarageVehicle.statedRole).joined(separator: ", "))
                            }
                            if let date = ProfileClock.day(source.observedAt) { Text("Recorded \(date)") }
                            if let excerpt = source.sourceExcerpt, !excerpt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Source excerpt").font(.caption).foregroundStyle(.secondary)
                                    Text(excerpt).accessibilityIdentifier("garage.statement.source")
                                }
                            } else {
                                Text("The statement text is unavailable in this read.").foregroundStyle(.secondary)
                            }
                        }
                        Section("Vehicle identity") {
                            Text("No identified vehicle is linked to this statement.")
                            Text("Review groups dated photos uploaded by this app. They may not relate to this statement; other photos aren't included.")
                                .font(.footnote).foregroundStyle(.secondary)
                            NavigationLink("Review photo sessions") { SessionConfirmView() }
                        }
                    } else {
                        Section { Text("This statement wasn't returned in the current Garage read.") }
                    }
                }
            }
        }
        .navigationTitle("Vehicle statement")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: sourceId) { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { _ = requests.begin(); state = .loading }
            if phase == .active { Task { await load() } }
        }
    }

    private func load() async {
        let request = requests.begin()
        state = .loading
        let result = await GarageReaders.unresolvedSource(userId: userId, sourceId: sourceId)
        guard !Task.isCancelled, requests.isCurrent(request) else { return }
        guard SupabaseService.currentUserId == userId.lowercased() else { state = .loading; return }
        state = result
    }
}

/// The count of the account's photos with no vehicle, with its population and clock.
struct UnorganizedPhotosRow: View {
    let load: JobLoad<UnorganizedPhotos>

    var body: some View {
        switch load {
        case .loading:
            HStack {
                Text("Photos with no vehicle").font(.footnote).foregroundStyle(.secondary)
                Spacer()
                ProgressView().controlSize(.small)
            }
        case .refused(let refusal):
            JobRefusalRow(refusal: refusal)
        case .loaded(let photos):
            RootedValueView(label: "Photos with no vehicle", value: photos.value, status: .recorded, decay: photos.coverage)
        }
    }
}
