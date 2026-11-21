// GarageView.swift — searchable account vehicles as cards in the order of their recorded activity, followed by
// photos waiting for a vehicle. The phone's copy of the web garage (PR #3612): one list, newest dated activity
// first, year headings, undated cars last; the relationship is the first item on the card's lane, not a section.
// Relationship and work controls remain under Garage details (the card's menu).
//
// Reads: get_user_garage + get_my_garage_owner_corrections (GarageReaders.ownGarage, shared with ProfileView),
// get_vehicle_contribution_days_batch (every card's day squares, one window and scale for the garage) and
// my_unorganized_photo_count. Each card reads its own header and reel (GarageCard). Each car opens VehicleDetailView.
//
// The top of the list is "Today in your garage" (GarageActivityViews).

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
                if !isSearching && !garage.unresolved.isEmpty {
                    unresolvedSection(garage.unresolved)
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

            if !isSearching {
                Section {
                    UnorganizedPhotosRow(load: photos)
                    NavigationLink { SessionConfirmView() } label: {
                        Label("Organize photos", systemImage: "checklist")
                    }
                } header: {
                    Text("Photos to organize")
                } footer: {
                    Text(GarageCopy.organizeScope)
                }
            }
        }
        .navigationTitle("Garage")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Vehicle or VIN")
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

    private func unresolvedSection(_ unresolved: [GarageUnresolvedSource]) -> some View {
        Section {
            ForEach(unresolved) { source in
                VStack(alignment: .leading, spacing: 2) {
                    Text(source.label).font(.subheadline)
                    Text("Account stated · photo evidence still needs to identify this vehicle")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("Identity pending · \(unresolved.count)")
        }
    }

    private func load() async {
        async let counted = GarageReaders.unorganizedPhotos()
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
            if let cached = LocalStore.shared.cachedGarage(userId: userId), !cached.vehicles.isEmpty {
                let unresolved = (try? LocalStore.shared.cachedUnresolvedGarageSources(userId: userId)) ?? []
                garage = OwnGarage(vehicles: GarageVehicle.applying([], to: cached.vehicles.map(\.projection)), unresolved: unresolved)
                cachedAt = cached.cachedAt
                failure = nil
            } else if garage == nil {
                failure = JobReaders.refusal(GarageReaders.garageName, error)
            }
        }
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
