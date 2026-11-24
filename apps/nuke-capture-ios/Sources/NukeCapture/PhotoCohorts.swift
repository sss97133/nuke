// PhotoCohorts.swift — every group one Library photo belongs to, as tappable chips.
//
// A photo of a Mustang belongs to its own vehicle profile, to the uploader's profile, to the
// organizations linked to that vehicle, to "Ford", to "Mustang", to the year-model cohort, to the
// place it was shot, and to its capture session. This screen shows the ones the record really
// has, each opening that group, and names the missing ones honestly ("Not filed to a vehicle",
// "No GPS") instead of guessing.
//
// v1 reads the existing per-row links from the phone (the owner's own vehicle_images row, joined
// by exif_data.uuid == PHAsset.localIdentifier). Make, model, cohort and organization are derived
// from the vehicle, not stored per photo yet. docs/library/PHOTO_COHORT_GRAPH.md drafts the
// server-side per-image cohort edges and the one reader (image_cohorts_read) that replaces these
// reads once it is applied.

import CoreLocation
import MapKit
import SwiftUI

/// What the record says about one photo, read from the phone.
struct PhotoCohortRead: Equatable {
    struct Vehicle: Equatable { let id: String; let year: Int?; let make: String?; let model: String? }
    struct Org: Equatable { let id: String; let name: String; let role: String? }
    struct ImageSet: Equatable { let id: String; let name: String?; let sessionKind: String? }

    /// false = this photo has no row in the owner's Nuke record (never uploaded or not matched).
    var onRecord: Bool
    var imageId: String?
    var uploaderId: String?
    var vehicle: Vehicle?
    var orgs: [Org] = []
    var privateOrgCount = 0
    var latitude: Double?
    var longitude: Double?
    var sets: [ImageSet] = []
}

/// One chip: a group the photo is in, or a named gap.
struct PhotoCohortEdge: Identifiable, Equatable {
    enum Kind: String { case vehicle, uploader, organization, make, model, cohort, place, session }
    enum Target: Equatable {
        case vehicle(String)
        case profile(String)
        case organization(id: String, name: String)
        case vehicles(filters: [String: String], title: String)
        case cohort(make: String, model: String, year: Int)
        case place(latitude: Double, longitude: Double)
    }
    let kind: Kind
    let title: String
    let target: Target?          // nil = nothing to open (a gap, or a group with no page yet)
    var missing: Bool = false
    var id: String { kind.rawValue + "|" + title }

    var systemImage: String {
        switch kind {
        case .vehicle: return "car.fill"
        case .uploader: return "person.fill"
        case .organization: return "building.2"
        case .make: return "tag"
        case .model: return "square.stack.3d.up"
        case .cohort: return "chart.bar"
        case .place: return "mappin.and.ellipse"
        case .session: return "clock.arrow.circlepath"
        }
    }
}

enum PhotoCohorts {
    /// The chips for one photo. Pure: the order is fixed (vehicle → you → organizations → make →
    /// model → cohort → place → session) and every kind appears either as a link or as a gap.
    /// - deviceLocation: the photo's own GPS from PhotoKit, used when the record has none.
    static func edges(_ read: PhotoCohortRead?, viewerId: String?,
                      deviceLocation: CLLocationCoordinate2D? = nil) -> [PhotoCohortEdge] {
        var out: [PhotoCohortEdge] = []
        let onRecord = read?.onRecord == true
        if !onRecord {
            out.append(.init(kind: .vehicle, title: "Not on your Nuke record yet", target: nil, missing: true))
        } else if let v = read?.vehicle {
            let name = [v.year.map(String.init), v.make, v.model].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            out.append(.init(kind: .vehicle, title: name.isEmpty ? "Vehicle profile" : name, target: .vehicle(v.id)))
        } else {
            out.append(.init(kind: .vehicle, title: "Not filed to a vehicle", target: nil, missing: true))
        }

        if onRecord, let uploader = read?.uploaderId {
            let you = viewerId.map { $0.lowercased() == uploader.lowercased() } ?? false
            out.append(.init(kind: .uploader, title: you ? "You" : "Uploader", target: .profile(uploader)))
        }

        if onRecord, read?.vehicle != nil {
            for org in read?.orgs ?? [] {
                out.append(.init(kind: .organization, title: org.name, target: .organization(id: org.id, name: org.name)))
            }
            let hidden = read?.privateOrgCount ?? 0
            if hidden > 0 {
                out.append(.init(kind: .organization, title: hidden == 1 ? "1 private organization" : "\(hidden) private organizations",
                                 target: nil))
            }
            if (read?.orgs ?? []).isEmpty && hidden == 0 {
                out.append(.init(kind: .organization, title: "No organization linked", target: nil, missing: true))
            }
        }

        if let v = read?.vehicle {
            let make = v.make?.trimmingCharacters(in: .whitespaces) ?? ""
            let model = v.model?.trimmingCharacters(in: .whitespaces) ?? ""
            if make.isEmpty {
                out.append(.init(kind: .make, title: "Make unknown", target: nil, missing: true))
            } else {
                out.append(.init(kind: .make, title: make, target: .vehicles(filters: ["make": make], title: make)))
            }
            if !make.isEmpty && !model.isEmpty {
                out.append(.init(kind: .model, title: model,
                                 target: .vehicles(filters: ["make": make, "model": model], title: "\(make) \(model)")))
                if let year = v.year {
                    out.append(.init(kind: .cohort, title: "\(year) \(model) market", target: .cohort(make: make, model: model, year: year)))
                }
            } else if !make.isEmpty {
                out.append(.init(kind: .model, title: "Model unknown", target: nil, missing: true))
            }
        }

        let lat = read?.latitude ?? deviceLocation?.latitude
        let lng = read?.longitude ?? deviceLocation?.longitude
        if let lat, let lng {
            out.append(.init(kind: .place, title: String(format: "%.3f, %.3f", lat, lng), target: .place(latitude: lat, longitude: lng)))
        } else {
            out.append(.init(kind: .place, title: "No GPS", target: nil, missing: true))
        }

        if onRecord {
            let sets = read?.sets ?? []
            for set in sets.prefix(3) {
                let name = set.name?.isEmpty == false ? set.name! : (set.sessionKind.map { $0.replacingOccurrences(of: "_", with: " ").capitalized } ?? "Capture session")
                out.append(.init(kind: .session, title: name, target: nil))
            }
            if sets.isEmpty {
                out.append(.init(kind: .session, title: "No capture session", target: nil, missing: true))
            }
        }
        return out
    }

    // MARK: - The read (the owner's own row; RLS-scoped)

    private struct ImageRow: Decodable {
        let id: String
        let vehicle_id: String?
        let user_id: String?
        let latitude: Double?
        let longitude: Double?
        let is_superseded: Bool?
    }
    private struct VehicleRow: Decodable { let id: String; let year: Int?; let make: String?; let model: String? }
    private struct OrgLink: Decodable { let organization_id: String; let relationship_type: String? }
    private struct OrgRow: Decodable { let id: String; let business_name: String? }
    private struct SetLink: Decodable { let image_set_id: String }
    private struct SetRow: Decodable { let id: String; let name: String?; let session_type_key: String? }

    /// nil = the read failed (offline): the screen says so rather than showing gaps that aren't real.
    static func read(localIdentifier: String, userId: String) async -> PhotoCohortRead? {
        let client = SupabaseService.client
        do {
            let rows: [ImageRow] = try await client.from("vehicle_images")
                .select("id,vehicle_id,user_id,latitude,longitude,is_superseded")
                .eq("user_id", value: userId)
                .eq("exif_data->>uuid", value: localIdentifier)
                .limit(5).execute().value
            // Prefer the current row that is filed, then any current row.
            let current = rows.filter { $0.is_superseded != true }
            guard let row = current.first(where: { $0.vehicle_id != nil }) ?? current.first ?? rows.first else {
                return PhotoCohortRead(onRecord: false)
            }
            var read = PhotoCohortRead(onRecord: true, imageId: row.id, uploaderId: row.user_id,
                                       latitude: row.latitude, longitude: row.longitude)
            if let vid = row.vehicle_id {
                let vehicles: [VehicleRow] = (try? await client.from("vehicles").select("id,year,make,model")
                    .eq("id", value: vid).limit(1).execute().value) ?? []
                // A vehicle the viewer cannot read still is the photo's vehicle: link it by id.
                let v = vehicles.first
                read.vehicle = .init(id: vid, year: v?.year, make: v?.make, model: v?.model)
                let links: [OrgLink] = (try? await client.from("organization_vehicles")
                    .select("organization_id,relationship_type").eq("vehicle_id", value: vid)
                    .limit(25).execute().value) ?? []
                let ids = Array(Set(links.map(\.organization_id)))
                if !ids.isEmpty {
                    let orgs: [OrgRow] = (try? await client.from("organizations").select("id,business_name")
                        .in("id", values: ids).execute().value) ?? []
                    let byId = Dictionary(orgs.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
                    read.orgs = ids.compactMap { id in
                        guard let o = byId[id], let name = o.business_name, !name.isEmpty else { return nil }
                        return .init(id: id, name: name, role: links.first { $0.organization_id == id }?.relationship_type)
                    }.sorted { $0.name < $1.name }
                    read.privateOrgCount = ids.count - read.orgs.count
                }
            }
            let setLinks: [SetLink] = (try? await client.from("image_set_members").select("image_set_id")
                .eq("image_id", value: row.id).limit(10).execute().value) ?? []
            if !setLinks.isEmpty {
                let sets: [SetRow] = (try? await client.from("image_sets").select("id,name,session_type_key")
                    .in("id", values: setLinks.map(\.image_set_id)).execute().value) ?? []
                read.sets = sets.map { .init(id: $0.id, name: $0.name, sessionKind: $0.session_type_key) }
            }
            return read
        } catch {
            NSLog("PhotoCohorts.read failed: %@", String(describing: error))
            return nil
        }
    }
}

// MARK: - UI

/// The chip strip under a fullscreen Library photo.
struct PhotoCohortStrip: View {
    let localIdentifier: String
    let deviceLocation: CLLocationCoordinate2D?
    @State private var read: PhotoCohortRead?
    @State private var failed = false
    @State private var loaded = false
    @State private var open: PhotoCohortEdge.Target?

    private var viewerId: String? { SupabaseService.currentUserId }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("In these groups")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.7))
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if !loaded {
                        ProgressView().tint(.white).padding(.horizontal, 8)
                    } else if failed {
                        chipLabel(icon: "wifi.exclamationmark", title: "Couldn't read this photo's groups", missing: true)
                    } else {
                        ForEach(PhotoCohorts.edges(read, viewerId: viewerId, deviceLocation: deviceLocation)) { edge in
                            if let target = edge.target {
                                Button { open = target } label: {
                                    chipLabel(icon: edge.systemImage, title: edge.title, missing: false)
                                }
                                .buttonStyle(.plain)
                                .accessibilityHint("Opens this group")
                            } else {
                                chipLabel(icon: edge.systemImage, title: edge.title, missing: edge.missing)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 10)
        .background(LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom))
        .task(id: localIdentifier) {
            loaded = false; failed = false; read = nil
            guard let uid = viewerId else { loaded = true; failed = true; return }
            let r = await PhotoCohorts.read(localIdentifier: localIdentifier, userId: uid)
            read = r; failed = (r == nil); loaded = true
        }
        .sheet(item: Binding(get: { open.map(CohortSheetItem.init) }, set: { open = $0?.target })) { item in
            PhotoCohortDestination(target: item.target)
        }
    }

    private func chipLabel(icon: String, title: String, missing: Bool) -> some View {
        Label(title, systemImage: icon)
            .font(.footnote.weight(missing ? .regular : .semibold))
            .lineLimit(1)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .foregroundStyle(missing ? Color.white.opacity(0.55) : Color.white)
            .background {
                if missing {
                    Capsule().strokeBorder(Color.white.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                } else {
                    Capsule().fill(Color.white.opacity(0.18))
                }
            }
            .contentShape(Capsule())
    }
}

private struct CohortSheetItem: Identifiable {
    let target: PhotoCohortEdge.Target
    var id: String { String(describing: target) }
}

/// Where a chip goes: the existing screen for that group.
struct PhotoCohortDestination: View {
    let target: PhotoCohortEdge.Target
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        switch target {
        case .vehicle(let id):
            VehicleDetailView(vehicleId: id)
        default:
            NavigationStack {
                content
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
                    }
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch target {
        case .vehicle(let id):
            VehicleDetailView(vehicleId: id, embedInNavigationStack: false)
        case .profile(let uid):
            ProfileView(userId: uid, isOwn: uid.lowercased() == SupabaseService.currentUserId?.lowercased())
        case .organization(let id, let name):
            OrganizationView(orgId: id, fallbackName: name)
        case .vehicles(let filters, let title):
            FilteredVehicleGrid(filters: filters).navigationTitle(title)
        case .cohort(let make, let model, let year):
            CohortTerminalView(make: make, model: model, year: year)
        case .place(let lat, let lng):
            PhotoPlaceMap(latitude: lat, longitude: lng)
        }
    }
}

/// Where the photo was shot. No named place exists for these coordinates yet (garage sites are
/// drafted, not applied), so this shows the point itself and says so.
struct PhotoPlaceMap: View {
    let latitude: Double
    let longitude: Double

    private var coordinate: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }

    var body: some View {
        VStack(spacing: 0) {
            Map(initialPosition: .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 800, longitudinalMeters: 800))) {
                Marker("Photo", coordinate: coordinate)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(String(format: "%.5f, %.5f", latitude, longitude)).font(.body.monospacedDigit())
                Text("No named place or garage is linked to this point yet.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .navigationTitle("Place")
        .navigationBarTitleDisplayMode(.inline)
    }
}
