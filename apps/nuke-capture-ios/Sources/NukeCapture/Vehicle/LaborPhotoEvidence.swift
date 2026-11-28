import SwiftUI
import Supabase

/// Only the reassembly reader's explicitly named image_id is a photo reference. The generic
/// evidence_ids array also contains other kinds of IDs and must not be treated as photos.
struct LaborPhotoReference: Equatable {
    let judgmentId: UUID
    let imageId: UUID
    let part: String

    static func from(_ segment: LaborSegment, names: LaborNames?) -> [LaborPhotoReference] {
        let parts = (segment.reassembly?.matched ?? []) + (segment.reassembly?.unmatched ?? [])
        return parts.compactMap { part in
            guard let raw = part.image_id, let id = UUID(uuidString: raw),
                  let judgment = part.judgment_id.flatMap(UUID.init(uuidString:)) else { return nil }
            return LaborPhotoReference(judgmentId: judgment, imageId: id,
                                       part: LaborWords.partWords(part, names) ?? "Part name not returned")
        }
    }

    static func from(_ appraisal: LaborAppraisal, vehicleId: String, segment: String) -> [LaborPhotoReference]? {
        guard let expected = UUID(uuidString: vehicleId),
              let returned = appraisal.vehicle_id.flatMap(UUID.init(uuidString:)), returned == expected,
              let row = appraisal.segments.first(where: { $0.segment == segment }) else { return nil }
        return from(row, names: appraisal.names)
    }
}

enum LaborPhotoAccess {
    static func allows(openedAs: String?, current: String?, signedIn: Bool) -> Bool {
        current == openedAs && (openedAs == nil || signedIn)
    }
}

/// Re-read the appraisal before displaying its links. The source and account can change while
/// this screen is away; a link from an older fold is not permission to keep showing its details.
struct LaborPhotoEvidenceList: View {
    let vehicleId: String
    let segment: String
    let accountAtOpen: String?
    @EnvironmentObject private var session: SessionStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var state: LoadState = .loading
    @State private var retry = 0

    private enum LoadState {
        case loading, unavailable, failed
        case loaded([LaborPhotoReference], String?)
    }

    private var accountMatches: Bool {
        session.viewerId == SupabaseService.currentUserId
            && LaborPhotoAccess.allows(openedAs: accountAtOpen, current: session.viewerId, signedIn: session.isSignedIn)
    }
    private var refreshKey: String {
        "\(scenePhase)|\(session.viewerId ?? "signed-out")|\(session.isSignedIn)|\(retry)"
    }

    var body: some View {
        Group {
            if scenePhase != .active {
                ProgressView("Refreshing photo links…")
            } else if !accountMatches {
                Text("Your account changed. Return to the vehicle and reopen the photo links.").padding()
            } else {
                switch state {
                case .loading:
                    ProgressView("Reading photo links…")
                case .unavailable:
                    ContentUnavailableView("Photo links unavailable", systemImage: "photo.badge.exclamationmark",
                                           description: Text("No photo links are currently available for this segment."))
                case .failed:
                    ContentUnavailableView {
                        Label("Couldn't load photo links", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text("Try again to read the current sources.")
                    } actions: {
                        Button("Retry") { retry += 1 }
                    }
                case .loaded(let links, let freshness):
                    List {
                        Section {
                            Text("A model linked these photos to parts. A photo alone does not confirm installation.")
                                .font(.footnote).foregroundStyle(.secondary)
                            if let freshness { Text(freshness).font(.footnote).foregroundStyle(.secondary) }
                        }
                        Section("Photo links") {
                            ForEach(Array(links.enumerated()), id: \.offset) { _, link in
                                NavigationLink {
                                    LaborPhotoEvidenceDetail(vehicleId: vehicleId, segment: segment, reference: link,
                                                             accountAtOpen: accountAtOpen)
                                } label: {
                                    Label(link.part, systemImage: "photo")
                                }
                            }
                        }
                    }
                    .accessibilityIdentifier("labor-photo-links")
                }
            }
        }
        .navigationTitle("Photo links")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: scenePhase) { _, phase in if phase != .active { state = .loading } }
        .task(id: refreshKey) { await load() }
    }

    @MainActor private func load() async {
        state = .loading
        guard scenePhase == .active, accountMatches else { return }
        do {
            let appraisal: LaborAppraisal? = try await SupabaseService.client
                .rpc("vehicle_labor_appraisal", params: ["p_vehicle_id": vehicleId]).execute().value
            guard !Task.isCancelled, accountMatches else { return }
            guard let appraisal, let links = LaborPhotoReference.from(appraisal, vehicleId: vehicleId, segment: segment) else {
                state = .unavailable; return
            }
            state = links.isEmpty ? .unavailable : .loaded(links, LaborWords.foldStatus(appraisal))
        } catch {
            guard !Task.isCancelled, accountMatches else { return }
            state = .failed
        }
    }
}

/// Recheck the specific judgment association and resolve the photo through the current gallery gate.
struct LaborPhotoEvidenceDetail: View {
    let vehicleId: String
    let segment: String
    let reference: LaborPhotoReference
    let accountAtOpen: String?
    @EnvironmentObject private var session: SessionStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var state: LoadState = .loading
    @State private var retry = 0

    private enum LoadState { case loading, unavailable, failed, loaded(VehicleGalleryImage) }
    private var accountMatches: Bool {
        session.viewerId == SupabaseService.currentUserId
            && LaborPhotoAccess.allows(openedAs: accountAtOpen, current: session.viewerId, signedIn: session.isSignedIn)
    }
    private var refreshKey: String {
        "\(scenePhase)|\(session.viewerId ?? "signed-out")|\(session.isSignedIn)|\(retry)"
    }

    var body: some View {
        Group {
            if scenePhase != .active {
                ProgressView("Refreshing photo…")
            } else if !accountMatches {
                Text("Your account changed. Return to the vehicle and reopen the photo links.").padding()
            } else {
                switch state {
                case .loading:
                    ProgressView("Reading photo…")
                case .unavailable:
                    ContentUnavailableView("Photo unavailable", systemImage: "photo.badge.exclamationmark",
                                           description: Text("This link or photo is no longer available for this vehicle."))
                case .failed:
                    ContentUnavailableView {
                        Label("Couldn't load the photo", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text("Try again to read the current photo.")
                    } actions: {
                        Button("Retry") { retry += 1 }
                    }
                case .loaded(let photo):
                    FullScreenGalleryView(photos: [photo])
                        .toolbar(.hidden, for: .navigationBar)
                        .accessibilityIdentifier("labor-source-photo")
                }
            }
        }
        .navigationTitle("Photo source")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: scenePhase) { _, phase in if phase != .active { state = .loading } }
        .task(id: refreshKey) { await load() }
    }

    @MainActor private func load() async {
        state = .loading
        guard scenePhase == .active, accountMatches else { return }
        do {
            let appraisal: LaborAppraisal? = try await SupabaseService.client
                .rpc("vehicle_labor_appraisal", params: ["p_vehicle_id": vehicleId]).execute().value
            guard !Task.isCancelled, accountMatches else { return }
            guard let appraisal,
                  let links = LaborPhotoReference.from(appraisal, vehicleId: vehicleId, segment: segment),
                  links.contains(where: { $0.judgmentId == reference.judgmentId && $0.imageId == reference.imageId }) else {
                state = .unavailable; return
            }
            let photo = try await VehicleImageLoader.currentSourceImage(id: reference.imageId, vehicleId: vehicleId)
            guard !Task.isCancelled, accountMatches else { return }
            state = photo.map(LoadState.loaded) ?? .unavailable
        } catch {
            guard !Task.isCancelled, accountMatches else { return }
            state = .failed
        }
    }
}
