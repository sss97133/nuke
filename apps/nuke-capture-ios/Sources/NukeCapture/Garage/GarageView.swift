// GarageView.swift — searchable account vehicles and their profiles, followed by photos
// waiting for a vehicle. Relationship and work controls remain under Garage details.
//
// Reads: get_user_garage + get_my_garage_owner_corrections (GarageReaders.ownGarage, shared with
// ProfileView) and my_unorganized_photo_count. Each vehicle opens VehicleDetailView.

import SwiftUI

struct GarageView: View {
    let userId: String

    @State private var garage: OwnGarage?
    @State private var readAt: Date?
    @State private var cachedAt: Date?
    @State private var failure: JobRefusal?
    @State private var photos: JobLoad<UnorganizedPhotos> = .loading
    @State private var showContributed = false
    @State private var query = ""
    @State private var manageVehicle: GarageVehicle?
    @State private var requests = ReadRequestGuard()

    private var isSearching: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        List {
            if let garage {
                let matches = GarageSections.matching(garage.vehicles, query: query)
                if isSearching && matches.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    vehicleSections(GarageSections(matches), unresolved: isSearching ? [] : garage.unresolved)
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
        .sheet(item: $manageVehicle) { vehicle in
            NavigationStack {
                GarageVehicleView(vehicle: vehicle)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { manageVehicle = nil } } }
            }
        }
    }

    @ViewBuilder private func vehicleSections(_ s: GarageSections, unresolved: [GarageUnresolvedSource]) -> some View {
        if !s.owned.isEmpty || s.total == 0 {
            Section {
                if s.owned.isEmpty {
                    Text(GarageCopy.noneOwned).font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(s.owned) { v in vehicleLink(v) }
            } header: {
                Text("Owned · \(s.owned.count)")
            }
        }
        ForEach(s.other) { interest in
            Section("\(interest.label) · \(interest.vehicles.count)") {
                ForEach(interest.vehicles) { v in vehicleLink(v) }
            }
        }
        if !s.previouslyOwned.isEmpty {
            Section("Previously owned · \(s.previouslyOwned.count)") {
                ForEach(s.previouslyOwned) { v in vehicleLink(v) }
            }
        }
        if !s.contributed.isEmpty {
            Section {
                if showContributed || isSearching { ForEach(s.contributed) { v in vehicleLink(v) } }
            } header: {
                Button { withAnimation(.snappy(duration: 0.2)) { showContributed.toggle() } } label: {
                    HStack {
                        Text("Contributed · \(s.contributed.count)")
                        Spacer()
                        Image(systemName: showContributed ? "chevron.up" : "chevron.down").font(.caption2)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } footer: {
                Text(GarageCopy.contributedFooter)
            }
        }
        if !unresolved.isEmpty {
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
    }

    private func vehicleLink(_ v: GarageVehicle) -> some View {
        NavigationLink {
            VehicleDetailView(vehicleId: v.vehicle_id, embedInNavigationStack: false)
                .accessibilityIdentifier("garage.vehicle.profile.\(v.vehicle_id)")
        } label: { GarageRowLabel(vehicle: v) }
        .accessibilityIdentifier("garage.vehicle.\(v.vehicle_id)")
        .swipeActions(edge: .trailing) {
            Button("Garage details") { manageVehicle = v }
                .tint(.secondary)
        }
        .contextMenu { Button("Garage details") { manageVehicle = v } }
    }

    private func load() async {
        async let counted = GarageReaders.unorganizedPhotos()
        await loadGarage()
        photos = await counted
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

/// One garage row: the server's cover thumbnail, the vehicle and what the record says it is to you.
struct GarageRowLabel: View {
    let vehicle: GarageVehicle

    var body: some View {
        HStack(spacing: 12) {
            CachedAsyncImage(url: NukeImage.thumb(vehicle.image_url, width: 170)) { img in
                img.resizable().scaledToFill()
            } placeholder: {
                Image(systemName: "car.side").foregroundStyle(.secondary)
            }
            .frame(width: 56, height: 42)
            .clipped()
            VStack(alignment: .leading, spacing: 2) {
                Text(vehicle.title.isEmpty ? "Unnamed vehicle" : vehicle.title).foregroundStyle(Color.primary)
                Text(GarageRelation.line(vehicle)).font(.caption2).foregroundStyle(.secondary)
                if let detail = vehicle.relationshipDetail {
                    Text(detail).font(.caption2).foregroundStyle(.secondary)
                }
                if let period = vehicle.relationshipPeriod {
                    Text(period).font(.caption2).foregroundStyle(.secondary)
                }
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

/// The own profile's door to the garage: the photo count and the way into each vehicle's jobs.
struct GarageDoorSection: View {
    let userId: String

    @State private var photos: JobLoad<UnorganizedPhotos> = .loading

    var body: some View {
        if SupabaseService.currentUserId == userId.lowercased() {
            Section {
                NavigationLink { GarageView(userId: userId) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Open garage", systemImage: "car.2")
                        Text("Each vehicle's jobs, and post a job for one you own")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                UnorganizedPhotosRow(load: photos)
                NavigationLink { SessionConfirmView() } label: {
                    Label("Organize photos", systemImage: "checklist")
                }
            } header: {
                Text("Garage")
            }
            .task(id: userId) { photos = await GarageReaders.unorganizedPhotos() }
        }
    }
}
